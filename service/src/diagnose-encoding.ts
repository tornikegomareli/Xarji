/**
 * Get exact codepoints for loan partial, failure reason label,
 * account-from label, balance label, and new type amount label.
 */

import { MessagesDbReader } from "./db-reader";
import { tbcParser } from "./parsers/tbc";
import { homedir } from "os";
import { join } from "path";

const DB_PATH = join(homedir(), "Library/Messages/chat.db");
const reader = new MessagesDbReader(DB_PATH);
const msgs = reader.getMessagesBySender("TBC SMS", 9999);

function escape(s: string): string {
  return [...s].map(c => {
    const cp = c.codePointAt(0)!;
    if (cp > 0x7E) return `\\u${cp.toString(16).toUpperCase().padStart(4, "0")}`;
    return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
}

// Print every distinct line that appears in parsed+unrecognized messages
// that could be a "label: value" pattern for amount, reason, account, balance.
const linesSeen = new Set<string>();

for (const msg of msgs) {
  for (const line of msg.text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || linesSeen.has(t)) continue;
    // Only lines that look like "SomeLabel: something"
    if (!/^[^\d\s*!][^:]{2,25}:/.test(t)) continue;
    // Skip lines that are pure ASCII
    if (!/[\u10D0-\u10FF]/.test(t)) continue;
    linesSeen.add(t);
    const label = t.split(":")[0].trim();
    console.log(`// "${label}:" → /${escape(label)}:/`);
  }
}

reader.close();
