/**
 * Diagnostic: show what TBC SMS messages the parser fails to handle,
 * grouped by the first non-empty line so you can spot patterns.
 *
 * Run:  bun run src/diagnose-tbc.ts
 */

import { MessagesDbReader } from "./db-reader";
import { tbcParser } from "./parsers/tbc";
import { homedir } from "os";
import { join } from "path";

const DB_PATH = join(homedir(), "Library/Messages/chat.db");
const reader = new MessagesDbReader(DB_PATH);

const allMsgs = [
  ...reader.getMessagesBySender("TBC SMS", 9999),
  ...reader.getMessagesBySender("TBC", 9999),
];

console.log(`Total TBC messages: ${allMsgs.length}`);

const unrecognized: Array<{ id: number; text: string }> = [];

for (const msg of allMsgs) {
  const result = tbcParser.parse(msg);
  if (result === null) {
    unrecognized.push({ id: msg.messageId, text: msg.text });
  }
}

console.log(`Unrecognized: ${unrecognized.length} / ${allMsgs.length}\n`);

// Group by "first meaningful line" to spot patterns
const groups: Record<string, { count: number; example: string; ids: number[] }> = {};

for (const { id, text } of unrecognized) {
  const firstLine = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? "(empty)";

  // Normalise amounts to see the structural pattern
  const key = firstLine
    .replace(/[\d.,]+\s*GEL/g, "NNN GEL")
    .replace(/[\d.,]+\s*USD/g, "NNN USD")
    .replace(/[\d.,]+\s*EUR/g, "NNN EUR")
    .replace(/\d{2}\/\d{2}\/\d{4}/g, "DD/MM/YYYY")
    .replace(/\d{6}/g, "NNNNNN") // OTP codes
    .slice(0, 80);

  if (!groups[key]) groups[key] = { count: 0, example: text, ids: [] };
  groups[key].count++;
  groups[key].ids.push(id);
}

// Print sorted by frequency
const sorted = Object.entries(groups).sort((a, b) => b[1].count - a[1].count);

console.log("=== UNRECOGNIZED patterns (sorted by frequency) ===\n");

for (const [key, { count, example, ids }] of sorted) {
  console.log(`[${count}x] Pattern: "${key}"`);
  console.log(`  IDs: ${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ` … (+${ids.length - 5} more)` : ""}`);
  console.log("  Example:");
  console.log(
    example
      .split(/\r?\n/)
      .map((l) => `    | ${l}`)
      .join("\n")
  );
  console.log();
}

reader.close();
