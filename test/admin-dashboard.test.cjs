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
    return {
      hidden: false, disabled: false, textContent: '', value: '', children: [],
      handlers: {}, classList: { toggle() {} },
      addEventListener(type, handler) { this.handlers[type] = handler; },
      replaceChildren() { this.children = []; },
      append(...children) { this.children.push(...children); },
      close() {}, showModal() {},
    };
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
      }), { FieldValue: { serverTimestamp: () => 'timestamp' } }),
      functions: () => ({ httpsCallable: name => async parameters =>
        writes.push({ name, parameters }) }),
    },
    document: { getElementById: get, createElement: node, querySelectorAll: () => [] },
    window: { location: { replace(url) { redirected = url; } }, confirm: () => true },
    console: { error() {} },
  });
  vm.runInContext(source, context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  function record(id, data) {
    return { id, ref: { path: `spot_claims/${id}` }, data: () => data };
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

test('existing sign-in flow permits the admin target and site links reach it', () => {
  const signin = fs.readFileSync(path.join(root, 'pro-dashboard-sign-in.html'), 'utf8');
  const fragment = signin.slice(signin.indexOf('function postSignInPage()'),
    signin.indexOf('function postSignInPage()') + 400);
  assert.match(fragment, /'admin-dashboard\.html'/);
  for (const file of ['index.html', 'pro-dashboard.html']) {
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /href="admin-dashboard\.html"/);
  }
});
