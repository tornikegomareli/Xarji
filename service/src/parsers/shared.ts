/**
 * Format-level helpers reused across bank parsers. Keep these pattern-agnostic —
 * each bank expresses its own regex and just calls these for the common bits.
 */

/**
 * Stable id for a transaction: `<messageId>-<hash(text)>`.
 */
export function generateTransactionId(messageId: number, text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `${messageId}-${Math.abs(hash).toString(16)}`;
}

/**
 * Parse an amount that may use European comma as the decimal separator
 * ("13345,29" => 13345.29) or the US-style dot ("13345.29").
 * Thousand separators (",") inside larger numbers are preserved for
 * US-style amounts — caller must pass the already-scoped amount string.
 */
export function parseFlexibleAmount(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  // If it looks like "13345,29" with exactly one comma and no dot, treat
  // comma as decimal point. Otherwise treat commas as thousands separators.
  const commaCount = (s.match(/,/g) || []).length;
  const dotCount = (s.match(/\./g) || []).length;

  let normalised: string;
  if (commaCount === 1 && dotCount === 0 && /,\d{1,2}$/.test(s)) {
    normalised = s.replace(",", ".");
  } else {
    normalised = s.replace(/,/g, "");
  }

  const n = parseFloat(normalised);
  return Number.isNaN(n) ? null : n;
}

/** Parse `DD.MM.YYYY`. */
export function parseDateDotted(text: string): Date | null {
  const m = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

/** Parse `DD/MM/YYYY`. */
export function parseDateSlashed(text: string): Date | null {
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

/** Try both dotted and slashed date formats. */
export function parseAnyDate(text: string): Date | null {
  return parseDateDotted(text) ?? parseDateSlashed(text);
}

/**
 * Bank SMS typically carries a calendar date ("20.04.2026") but no
 * time-of-day. The SMS metadata (when Messages.app received the text) is
 * usually seconds after the bank posted the transaction. Combine the two:
 * take the Y/M/D from the SMS body, keep the time from the message arrival.
 *
 * Without this, every parsed transaction stamps at 00:00 local, which
 * wrecks same-day ordering and always shows "00:00" in the detail drawer.
 */
export function mergeDateAndTime(ymd: Date, messageArrivedAt: Date): Date {
  return new Date(
    ymd.getFullYear(),
    ymd.getMonth(),
    ymd.getDate(),
    messageArrivedAt.getHours(),
    messageArrivedAt.getMinutes(),
    messageArrivedAt.getSeconds(),
    messageArrivedAt.getMilliseconds()
  );
}

/** Strip trailing unprintable-run + noise (TBC SMS often ends with `��iI`). */
export function stripTrailingNoise(line: string): string {
  return line
    .replace(/[�\x00-\x1f\x7f-\x9f]+.*$/u, "")
    .trim();
}
