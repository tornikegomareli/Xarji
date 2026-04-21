export function formatGEL(n: number, opts: { decimals?: number; symbol?: string } = {}) {
  const { decimals = 2, symbol = "₾" } = opts;
  const rounded = Math.round(n * 100) / 100;
  return symbol + rounded.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatCompact(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n).toString();
}

export function formatTime(ts: number) {
  return new Date(ts).toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * "YYYY-MM-DD" built from the local date components. `toISOString().slice(0,10)`
 * silently buckets overnight transactions into the UTC day, which wrong-days
 * them for anyone outside UTC (Tbilisi is UTC+4, so tx between 20:00 and
 * 23:59 local get filed under tomorrow). Use this helper wherever a
 * calendar-day key is needed.
 */
export function formatLocalDay(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Parse a "YYYY-MM-DD" key produced by formatLocalDay back into a Date at
 * local midnight. `new Date("2026-04-21")` by contrast parses as UTC
 * midnight, which would drift the date by the local offset.
 */
export function parseLocalDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function monthKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return new Date(+y, +m - 1, 1).toLocaleString("en-US", { month: "short" });
}

export function currencySymbol(currency: string) {
  if (currency === "GEL") return "₾";
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return currency + " ";
}
