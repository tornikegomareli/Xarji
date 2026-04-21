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
