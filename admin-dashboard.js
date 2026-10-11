'use strict';

const auth = firebase.auth();
const db = firebase.firestore();
const functions = firebase.functions();
const timestamp = () => firebase.firestore.FieldValue.serverTimestamp();
const element = id => document.getElementById(id);
let currentUser = null;
let adminUnsubscribe = null;
let authorized = false;
let tab = 'claims';
let generation = 0;
let records = [];
let cursor = null;
let loading = false;
let editing = null;

function notice(message, error = false) {
  element('notice').textContent = message;
  element('notice').classList.toggle('error', error);
}

function showError(error) {
  console.error('[Admin Dashboard]', error);
  notice(error.message || String(error), true);
}

auth.onAuthStateChanged(user => {
  if (adminUnsubscribe) adminUnsubscribe();
  authorized = false;
  generation++;
  element('dashboard').hidden = true;
  element('records').replaceChildren();
  element('editor').close();
  currentUser = user;
  if (!user) {
    window.location.replace('pro-dashboard-sign-in.html?next=admin-dashboard.html');
    return;
  }
  element('account').textContent = user.email || '';
  notice('Checking admin access...');
  adminUnsubscribe = db.collection('users').doc(user.uid).onSnapshot(snapshot => {
    const wasAuthorized = authorized;
    authorized = snapshot.exists && snapshot.data().isAdmin === true;
    element('dashboard').hidden = !authorized;
    if (!authorized) {
      generation++;
      records = [];
      element('records').replaceChildren();
      element('editor').close();
      notice('Admin access is required. This account is not marked as an admin.', true);
    } else if (!wasAuthorized) {
      loadRecords(true);
    }
  }, error => {
    authorized = false;
    generation++;
    element('dashboard').hidden = true;
    records = [];
    element('records').replaceChildren();
    element('editor').close();
    showError(error);
  });
});

element('signout').addEventListener('click', () => auth.signOut().catch(showError));
document.querySelectorAll('[data-tab]').forEach(button => {
  button.addEventListener('click', () => {
    tab = button.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach(item =>
      item.setAttribute('aria-pressed', String(item === button)));
    element('collection').hidden = tab !== 'content';
    element('search').value = '';
    loadRecords(true);
  });
});
element('collection').addEventListener('change', () => loadRecords(true));
element('refresh').addEventListener('click', () => loadRecords(true));
element('more').addEventListener('click', () => loadRecords(false));
element('search').addEventListener('input', render);

function queryForTab() {
  switch (tab) {
    case 'claims': return db.collection('spot_claims').where('status', '==', 'pending');
    case 'content': return db.collection(element('collection').value);
    case 'users': return db.collection('users');
    case 'reports': return db.collection('adminReports').where('status', '==', 'pending');
    case 'suggestions': return db.collectionGroup('contributions').where('status', '==', 'pending');
    default: throw new Error('Unknown admin section.');
  }
}

async function loadRecords(reset) {
  if (!authorized || (loading && !reset)) return;
  if (reset) {
    generation++;
    records = [];
    cursor = null;
    element('records').replaceChildren();
    element('more').hidden = true;
  }
  const request = generation;
  loading = true;
  element('more').disabled = true;
  notice('Loading...');
  try {
    let query = queryForTab().limit(25);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (request !== generation || !authorized) return;
    const existing = new Set(records.map(doc => doc.ref.path));
    snapshot.docs.forEach(doc => {
      if (!existing.has(doc.ref.path)) records.push(doc);
    });
    cursor = snapshot.docs[snapshot.docs.length - 1] || cursor;
    element('more').hidden = snapshot.size < 25;
    notice(records.length ? `${records.length} records loaded.` : 'No records in this section.');
    render();
  } catch (error) {
    if (request === generation) showError(error);
  } finally {
    if (request === generation) {
      loading = false;
      element('more').disabled = false;
    }
  }
}

function text(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value == null ? '' : String(value);
  return node;
}

function action(container, label, operation, destructive = false) {
  const button = text('button', label);
  button.type = 'button';
  if (destructive) button.className = 'danger';
  button.addEventListener('click', async () => {
    if (!authorized) { notice('Admin access is required.', true); return; }
    button.disabled = true;
    const request = generation;
    try {
      if (await operation() !== false && request === generation) {
        await loadRecords(true);
      }
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  });
  container.append(button);
}

function render() {
  element('records').replaceChildren();
  const search = element('search').value.trim().toLowerCase();
  let shown = 0;
  records.forEach(doc => {
    const data = doc.data();
    const values = [doc.id, data.title, data.spotTitle, data.displayName,
      data.username, data.email, data.description, data.location];
    if (search && !values.some(value => String(value || '').toLowerCase().includes(search))) return;
    shown++;
    const card = document.createElement('article');
    card.append(text('h3', data.title || data.spotTitle || data.displayName || data.username || doc.id));
    card.append(text('p', `ID: ${doc.id}`));
    const actions = document.createElement('div');
    actions.className = 'actions';
    if (tab === 'claims') {
      card.append(text('p', [
        `Name: ${data.fullName || ''}`, `Role: ${data.role || ''}`,
        `Phone: ${data.phone || ''}`, `Account: ${data.claimedByEmail || data.claimedByUid || ''}`,
        `Notes: ${data.notes || ''}`
      ].join('\n')));
      action(actions, 'Approve', () => reviewClaim(doc.ref, true));
      action(actions, 'Reject', () => reviewClaim(doc.ref, false), true);
    } else if (tab === 'content') {
      card.append(text('p', `${data.location || ''}\n${data.description || ''}\n${data.isArchived ? 'Archived' : 'Active'}`));
      action(actions, 'Edit', () => {
        editing = doc.ref;
        element('edit-title').value = data.title || '';
        element('edit-location').value = data.location || '';
        element('edit-description').value = data.description || '';
        element('edit-error').textContent = '';
        element('editor').showModal();
        return false;
      });
      action(actions, data.isArchived ? 'Restore' : 'Archive', async () => {
        if (!window.confirm(`${data.isArchived ? 'Restore' : 'Archive'} "${data.title || doc.id}"?`)) return false;
        await doc.ref.update({ isArchived: !data.isArchived, updatedAt: timestamp() });
      }, !data.isArchived);
    } else if (tab === 'users') {
      const suspended = data.accountSuspension && data.accountSuspension.active === true;
      card.append(text('p', `${data.email || ''}\n${data.isAdmin === true ? 'Admin' : suspended ? 'Suspended' : 'Active'}`));
      if (data.isAdmin !== true && doc.id !== currentUser.uid) {
        if (suspended) {
          action(actions, 'Restore account', () => manageUser('restoreAccount', doc.id, {}));
        } else {
          [1, 7, 30, null].forEach(days => action(actions,
            days === null ? 'Suspend indefinitely' : `Suspend ${days} day${days === 1 ? '' : 's'}`,
            () => manageUser('setAccountSuspension', doc.id, { days }), true));
        }
        action(actions, 'Delete account', () => manageUser('deleteAccount', doc.id, {}), true);
      }
    } else if (tab === 'reports') {
      card.append(text('p', `${data.itemType || 'content'}: ${data.itemId || ''}\n${data.reportCount || 0} reports`));
      action(actions, 'Mark resolved', () => doc.ref.update({ status: 'resolved', resolvedAt: timestamp() }));
    } else if (tab === 'suggestions') {
      card.append(text('p', `Spot: ${doc.ref.parent.parent.id}\n${data.description || ''}`));
      card.append(text('p', JSON.stringify({
        photoUrls: data.photoUrls || [], activities: data.activities || [],
        hoursOfOperation: data.hoursOfOperation || {}
      }, null, 2)));
      action(actions, 'Approve', () => reviewSuggestion(doc.ref, true));
      action(actions, 'Reject', () => reviewSuggestion(doc.ref, false), true);
    }
    card.append(actions);
    element('records').append(card);
  });
  if (!shown) element('records').append(text('p', 'No matching records loaded.'));
}

async function manageUser(name, uid, parameters) {
  if (!window.confirm(`${name === 'deleteAccount' ? 'Permanently delete' : name === 'restoreAccount' ? 'Restore' : 'Suspend'} account ${uid}?${name === 'deleteAccount' ? ' This cannot be undone.' : ''}`)) return false;
  await functions.httpsCallable(name)({ uid, ...parameters });
}

async function reviewClaim(reference, approve) {
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.data().status !== 'pending') throw new Error('This claim is no longer pending.');
    const data = snapshot.data();
    if (approve) {
      if (typeof data.spotId !== 'string' || !data.spotId || data.spotId.includes('/') ||
          typeof data.claimedByUid !== 'string' || !data.claimedByUid || data.claimedByUid.includes('/')) {
        throw new Error('Claim is missing a valid spot or account ID.');
      }
      const user = await transaction.get(db.collection('users').doc(data.claimedByUid));
      const profile = user.data() || {};
      transaction.update(db.collection('spots').doc(data.spotId), {
        isClaimed: true, creator: data.claimedByUid, creatorId: data.claimedByUid,
        createdBy: { uid: data.claimedByUid, displayName: profile.displayName || '', photoUrl: profile.photoUrl || '' }
      });
    }
    transaction.update(reference, {
      status: approve ? 'approved' : 'rejected', reviewedBy: currentUser.uid, reviewedAt: timestamp()
    });
  });
}

async function reviewSuggestion(reference, approve) {
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.data().status !== 'pending') throw new Error('This suggested spot edit is no longer pending.');
    if (reference.parent.parent.parent.id !== 'spots') throw new Error('This is not a suggested spot edit.');
    if (approve) {
      const data = snapshot.data();
      const spotRef = reference.parent.parent;
      const spot = await transaction.get(spotRef);
      if (!spot.exists) throw new Error('This spot no longer exists.');
      const updates = {};
      const photos = Array.isArray(data.photoUrls) ? data.photoUrls.filter(url => typeof url === 'string' && url) : [];
      if (photos.length) {
        updates.imageUrls = firebase.firestore.FieldValue.arrayUnion(...photos);
        if (!spot.data().coverImage) updates.coverImage = photos[0];
      }
      if (typeof data.description === 'string' && data.description) updates.description = data.description;
      if (Array.isArray(data.activities) && data.activities.length) updates.activities = data.activities;
      if (data.hoursOfOperation && typeof data.hoursOfOperation === 'object' && !Array.isArray(data.hoursOfOperation)) {
        updates.hoursOfOperation = data.hoursOfOperation;
      }
      if (Object.keys(updates).length) transaction.update(spotRef, updates);
    }
    transaction.update(reference, {
      status: approve ? 'approved' : 'rejected', reviewedBy: currentUser.uid, reviewedAt: timestamp()
    });
  });
}

element('cancel-edit').addEventListener('click', () => element('editor').close());
element('edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!authorized || !editing) return;
  element('save').disabled = true;
  try {
    const title = element('edit-title').value.trim();
    if (!title) throw new Error('Title is required.');
    await editing.update({
      title, location: element('edit-location').value.trim(),
      description: element('edit-description').value.trim(), updatedAt: timestamp()
    });
    element('editor').close();
    await loadRecords(true);
  } catch (error) {
    element('edit-error').textContent = error.message || String(error);
    console.error('[Admin Dashboard] Edit failed', error);
  } finally {
    element('save').disabled = false;
  }
});
