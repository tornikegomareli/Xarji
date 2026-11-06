import { parseArgs } from 'node:util';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Keep the capability in memory, never in a URL, argv, shell history or logs.
// Output is financial data. Giving it to any remote agent is a separate choice.
try {
  const { values } = parseArgs({ options: {
    'token-file': { type: 'string' }, port: { type: 'string', default: '8721' },
    summary: { type: 'boolean', default: false }, limit: { type: 'string', default: '100' }, offset: { type: 'string', default: '0' },
  } });
  const port = Number(values.port), limit = Number(values.limit), offset = Number(values.offset);
  if (!values['token-file'] || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw new Error();
  const path = resolve(values['token-file']);
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw new Error();
  const token = readFileSync(path, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error();
  const endpoint = values.summary ? 'summary' : `transactions?limit=${limit}&offset=${offset}`;
  const response = await fetch(`http://127.0.0.1:${port}/api/agent/${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error();
  console.log(JSON.stringify(await response.json(), null, 2));
} catch {
  console.error('Local read failed. Check the private agent token file, port and pagination.');
  process.exitCode = 1;
}
