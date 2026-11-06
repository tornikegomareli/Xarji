import { Database } from "bun:sqlite";
import { extractTextFromAttributedBody } from "./message-text.ts";
import { isSecurityMessage } from "./parsers/security.ts";
import { defaultConfig, type Config } from "./config";

// Apple epoch offset (2001-01-01 vs 1970-01-01)
const APPLE_EPOCH_OFFSET = 978307200;

export interface RawMessage {
  messageId: number;
  text: string;
  timestamp: Date;
  senderId: string;
}

/**
 * Convert Apple Core Data timestamp to JavaScript Date
 * Apple timestamps are in nanoseconds since 2001-01-01
 */
function convertAppleTimestamp(appleTimestamp: number): Date {
  const unixTimestamp = appleTimestamp / 1_000_000_000 + APPLE_EPOCH_OFFSET;
  return new Date(unixTimestamp * 1000);
}


export class MessagesDbReader {
  private db: Database;

  constructor(dbPath: string = defaultConfig.messagesDbPath) {
    // Open in read-only mode
    this.db = new Database(dbPath, { readonly: true });
  }

  /**
   * List all unique senders in the database
   */
  listSenders(limit: number = 100): Array<{ senderId: string; count: number }> {
    const query = `
      SELECT
        h.id as sender_id,
        COUNT(m.ROWID) as message_count
      FROM handle h
      LEFT JOIN message m ON m.handle_id = h.ROWID
      WHERE h.id IS NOT NULL
      GROUP BY h.id
      ORDER BY message_count DESC
      LIMIT ?
    `;

    const rows = this.db.query(query).all(limit) as Array<{
      sender_id: string;
      message_count: number;
    }>;

    return rows.map((r) => ({
      senderId: r.sender_id,
      count: r.message_count,
    }));
  }

  /**
   * Get messages from a specific sender
   */
  getMessagesBySender(senderId: string, limit: number = 50): RawMessage[] {
    const query = `
      SELECT
        m.ROWID as message_id,
        m.text,
        m.attributedBody,
        m.date as timestamp,
        h.id as sender_id
      FROM message m
      JOIN handle h ON m.handle_id = h.ROWID
      WHERE h.id = ?
      ORDER BY m.date DESC
      LIMIT ?
    `;

    const rows = this.db.query(query).all(senderId, limit) as Array<{
      message_id: number;
      text: string | null;
      attributedBody: Uint8Array | null;
      timestamp: number;
      sender_id: string;
    }>;

    const messages: RawMessage[] = [];

    for (const row of rows) {
      if (isSecurityMessage(row.text ?? "") || (row.attributedBody && isSecurityMessage(new TextDecoder().decode(row.attributedBody)))) continue;
      let text = row.text;
      if (!text && row.attributedBody) {
        text = extractTextFromAttributedBody(row.attributedBody);
      }

      if (text) {
        messages.push({
          messageId: row.message_id,
          text,
          timestamp: convertAppleTimestamp(row.timestamp),
          senderId: row.sender_id,
        });
      }
    }

    return messages;
  }

  /**
   * Get messages from sender since a specific message ID
   * Used for incremental sync
   */
  getMessagesSince(
    senderId: string,
    sinceMessageId: number,
    limit: number = 1000
  ): RawMessage[] {
    const query = `
      SELECT
        m.ROWID as message_id,
        m.text,
        m.attributedBody,
        m.date as timestamp,
        h.id as sender_id
      FROM message m
      JOIN handle h ON m.handle_id = h.ROWID
      WHERE h.id = ?
        AND m.ROWID > ?
      ORDER BY m.ROWID ASC
      LIMIT ?
    `;

    const rows = this.db.query(query).all(senderId, sinceMessageId, limit) as Array<{
      message_id: number;
      text: string | null;
      attributedBody: Uint8Array | null;
      timestamp: number;
      sender_id: string;
    }>;

    const messages: RawMessage[] = [];

    for (const row of rows) {
      if (isSecurityMessage(row.text ?? "") || (row.attributedBody && isSecurityMessage(new TextDecoder().decode(row.attributedBody)))) continue;
      let text = row.text;
      if (!text && row.attributedBody) {
        text = extractTextFromAttributedBody(row.attributedBody);
      }

      if (text) {
        messages.push({
          messageId: row.message_id,
          text,
          timestamp: convertAppleTimestamp(row.timestamp),
          senderId: row.sender_id,
        });
      }
    }

    return messages;
  }

  /**
   * Get the latest message ID for a sender
   */
  getLatestMessageId(senderId: string): number {
    const query = `
      SELECT MAX(m.ROWID) as max_id
      FROM message m
      JOIN handle h ON m.handle_id = h.ROWID
      WHERE h.id = ?
    `;

    const row = this.db.query(query).get(senderId) as { max_id: number | null };
    return row?.max_id ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
