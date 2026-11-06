import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, symlinkSync, statSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { LocalStore } from './storage.mjs';
import { importMessages, syncMessages } from './import.mjs';
import { startLocalServer } from './server.mjs';
import { seedDemo } from './demo.mjs';
import { tbcParser } from '../service/src/parsers/tbc.ts';

// All inputs are synthetic. No test resolves ~/Library/Messages or ~/.xarji.
const payment = '47.80 GEL\nVISA (***0000)\nSYNTHETIC MERCHANT\n08/10/2026\nNashti: 912345.67 GEL';
const message = (messageId = 1, text = payment, senderId = 'TBC SMS') => ({ messageId, text, senderId, timestamp: '2026-10-08T12:34:56Z' });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'xarji-local-test-'));
  const store = new LocalStore(join(root, 'data'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}
const category = { name: 'Synthetic category', color: '#abcdef', icon: 'shopping', isDefault: false };

test('private storage and separate capabilities; reject world-readable paths and symlinks', t => {
  const { root, store } = fixture(t);
  assert.notEqual(store.uiToken, store.agentToken);
  assert.equal(statSync(store.dataDir).mode & 0o777, 0o700);
  for (const file of readdirSync(store.dataDir)) assert.equal(statSync(join(store.dataDir, file)).mode & 0o077, 0);
  const publicDir = join(root, 'public'); mkdirSync(publicDir); chmodSync(publicDir, 0o755);
  assert.throws(() => new LocalStore(publicDir), /private/);
  const linked = join(root, 'linked'); symlinkSync(store.dataDir, linked);
  assert.throws(() => new LocalStore(linked), /symlinked/);
  const bad = join(root, 'bad'); mkdirSync(bad, { mode: 0o700 }); symlinkSync(store.dbPath, join(bad, 'ledger.sqlite'));
  assert.throws(() => new LocalStore(bad), /symlinked/);
});

test('ordinary, Georgian and mixed security messages cannot enter parser or storage', t => {
  const { store } = fixture(t);
  const security = ['Your OTP is 654321', 'ერთჯერადი კოდი: 654321', 'Sms Code:654321\nPlease check that you enter this code only on https://tbconline.ge or in mobilebank', `${payment}\nSMS Code: 654321`, `${payment}\nVerification code 654321`, `${payment}\nPIN: 654321`];
  const parse = t.mock.method(tbcParser, 'parse');
  const result = importMessages(store, [message(), ...security.map((s, i) => message(i + 2, s)), message(20, payment, 'PRIVATE FRIEND')]);
  assert.equal(parse.mock.callCount(), 1);
  assert.equal(parse.mock.calls[0].arguments[0].text, payment);
  assert.equal(result.imported, 1); assert.equal(result.securitySkipped, security.length); assert.equal(result.unsupported, 1);
  const snapshot = JSON.stringify(store.snapshot());
  for (const forbidden of ['rawMessage', 'Nashti', '912345.67', '654321', 'PRIVATE FRIEND', 'balance', 'failureReason']) assert.ok(!snapshot.includes(forbidden), forbidden);
  // Check SQLite pages and WAL, not just the HTTP projection.
  for (const file of readdirSync(store.dataDir).filter(name => name.startsWith('ledger.sqlite'))) {
    const bytes = readFileSync(join(store.dataDir, file));
    assert.ok(!bytes.includes(Buffer.from('654321'))); assert.ok(!bytes.includes(Buffer.from('Nashti')));
  }
});

test('credits and reversals retain direction, failed payments never retain failure text', t => {
  const { store } = fixture(t);
  const inputs = [message(1, 'Charicxva: 1200.00 GEL\n08/10/2026\nSYNTHETIC SALARY'), message(2, 'Ukugatareba: 12.00 GEL VISA (***0000) SYNTHETIC SHOP 08/10/2026'), message(3, 'Sabarate operacia 12.00 GEL uarYofiliA\n08/10/2026\nSYNTHETIC SHOP\nMizezi: PRIVATE FAILURE TEXT')];
  assert.equal(importMessages(store, inputs).imported, 3);
  assert.equal(store.rows('credits').length, 2); assert.equal(store.rows('failedPayments').length, 1);
  assert.ok(!JSON.stringify(store.snapshot()).includes('PRIVATE FAILURE TEXT'));
});

test('atomic validation, imported fields immutable, deletion tombstones and optional budget-field clearing', t => {
  const { store } = fixture(t);
  assert.throws(() => store.transact([{ collection: 'categories', id: 'a', kind: 'update', value: category }, { collection: 'categories', id: 'b', kind: 'update', value: { ...category, rawMessage: 'NEVER STORE' } }]));
  assert.equal(store.rows('categories').length, 0);
  assert.throws(() => importMessages(store, [message(), { ...message(2), timestamp: 'invalid' }]));
  assert.equal(store.rows('payments').length, 0);
  importMessages(store, [message()]); const id = store.rows('payments')[0].id;
  assert.throws(() => store.transact([{ collection: 'payments', id, kind: 'update', value: { amount: 1 } }]), /read-only/);
  store.transact([{ collection: 'payments', id, kind: 'update', value: { excludedFromAnalytics: true } }]);
  assert.equal(store.get('payments', id).excludedFromAnalytics, true);
  store.transact([{ collection: 'payments', id, kind: 'delete' }]);
  assert.equal(importMessages(store, [message()]).duplicate, 1); assert.equal(store.rows('payments').length, 0);
  store.transact([{ collection: 'categories', id: 'cat', kind: 'update', value: { ...category, bucket: 'fixed', targetAmount: 200 } }]);
  store.transact([{ collection: 'categories', id: 'cat', kind: 'update', value: {}, unset: ['bucket', 'targetAmount'] }]);
  assert.equal(store.get('categories', 'cat').bucket, undefined);
  assert.throws(() => store.transact([{ collection: 'categories', id: 'cat', kind: 'update', value: {}, unset: ['name'] }]));
  assert.throws(() => store.transact([{ collection: 'bankSenders', id: 'private', kind: 'update', value: { senderId: 'PRIVATE FRIEND', displayName: 'Friend', enabled: true, createdAt: Date.now() } }]));
});

test('readonly synthetic Messages source: bank-only, incoming-only, pagination, attributedBody and cursor', t => {
  const { root, store } = fixture(t);
  const path = join(root, 'synthetic-chat.sqlite');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE handle(id TEXT); CREATE TABLE message(handle_id INTEGER,text TEXT,attributedBody BLOB,date INTEGER,is_from_me INTEGER); INSERT INTO handle VALUES (\'TBC SMS\'),(\'PRIVATE FRIEND\');');
  const insert = db.prepare('INSERT INTO message VALUES(?,?,?,?,?)');
  db.exec('BEGIN');
  for (let i = 0; i < 1001; i++) insert.run(1, 'Your OTP is 654321', null, 813412800000000000, 0);
  insert.run(1, payment, null, 813412800000000000, 0);
  insert.run(2, payment, null, 813412800000000000, 0);
  insert.run(1, payment, null, 813412800000000000, 1);
  const blob = text => Buffer.concat([Buffer.from('NSString +'), Buffer.from([text.length]), Buffer.from(text), Buffer.from('NSDictionary')]);
  insert.run(1, null, blob(payment), 813412800000000000, 0);
  insert.run(1, null, blob(`${payment}\n08.10.2026\nOTP 654321`), 813412800000000000, 0);
  db.exec('COMMIT'); db.close();
  const before = readFileSync(path);
  const stats = syncMessages(store, path);
  assert.equal(stats.imported, 2); assert.equal(stats.securitySkipped, 1002); assert.equal(stats.received, 1004);
  assert.equal(store.cursor('TBC SMS'), 1006); assert.equal(syncMessages(store, path).received, 0);
  assert.deepEqual(readFileSync(path), before);
  assert.equal(store.rows('payments').length, 2);
  store.transact([{ collection: 'bankSenders', id: 'tbc-sms', kind: 'update', value: { enabled: false } }]);
  assert.equal(syncMessages(store, path).received, 0);
});

async function httpFixture(t) {
  const { root, store } = fixture(t); const assets = join(root, 'assets'); mkdirSync(assets);
  writeFileSync(join(assets, 'index.html'), '<h1>synthetic</h1>');
  writeFileSync(join(root, 'private.txt'), 'PRIVATE FILE'); symlinkSync(join(root, 'private.txt'), join(assets, 'escape.txt'));
  const http = await startLocalServer({ store, port: 0, assetsDir: assets });
  // Server closes before the store, including when an assertion fails.
  t.after(async () => { await http.close(); });
  return { store, http };
}
async function login(http, store, token = store.uiToken) {
  const response = await fetch(http.url + '/api/session', { method: 'POST', headers: { Origin: http.url, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0], body: await response.json() };
}
const rawRequest = (http, path, headers = {}) => new Promise((resolve, reject) => {
  const req = request(http.url + path, { headers }, res => { let body = ''; res.on('data', data => body += data); res.on('end', () => resolve({ status: res.statusCode, body })); }); req.on('error', reject); req.end();
});

test('HTTP capability auth, cookie session, exact Host/Origin and CSRF guards', async t => {
  const { http, store } = await httpFixture(t);
  assert.equal(http.server.address().address, '127.0.0.1');
  assert.equal((await fetch(http.url + '/api/snapshot')).status, 401);
  assert.equal((await fetch(http.url + '/api/health')).status, 200);
  assert.equal((await rawRequest(http, '/', { Host: 'attacker.invalid' })).status, 403);
  assert.equal((await rawRequest(http, '/', { Host: `localhost:${http.server.address().port}` })).status, 403);
  for (const headers of [{ Origin: 'https://attacker.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'X-Forwarded-Host': 'attacker.invalid' }, { 'X-Forwarded-For': '127.0.0.1' }]) assert.equal((await rawRequest(http, '/api/health', headers)).status, 403);
  assert.equal((await fetch(http.url + '/api/session', { method: 'POST', headers: { Authorization: `Bearer ${store.uiToken}`, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await login(http, store, store.agentToken)).response.status, 401);
  const session = await login(http, store); assert.equal(session.response.status, 200);
  assert.match(session.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const mutate = headers => fetch(http.url + '/api/transact', { method: 'POST', headers: { Cookie: session.cookie, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ operations: [{ collection: 'categories', id: 'test', kind: 'update', value: category }] }) });
  assert.equal((await mutate({})).status, 403);
  assert.equal((await mutate({ Origin: http.url })).status, 403);
  assert.equal((await mutate({ Origin: 'https://attacker.invalid', 'X-Xarji-CSRF': session.body.csrf })).status, 403);
  assert.equal((await mutate({ Origin: http.url, 'X-Xarji-CSRF': session.body.csrf })).status, 200);
  assert.equal(store.rows('categories').length, 1);
  assert.equal((await fetch(http.url + '/api/sync', { method: 'POST', headers: { Cookie: session.cookie, Origin: http.url, 'X-Xarji-CSRF': session.body.csrf, 'Content-Type': 'application/json' }, body: '{}' })).status, 409);
  const logout = await fetch(http.url + '/api/session', { method: 'DELETE', headers: { Cookie: session.cookie, Origin: http.url, 'X-Xarji-CSRF': session.body.csrf } });
  assert.equal(logout.status, 200); assert.equal((await fetch(http.url + '/api/snapshot', { headers: { Cookie: session.cookie } })).status, 401);
});

test('agent GET-only scope omits names/cards and cannot use UI/export/import APIs', async t => {
  const { http, store } = await httpFixture(t); importMessages(store, [message()]);
  const headers = { Authorization: `Bearer ${store.agentToken}` };
  assert.equal((await fetch(http.url + '/api/agent/transactions')).status, 401);
  assert.equal((await fetch(http.url + '/api/agent/transactions', { headers: { Authorization: `Bearer ${store.uiToken}` } })).status, 401);
  const data = await (await fetch(http.url + '/api/agent/transactions', { headers })).json();
  assert.equal(data.transactions.length, 1); assert.equal(data.transactions[0].amount, 47.8);
  for (const forbidden of ['merchant', 'counterparty', 'cardLastDigits', 'rawMessage', 'SYNTHETIC MERCHANT', '0000']) assert.ok(!JSON.stringify(data).includes(forbidden), forbidden);
  assert.equal((await fetch(http.url + '/api/agent/summary', { headers })).status, 200);
  for (const path of ['/api/snapshot', '/api/export', '/api/import', '/api/transact']) assert.equal((await fetch(http.url + path, { headers })).status, 401);
  assert.equal((await fetch(http.url + '/api/agent/transactions', { method: 'POST', headers })).status, 405);
  assert.equal((await fetch(http.url + '/api/agent/transactions?limit=501', { headers })).status, 400);
  assert.equal((await fetch(http.url + '/api/agent/transactions?offset=-1', { headers })).status, 400);
});

test('sanitized errors, static traversal/symlink defense, CSP, no cloud fallback or tokens in export', async t => {
  const { http, store } = await httpFixture(t); const session = await login(http, store);
  const headers = { Cookie: session.cookie, Origin: http.url, 'X-Xarji-CSRF': session.body.csrf, 'Content-Type': 'application/json' };
  const response = await fetch(http.url + '/api/transact', { method: 'POST', headers, body: JSON.stringify({ operations: [{ collection: 'categories', id: 'bad', kind: 'update', value: { secretOTP: '654321' } }] }) });
  assert.equal(response.status, 400); assert.equal(await response.text(), '{"error":"Unsupported field"}');
  for (const path of ['/api/ai/stream', '/api/setup', '/api/webhook']) assert.equal((await fetch(http.url + path, { headers })).status, 404);
  assert.equal((await fetch(http.url + '/escape.txt')).status, 400);
  assert.equal((await rawRequest(http, '/%2e%2e%2fprivate.txt')).status, 400);
  const page = await fetch(http.url + '/'); assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/); assert.equal(page.headers.get('cache-control'), 'no-store');
  const exportText = await (await fetch(http.url + '/api/export', { headers })).text();
  assert.ok(!exportText.includes(store.uiToken)); assert.ok(!exportText.includes(store.agentToken)); assert.ok(!exportText.includes('rawMessage'));
  assert.equal((await fetch(http.url + '/api/exchange-rate?date=2026-10-08', { headers })).status, 404);
  assert.equal((await fetch(http.url + '/api/import', { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetch(http.url + '/api/import', { method: 'POST', headers, body: JSON.stringify({ messages: [], pad: 'x'.repeat(1024 * 1024) }) })).status, 413);
});

test('demo contains synthetic transactions and does not import its OTP sample', t => {
  const { store } = fixture(t); seedDemo(store, new Date('2026-10-08T12:00:00Z'));
  assert.equal(store.rows('payments').length, 90); assert.equal(store.rows('credits').length, 1);
  assert.ok(!JSON.stringify(store.snapshot()).includes('123456')); assert.equal(store.meta('demoSeed'), 'true');
});
