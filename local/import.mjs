import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tbcParser } from '../service/src/parsers/tbc.ts';
import { isSecurityMessage } from '../service/src/parsers/security.ts';
import { extractTextFromAttributedBody } from '../service/src/message-text.ts';
import { InputError, SUPPORTED_SENDERS } from './model.mjs';

export function importMessages(store, messages) {
  if (!Array.isArray(messages) || messages.length > 5000) throw new InputError('Expected up to 5000 messages');
  const enabled = new Set(store.enabledSenders());
  const stats = { received: messages.length, imported: 0, duplicate: 0, securitySkipped: 0, unsupported: 0 };
  return store.atomic(() => {
    for (const raw of messages) {
      if (!raw || typeof raw.text !== 'string' || raw.text.length > 8000 || !Number.isSafeInteger(raw.messageId) || raw.messageId < 1 || typeof raw.senderId !== 'string' || typeof raw.timestamp !== 'string') throw new InputError('Invalid message record');
      if (!enabled.has(raw.senderId) || !SUPPORTED_SENDERS.has(raw.senderId)) { stats.unsupported++; continue; }
      if (isSecurityMessage(raw.text)) { stats.securitySkipped++; continue; }
      // Local mode initially supports TBC. Other sender records are rejected
      // rather than silently pretending their parser has run.
      if (!tbcParser.senderIds.includes(raw.senderId)) { stats.unsupported++; continue; }
      const timestamp = new Date(raw.timestamp);
      if (!Number.isFinite(timestamp.getTime())) throw new InputError('Invalid timestamp');
      const tx = tbcParser.parse({ ...raw, timestamp });
      if (!tx) { stats.unsupported++; continue; }
      const fingerprint = createHash('sha256').update(`${raw.senderId}\0${raw.messageId}\0${raw.text}`).digest('hex');
      if (store.db.prepare('SELECT 1 FROM seen WHERE fingerprint=?').get(fingerprint)) { stats.duplicate++; continue; }
      const collection = tx.status === 'failed' ? 'failedPayments' : tx.direction === 'in' ? 'credits' : 'payments';
      const safe = {
        transactionId: fingerprint, transactionType: tx.transactionType, amount: tx.amount,
        currency: tx.currency, transactionDate: tx.transactionDate.getTime(),
        messageTimestamp: timestamp.getTime(), syncedAt: Date.now(), bankSenderId: raw.senderId,
      };
      // Construct an allowlist: raw SMS, balances, failure text and account
      // identifiers never reach SQLite, logs, exports or the agent interface.
      const name = tx.merchant ?? tx.counterparty;
      if (name) safe[collection === 'credits' ? 'counterparty' : 'merchant'] = name.slice(0, 200);
      if (tx.cardLastDigits && /^\d{3,4}$/.test(tx.cardLastDigits)) safe.cardLastDigits = tx.cardLastDigits;
      store.put(collection, fingerprint, safe);
      store.db.prepare('INSERT INTO seen VALUES(?)').run(fingerprint);
      stats.imported++;
    }
    store.meta('lastImport', new Date().toISOString());
    return stats;
  });
}

/** This function is never called unless the operator explicitly passes a Messages path. */
export function syncMessages(store, messagesPath) {
  const source = new DatabaseSync(messagesPath, { readOnly: true, allowExtension: false, timeout: 1000 });
  const stats = { received: 0, imported: 0, duplicate: 0, securitySkipped: 0, unsupported: 0 };
  try {
    for (const senderId of store.enabledSenders()) {
      if (!tbcParser.senderIds.includes(senderId)) continue;
      let cursor = store.cursor(senderId);
      let batches = 0;
      // Advance over every inspected message, including OTP/unrecognised rows;
      // bounded pagination prevents a bank's older non-payment SMS blocking new ones.
      while (batches++ < 20) {
        const rows = source.prepare(`SELECT m.ROWID AS messageId,m.text,m.attributedBody,CAST(m.date AS REAL) AS date
          FROM message m JOIN handle h ON m.handle_id=h.ROWID
          WHERE h.id=? AND m.is_from_me=0 AND m.ROWID>? ORDER BY m.ROWID LIMIT 1000`).all(senderId, cursor);
        if (!rows.length) break;
        const messages = [];
        let skippedBlobs = 0;
        for (const row of rows) {
          // Check the entire decoded blob before the legacy extractor can
          // trim trailing metadata/text. A mixed payment + OTP must be skipped.
          const blob = row.attributedBody;
          if (blob && blob.length > 65536) continue;
          if (blob && isSecurityMessage(new TextDecoder().decode(blob))) {
            stats.securitySkipped++; stats.received++; skippedBlobs++; continue;
          }
          const text = row.text || extractTextFromAttributedBody(blob);
          if (!text || text.length > 8000) continue;
          messages.push({ messageId: row.messageId, senderId, text, timestamp: new Date(Number(row.date) / 1e6 + 978307200000).toISOString() });
        }
        const result = importMessages(store, messages);
        for (const key of Object.keys(stats)) stats[key] += result[key];
        stats.unsupported += rows.length - messages.length - skippedBlobs;
        stats.received += rows.length - messages.length - skippedBlobs;
        cursor = rows.at(-1).messageId;
        store.cursor(senderId, cursor);
      }
    }
    return stats;
  } finally { source.close(); }
}
