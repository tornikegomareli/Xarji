import { Database } from "bun:sqlite";
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

/**
 * Extract plain text from attributedBody blob
 * Modern macOS stores message text in attributedBody as a streamtyped NSAttributedString
 */
function extractTextFromAttributedBody(
  attributedBody: Uint8Array | null
): string | null {
  if (!attributedBody) return null;

  try {
    // Convert to string for searching
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const dataStr = decoder.decode(attributedBody);

    // Find NSString marker
    const nsStringMarker = "NSString";
    const pos = dataStr.indexOf(nsStringMarker);

    if (pos !== -1) {
      const searchStart = pos + nsStringMarker.length;
      const dataAfter = dataStr.slice(searchStart, searchStart + 500);

      // Look for '+' marker followed by length byte
      const plusPos = dataAfter.indexOf("+");
      if (plusPos !== -1 && plusPos < 20) {
        const textStart = plusPos + 2;
        const decoded = dataAfter.slice(textStart);

        // Find end of text (before metadata markers)
        const endMarkers = ["NSDictionary", "\x86\x84", "\x92\x84"];
        let endPos = decoded.length;

        for (const marker of endMarkers) {
          const markerPos = decoded.indexOf(marker);
          if (markerPos !== -1 && markerPos < endPos) {
            endPos = markerPos;
          }
        }

        let text = decoded.slice(0, endPos).trim();

        // Clean up - keep only valid characters
        const cleanChars: string[] = [];
        for (const char of text) {
          const code = char.charCodeAt(0);
          if (char === "\n" || char === "\r") {
            cleanChars.push(char);
          } else if (code >= 32 && code <= 126) {
            // Printable ASCII
            cleanChars.push(char);
          } else if (code >= 0x10a0 && code <= 0x10ff) {
            // Georgian
            cleanChars.push(char);
          } else if (code > 127 && /\p{L}|\p{N}|\p{P}|\p{S}/u.test(char)) {
            // Other printable unicode
            cleanChars.push(char);
          }
        }

        let cleanText = cleanChars.join("").trim();

        // Remove trailing garbage after date
        const dateMatch = cleanText.match(/(\d{2}\.\d{2}\.\d{4})/);
        if (dateMatch && dateMatch.index !== undefined) {
          cleanText = cleanText.slice(0, dateMatch.index + dateMatch[0].length);
        } else {
          // Remove trailing garbage patterns
          cleanText = cleanText
            .replace(/[\x00-\x1f\ufffd]+[a-zA-Z]{1,3}[\x00-\x1f\ufffd*]+$/, "")
            .replace(/[\ufffd\x00-\x03]+$/, "");
        }

        cleanText = cleanText.replace(/^[\ufffd\x00]+/, "");

        if (cleanText && cleanText.length > 3) {
          return cleanText;
        }
      }
    }

    // Fallback: look for Georgian text patterns
    const georgianPattern =
      /([\u10A0-\u10FF][\u10A0-\u10FF\w\s:.,\-\d>*\n]+)/;
    const match = dataStr.match(georgianPattern);
    if (match) {
      const start = match.index!;
      const extended = dataStr.slice(start, start + 500);
      const dateMatch = extended.match(/\d{2}\.\d{2}\.\d{4}/);
      if (dateMatch && dateMatch.index !== undefined) {
        return extended.slice(0, dateMatch.index + dateMatch[0].length).trim();
      }
      return match[1].trim();
    }

    return null;
  } catch {
    return null;
  }
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
    limit: number = 10000
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
      ORDER BY m.date ASC
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
