import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { InputError, agentRow, TRANSACTIONS } from './model.mjs';
import { importMessages } from './import.mjs';

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
function matches(value, expected) {
  if (typeof value !== 'string' || value.length !== expected.length) return false;
  const actual = Buffer.from(value);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
function bearer(req) { return /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '')?.[1]; }
function sessionId(req) { return /(?:^|;\s*)xarji_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1]; }
function respond(res, status, value, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new InputError('JSON content type required', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new InputError('Request too large', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InputError('Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('JSON object required');
  return value;
}

export async function startLocalServer({ store, port = 8721, assetsDir, messagesStatus = () => ({ enabled: false, error: null }), onSync = null, demo = false }) {
  const sessions = new Map();
  let authFailures = [];
  let origin;
  let authority;
  const root = resolve(assetsDir);
  const server = createServer(async (req, res) => {
    try {
      // Validate Host before serving even the login page. No wildcard localhost,
      // proxy headers, alternate authorities or absolute-form requests.
      const hostCount = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host').length;
      if (req.socket.remoteAddress !== '127.0.0.1' || hostCount !== 1 || req.headers.host !== authority || req.headers['x-forwarded-host'] || req.headers['x-forwarded-for'] || !req.url.startsWith('/') || req.url.startsWith('//')) throw new InputError('Invalid local host', 403);
      if (req.headers.origin && req.headers.origin !== origin) throw new InputError('Origin forbidden', 403);
      if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) throw new InputError('Cross-site request forbidden', 403);
      const url = new URL(req.url, origin);
      const path = url.pathname;
      if (req.method === 'OPTIONS') throw new InputError('Cross-origin API access is disabled', 403);
      if (req.method === 'GET' && path === '/api/health') {
        const authenticated = sessions.get(sessionId(req))?.expires > Date.now();
        return respond(res, 200, authenticated ? { state: 'running', mode: 'local', demo, senders: store.enabledSenders(), transactionCount: [...TRANSACTIONS].reduce((sum, name) => sum + store.rows(name).length, 0), lastSync: store.meta('lastImport'), running: true, messages: messagesStatus() } : { state: 'locked', mode: 'local' });
      }
      if (path.startsWith('/api/agent/')) {
        if (req.method !== 'GET') throw new InputError('Agent interface is read-only', 405);
        if (!matches(bearer(req), store.agentToken)) throw new InputError('Authentication required', 401);
        const rows = [...TRANSACTIONS].flatMap(name => store.rows(name).map(row => agentRow(row, name)));
        if (path === '/api/agent/transactions') {
          const limit = Number(url.searchParams.get('limit') ?? 100);
          const offset = Number(url.searchParams.get('offset') ?? 0);
          if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw new InputError('Invalid pagination');
          return respond(res, 200, { source: 'bank SMS; may be incomplete', total: rows.length, transactions: rows.sort((a, b) => b.transactionDate - a.transactionDate).slice(offset, offset + limit) });
        }
        if (path === '/api/agent/summary') {
          const totals = {};
          for (const row of rows) {
            if (row.collection === 'failedPayments' || row.excludedFromAnalytics) continue;
            const group = totals[row.currency] ??= { incoming: 0, outgoing: 0, count: 0 };
            group[row.collection === 'credits' ? 'incoming' : 'outgoing'] += row.amount;
            group.count++;
          }
          return respond(res, 200, { source: 'bank SMS; may be incomplete', totals });
        }
        throw new InputError('Unknown endpoint', 404);
      }
      const session = sessions.get(sessionId(req));
      const authenticated = session?.expires > Date.now();
      if (path === '/api/session' && req.method === 'POST') {
        if (req.headers.origin !== origin) throw new InputError('Origin required', 403);
        await body(req);
        authFailures = authFailures.filter(time => time > Date.now() - 60000);
        if (authFailures.length >= 10) throw new InputError('Try again later', 429);
        if (!matches(bearer(req), store.uiToken)) { authFailures.push(Date.now()); throw new InputError('Authentication required', 401); }
        for (const [id, value] of sessions) if (value.expires <= Date.now()) sessions.delete(id);
        if (sessions.size >= 8) sessions.delete(sessions.keys().next().value);
        const id = randomBytes(32).toString('hex');
        const csrf = randomBytes(32).toString('hex');
        sessions.set(id, { csrf, expires: Date.now() + 8 * 3600000 });
        return respond(res, 200, { authenticated: true, csrf }, { 'set-cookie': `xarji_session=${id}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800` });
      }
      if (path.startsWith('/api/')) {
        if (!authenticated) throw new InputError('Authentication required', 401);
        if (req.method !== 'GET') {
          if (req.headers.origin !== origin || !matches(req.headers['x-xarji-csrf'], session.csrf)) throw new InputError('CSRF verification required', 403);
        }
        if (path === '/api/session' && req.method === 'GET') return respond(res, 200, { authenticated: true, csrf: session.csrf });
        if (path === '/api/session' && req.method === 'DELETE') {
          sessions.delete(sessionId(req));
          return respond(res, 200, { ok: true }, { 'set-cookie': 'xarji_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0' });
        }
        if (path === '/api/snapshot' && req.method === 'GET') return respond(res, 200, { data: store.snapshot() });
        if (path === '/api/export' && req.method === 'GET') return respond(res, 200, { formatVersion: 1, source: 'bank SMS; may be incomplete', data: store.snapshot() });
        if (path === '/api/transact' && req.method === 'POST') {
          const input = await body(req);
          store.transact(input.operations);
          return respond(res, 200, { ok: true });
        }
        if (path === '/api/import' && req.method === 'POST') {
          const input = await body(req);
          return respond(res, 200, importMessages(store, input.messages));
        }
        if (path === '/api/sync' && req.method === 'POST') {
          await body(req);
          if (!onSync) throw new InputError('Messages access is disabled; use manual import', 409);
          return respond(res, 200, onSync());
        }
        if (path === '/api/exchange-rate' && req.method === 'GET') {
          const date = url.searchParams.get('date');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new InputError('Invalid date');
          const rates = {};
          for (const row of store.rows('exchangeRates').filter(r => r.date === date)) rates[row.currency] = { rate: row.rate };
          if (!Object.keys(rates).length) throw new InputError('No local exchange rate for this date', 404);
          return respond(res, 200, { ok: true, date, rates });
        }
        throw new InputError('Unknown endpoint', 404);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new InputError('Method not allowed', 405);
      const decoded = decodeURIComponent(path);
      if (decoded.includes('\0') || decoded.split('/').some(part => part === '..')) throw new InputError('Invalid path', 400);
      let target = resolve(root, decoded.replace(/^\/+/, '') || 'index.html');
      if (!target.startsWith(root + sep)) throw new InputError('Invalid path', 400);
      try { target = await realpath(target); } catch {
        if (extname(decoded)) throw new InputError('Not found', 404);
        target = await realpath(resolve(root, 'index.html'));
      }
      if (!target.startsWith(root + sep)) throw new InputError('Invalid path', 400);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
      const data = await readFile(target);
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': types[extname(target)] ?? 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      // No raw message, bearer token, request body, path or DB error is logged.
      if (!res.headersSent) respond(res, error instanceof InputError ? error.status : 500, { error: error instanceof InputError ? error.message : 'Local operation failed' });
      else res.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  authority = `127.0.0.1:${server.address().port}`;
  origin = `http://${authority}`;
  return { server, url: origin, close: () => new Promise(done => server.close(done)) };
}
