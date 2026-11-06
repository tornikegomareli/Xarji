import { DatabaseSync } from 'node:sqlite';
import { constants, existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { COLLECTIONS, TRANSACTIONS, UNIQUE_FIELDS, InputError, validatedFields } from './model.mjs';

function privatePath(path, directory = false) {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) ||
      (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o077)) {
    throw new Error('Local storage must be owned by the current user, private and not symlinked');
  }
}

export class LocalStore {
  constructor(dataDir) {
    process.umask(0o077);
    this.dataDir = resolve(dataDir);
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { mode: 0o700, recursive: true });
    privatePath(this.dataDir, true);
    this.dbPath = join(this.dataDir, 'ledger.sqlite');
    for (const path of [this.dbPath, `${this.dbPath}-wal`, `${this.dbPath}-shm`]) {
      if (existsSync(path)) privatePath(path);
    }
    if (!existsSync(this.dbPath)) {
      closeSync(openSync(this.dbPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600));
    }
    this.db = new DatabaseSync(this.dbPath, { allowExtension: false, timeout: 1000 });
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS records(collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(collection,id));
      CREATE TABLE IF NOT EXISTS seen(fingerprint TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS cursors(sender TEXT PRIMARY KEY, last_id INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.uiToken = this.token('ui.token');
    this.agentToken = this.token('agent-read.token');
    if (this.uiToken === this.agentToken) throw new Error('UI and agent capabilities must differ');
    if (!this.rows('bankSenders').length) {
      this.put('bankSenders', 'tbc-sms', { senderId: 'TBC SMS', displayName: 'TBC Bank', enabled: true, createdAt: Date.now() });
      this.put('bankSenders', 'tbc-alias', { senderId: 'TBC', displayName: 'TBC Bank (alternate sender)', enabled: false, createdAt: Date.now() });
    }
  }
  token(name) {
    const path = join(this.dataDir, name);
    if (!existsSync(path)) {
      const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, randomBytes(32).toString('hex') + '\n'); } finally { closeSync(fd); }
    }
    privatePath(path);
    const token = readFileSync(path, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid local capability file');
    return token;
  }
  rows(collection) {
    if (!Object.hasOwn(COLLECTIONS, collection)) throw new InputError('Unknown collection');
    return this.db.prepare('SELECT id,data FROM records WHERE collection=? ORDER BY id').all(collection).map(r => ({ ...JSON.parse(r.data), id: r.id }));
  }
  get(collection, id) {
    const row = this.db.prepare('SELECT data FROM records WHERE collection=? AND id=?').get(collection, id);
    return row ? { ...JSON.parse(row.data), id } : null;
  }
  put(collection, id, value) {
    const clean = validatedFields(collection, value);
    const field = UNIQUE_FIELDS[collection];
    if (field && clean[field] !== undefined && this.rows(collection).some(r => r.id !== id && r[field] === clean[field])) throw new InputError('Duplicate value');
    this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data').run(collection, id, JSON.stringify(clean));
  }
  atomic(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  snapshot() { return Object.fromEntries(Object.keys(COLLECTIONS).map(name => [name, this.rows(name)])); }
  transact(operations) {
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 500) throw new InputError('Invalid operation count');
    this.atomic(() => {
      for (const op of operations) {
        if (!op || !Object.hasOwn(COLLECTIONS, op.collection) || typeof op.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(op.id)) throw new InputError();
        if (op.kind === 'delete') {
          this.db.prepare('DELETE FROM records WHERE collection=? AND id=?').run(op.collection, op.id);
          // seen is independent of records: deleting a transaction cannot re-import it.
          continue;
        }
        if (op.kind !== 'update') throw new InputError('Invalid operation');
        const value = validatedFields(op.collection, op.value);
        const existing = this.get(op.collection, op.id);
        if (TRANSACTIONS.has(op.collection)) {
          if (!existing || Object.keys(value).some(key => key !== 'excludedFromAnalytics')) throw new InputError('Imported transaction fields are read-only');
        }
        const merged = { ...existing, ...value };
        const unset = op.unset ?? [];
        const clearable = op.collection === 'categories' ? ['bucket', 'targetAmount', 'frequencyMonths', 'rolloverEnabled'] : [];
        if (!Array.isArray(unset) || unset.some(key => !clearable.includes(key))) throw new InputError('Unsupported field removal');
        for (const key of unset) delete merged[key];
        if (!existing) {
          const required = { categories: ['name', 'color', 'icon', 'isDefault'], bankSenders: ['senderId', 'displayName', 'enabled', 'createdAt'], budgetPlans: ['planMonth', 'expectedIncome', 'expectedIncomeAuto', 'flexPool', 'flexPoolAuto', 'createdAt', 'updatedAt'], mustPayItems: ['title', 'amountGEL', 'isRecurring', 'createdAt', 'updatedAt'], mustPayState: ['key', 'currentPotGEL', 'updatedAt'], merchantCategoryOverrides: ['merchant', 'categoryId', 'createdAt'], transactionCategoryOverrides: ['paymentId', 'categoryId', 'createdAt'], exchangeRates: ['date', 'currency', 'rate'] }[op.collection] ?? [];
          if (required.some(key => merged[key] === undefined)) throw new InputError('Missing required field');
        }
        this.put(op.collection, op.id, merged);
      }
    });
  }
  meta(key, value) {
    if (value !== undefined) this.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
    return this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value ?? null;
  }
  cursor(sender, value) {
    if (value !== undefined) this.db.prepare('INSERT INTO cursors VALUES(?,?) ON CONFLICT(sender) DO UPDATE SET last_id=excluded.last_id').run(sender, value);
    return this.db.prepare('SELECT last_id FROM cursors WHERE sender=?').get(sender)?.last_id ?? 0;
  }
  enabledSenders() { return this.rows('bankSenders').filter(s => s.enabled).map(s => s.senderId); }
  close() { this.db.close(); }
}
