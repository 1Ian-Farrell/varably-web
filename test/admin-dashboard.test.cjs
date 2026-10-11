const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'admin-dashboard.js'), 'utf8');

function harness() {
  const elements = new Map();
  function node() {
    const item = {
      hidden: false, disabled: false, textContent: '', value: '', children: [],
      handlers: {}, attributes: {}, className: '', dataset: {},
      classList: {
        toggle(name, enabled) {
          const classes = new Set(item.className.split(/\s+/).filter(Boolean));
          if (enabled === undefined ? !classes.has(name) : enabled) classes.add(name);
          else classes.delete(name);
          item.className = Array.from(classes).join(' ');
        },
      },
      addEventListener(type, handler) { this.handlers[type] = handler; },
      replaceChildren() { this.children = []; },
      append(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); },
      appendChild(child) { this.append(child); return child; },
      setAttribute(name, value) { this.attributes[name] = value; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
      querySelectorAll(selector) {
        const className = selector.startsWith('.') ? selector.slice(1) : null;
        const found = [];
        const visit = parent => parent.children.forEach(child => {
          if (className && child.className.split(/\s+/).includes(className)) found.push(child);
          visit(child);
        });
        visit(this);
        return found;
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      close() {}, showModal() {},
    };
    item.click = () => item.handlers.click && item.handlers.click();
    item.matches = selector => selector.startsWith('.') && item.className.split(/\s+/).includes(selector.slice(1));
    item.closest = selector => {
      let current = item;
      while (current) { if (current.matches(selector)) return current; current = current.parent; }
      return null;
    };
    return item;
  }
  const get = id => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  };
  get('collection').value = 'spots';
  const queries = [];
  const writes = [];
  let authCallback;
  let roleCallback;
  let roleError;
  let result = [];
  let queryError;
  let redirected;
  function query(collection) {
    const filters = [];
    return {
      where(...args) { filters.push(args); return this; },
      limit(count) { assert.equal(count, 25); return this; },
      startAfter(cursor) { this.cursor = cursor; return this; },
      async get() {
        queries.push({ collection, filters, cursor: this.cursor });
        if (queryError) throw queryError;
        return { docs: result, size: result.length };
      },
      doc(id) {
        return {
          id, path: `${collection}/${id}`,
          onSnapshot(success, failure) {
            roleCallback = success; roleError = failure;
            return () => {};
          },
        };
      },
    };
  }
  const context = vm.createContext({
    firebase: {
      auth: () => ({ onAuthStateChanged(callback) { authCallback = callback; },
        signOut: async () => {} }),
      firestore: Object.assign(() => ({
        collection: query, collectionGroup: query,
        runTransaction: async operation => operation({
          get: async reference => ({ exists: true, data: () => reference._data }),
          update: (reference, data) => writes.push({ path: reference.path, data }),
        }),
      }), { FieldValue: { serverTimestamp: () => 'timestamp', delete: () => 'deleted' },
        Timestamp: { fromDate: date => date } }),
      functions: () => ({ httpsCallable: name => async parameters =>
        writes.push({ name, parameters }) }),
    },
    document: {
      getElementById: get, createElement: node,
      querySelectorAll(selector) {
        const match = /^#([\w-]+)\s+(.+)$/.exec(selector);
        return match ? get(match[1]).querySelectorAll(match[2]) : [];
      },
    },
    window: { location: { replace(url) { redirected = url; } }, confirm: () => true },
    console: { error() {} },
    VarablyContentEditor: require('../admin-content-editor.js'),
    URL: { createObjectURL: () => 'blob:preview', revokeObjectURL() {} },
  });
  vm.runInContext(source, context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  function record(id, data, collection = 'spot_claims') {
    const ref = { path: `${collection}/${id}`, parent: { id: collection }, _data: data,
        delete: async () => writes.push({ deleted: `${collection}/${id}` }) };
    return { id, ref, data: () => data };
  }
  return {
    get, queries, writes, context, record, settle,
    signIn: user => authCallback(user),
    role: value => roleCallback({ exists: true, data: () => ({ isAdmin: value }) }),
    roleFailure: error => roleError(error),
    setResult: docs => { result = docs; },
    setError: error => { queryError = error; },
    redirect: () => redirected,
  };
}

test('signed-out visitors return to admin page after signing in', () => {
  const app = harness();
  app.signIn(null);
  assert.equal(app.redirect(), 'pro-dashboard-sign-in.html?next=admin-dashboard.html');
  assert.equal(app.queries.length, 0);
});

test('non-admin accounts cannot load administrative records', async () => {
  const app = harness();
  app.signIn({ uid: 'regular' });
  app.role(false);
  await app.settle();
  assert.equal(app.get('dashboard').hidden, true);
  assert.equal(app.queries.length, 0);
  assert.match(app.get('notice').textContent, /Admin access is required/);
});

test('admins load claims and lose displayed content when role is revoked', async () => {
  const app = harness();
  app.setResult([app.record('claim', { spotTitle: 'A spot' })]);
  app.signIn({ uid: 'admin', email: 'admin@example.test' });
  app.role(true);
  await app.settle();
  assert.equal(app.get('dashboard').hidden, false);
  assert.equal(app.queries[0].collection, 'spot_claims');
  assert.equal(app.get('records').children.length, 1);
  app.role(false);
  assert.equal(app.get('dashboard').hidden, true);
  assert.equal(app.get('records').children.length, 0);
});

test('role and collection failures are visible, never successful empty states', async () => {
  const app = harness();
  app.signIn({ uid: 'admin' });
  app.roleFailure(new Error('Permission denied'));
  assert.match(app.get('notice').textContent, /Permission denied/);
  assert.equal(app.get('dashboard').hidden, true);
  app.setError(new Error('Network unavailable'));
  app.role(true);
  await app.settle();
  assert.match(app.get('notice').textContent, /Network unavailable/);
  assert.equal(app.get('more').disabled, false);
});

test('pagination uses cursor, caps reads, and removes duplicate records', async () => {
  const app = harness();
  const docs = Array.from({ length: 25 }, (_, i) => app.record(String(i), {}));
  app.setResult(docs);
  app.signIn({ uid: 'admin' });
  app.role(true);
  await app.settle();
  assert.equal(app.get('more').hidden, false);
  app.setResult([docs[24], app.record('25', {})]);
  await app.get('more').handlers.click();
  assert.equal(app.queries[1].cursor, docs[24]);
  assert.equal(app.get('records').children.length, 26);
  assert.equal(app.get('more').hidden, true);
});

test('untrusted record strings are rendered as text, not HTML', async () => {
  const app = harness();
  app.setResult([app.record('claim', { spotTitle: '<img src=x onerror=alert(1)>' })]);
  app.signIn({ uid: 'admin' });
  app.role(true);
  await app.settle();
  const title = app.get('records').children[0].children[0];
  assert.equal(title.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(title.children.length, 0);
});

test('the landing page omits the admin link and only the signed-in Pro page can show it', () => {
  const signin = fs.readFileSync(path.join(root, 'pro-dashboard-sign-in.html'), 'utf8');
  const fragment = signin.slice(signin.indexOf('function postSignInPage()'),
    signin.indexOf('function postSignInPage()') + 400);
  assert.match(fragment, /'admin-dashboard\.html'/);
  const landing = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(landing, /href=["']admin-dashboard\.html["']/i);
  assert.doesNotMatch(landing, /Business Plans/i);
  const proPage = fs.readFileSync(path.join(root, 'pro-dashboard.html'), 'utf8');
  assert.match(proPage, /id="admin-dashboard-link"[^>]*hidden/);
  assert.match(proPage, /auth\.onAuthStateChanged/);
  assert.match(proPage, /snapshot\.data\(\)\.isAdmin !== true/);
  assert.match(proPage, /adminLink\.hidden = true/);
  assert.match(proPage, /adminAccessUnsubscribe\(\)/);
});

test('editing uses creation-style cards, repeatable rows, chips and weekly hour controls', () => {
  const html = fs.readFileSync(path.join(root, 'admin-dashboard.html'), 'utf8');
  assert.match(html, /class="edit-card"[\s\S]*Basics/);
  assert.match(html, /id="edit-add-activity"/);
  assert.match(html, /id="edit-add-link"/);
  assert.match(html, /id="edit-cost-chips"/);
  assert.match(html, /id="edit-env-chips"/);
  assert.match(html, /id="edit-parking-chips"/);
  assert.match(html, /id="edit-schedule"/);
  assert.doesNotMatch(html, /Activities and gear \(JSON\)|Weekly schedule \(JSON\)/);
  assert.match(html, /Save Changes/);
});

test('website labels use Suggested Spot Edits', () => {
  const html = fs.readFileSync(path.join(root, 'admin-dashboard.html'), 'utf8');
  assert.match(html, />Suggested Spot Edits<\/button>/);
  assert.doesNotMatch(html, /Spot Suggestions/);
  assert.doesNotMatch(source, /spot suggestion/i);
});

test('admin editor opens full spot fields and saves selected cover without changing ownership', async () => {
  const app = harness();
  const doc = app.record('spot', {
    title: 'Original', creator: 'owner', imageUrls: ['first', 'cover'], coverImage: 'cover',
    activities: [{ activityName: 'hiking', gear: ['boots'] }],
    cost: { isFree: false, tier: '$$', notes: 'Admission' },
    hoursOfOperation: { hasHours: true, is24Seven: true, schedule: null },
  }, 'spots');
  vm.runInContext("tab = 'content'", app.context);
  app.setResult([doc]);
  app.signIn({ uid: 'admin' });
  app.role(true);
  await app.settle();
  const actions = app.get('records').children[0].children.at(-1);
  await actions.children.find(button => button.textContent === 'Edit').handlers.click();
  assert.equal(app.get('edit-spot-fields').hidden, false);
  assert.equal(app.get('edit-event-fields').hidden, true);
  assert.equal(app.get('edit-activities').children.length, 1);
  assert.equal(app.get('edit-links').children.length, 0);
  app.get('edit-title').value = 'Updated';
  app.get('edit-add-activity').handlers.click();
  assert.equal(app.get('edit-activities').children.length, 2);
  app.get('edit-activities').children[1].children[0].value = 'Yoga';
  app.get('edit-activities').children[1].children[1].value = 'mat, water';
  await app.get('edit-form').handlers.submit({ preventDefault() {} });
  assert.equal(app.writes.length, 1);
  const saved = app.writes[0].data;
  assert.equal(saved.title, 'Updated');
  assert.deepEqual(Array.from(saved.imageUrls), ['cover', 'first']);
  assert.equal(saved.coverImage, 'cover');
  assert.equal(saved.creator, undefined);
  assert.equal(saved.businessTier, undefined);
  assert.deepEqual(Array.from(saved.activities).map(activity => activity.activityName), ['hiking', 'yoga']);
  assert.equal(app.get('save').disabled, false);
  assert.equal(app.get('edit-error').textContent, '');
});

test('editor rejects overflow and conflicting gallery edits explicitly', async () => {
  const app = harness();
  const doc = app.record('full', {
    title: 'Full', imageUrls: Array.from({ length: 10 }, (_, i) => `photo-${i}`),
  }, 'spots');
  vm.runInContext("tab = 'content'", app.context);
  app.setResult([doc]);
  app.signIn({ uid: 'admin' });
  app.role(true);
  await app.settle();
  const actions = app.get('records').children[0].children.at(-1);
  await actions.children.find(button => button.textContent === 'Edit').handlers.click();
  assert.equal(app.get('edit-photo-files').disabled, true);
  const target = { files: [{ type: 'image/jpeg' }], value: '' };
  app.get('edit-photo-files').handlers.change({ target });
  assert.match(app.get('edit-error').textContent, /limit is 10/);
  doc.ref._data = { ...doc.ref._data, imageUrls: ['changed-remotely'] };
  await app.get('edit-form').handlers.submit({ preventDefault() {} });
  assert.equal(app.writes.length, 0);
  assert.match(app.get('edit-error').textContent, /Photos changed/);
});

test('content deletion is available to admins after confirmation', async () => {
  const app = harness();
  vm.runInContext("tab = 'content'", app.context);
  app.setResult([app.record('event', { title: 'Event' }, 'events')]);
  app.signIn({ uid: 'admin' });
  app.role(true);
  await app.settle();
  const actions = app.get('records').children[0].children.at(-1);
  const button = actions.children.find(item => item.textContent === 'Delete');
  assert.ok(button);
  app.context.window.confirm = () => false;
  await button.handlers.click();
  assert.equal(app.writes.length, 0);
  app.context.window.confirm = () => true;
  await button.handlers.click();
  assert.deepEqual(app.writes, [{ deleted: 'events/event' }]);
});
