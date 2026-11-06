import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { LocalStore } from './storage.mjs';
import { startLocalServer } from './server.mjs';
import { syncMessages } from './import.mjs';
import { seedDemo } from './demo.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { 'data-dir': { type: 'string', default: resolve(repo, 'local/var') }, port: { type: 'string', default: '8721' }, demo: { type: 'boolean', default: false }, 'messages-db': { type: 'string' } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535 || (values.demo && values['messages-db'])) {
  console.error('Invalid local startup options'); process.exit(1);
}
let store;
let http;
let poll;
try {
  store = new LocalStore(values['data-dir']);
  if (values.demo) seedDemo(store);
  if (!!store.meta('demoSeed') !== values.demo) throw new Error('Separate demo and live data directories are required');
  const status = { enabled: !!values['messages-db'], error: null };
  const sync = () => {
    try { const result = syncMessages(store, values['messages-db']); status.error = null; return result; }
    catch { status.error = 'Messages unavailable or unsupported; no permissions were changed'; throw new Error('Messages unavailable'); }
  };
  http = await startLocalServer({ store, port, assetsDir: resolve(repo, 'client/dist-local'), demo: values.demo, messagesStatus: () => status, onSync: values['messages-db'] ? sync : null });
  if (values['messages-db']) {
    try { sync(); } catch { /* safe status exposed in authenticated health */ }
    poll = setInterval(() => { try { sync(); } catch { /* no message/error payload logging */ } }, 60000);
  }
  console.log(`Xarji local dashboard: ${http.url}`);
  console.log('Messages access:', values['messages-db'] ? 'explicitly enabled' : 'disabled');
  console.log('Local access token file:', resolve(store.dataDir, 'ui.token'));
  console.log('Agent read-only token file:', resolve(store.dataDir, 'agent-read.token'));
} catch {
  store?.close();
  console.error('Local startup failed. Check options, private storage permissions and the dashboard build.');
  process.exit(1);
}
async function stop() { clearInterval(poll); await http.close(); store.close(); }
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
