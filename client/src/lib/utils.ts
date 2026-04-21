import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, isToday, isYesterday, isThisWeek, isThisMonth } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string = "GEL"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency === "GEL" ? "GEL" : currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(timestamp: number): string {
  return format(new Date(timestamp), "MMM d, yyyy");
}

export function formatDateTime(timestamp: number): string {
  return format(new Date(timestamp), "MMM d, yyyy 'at' HH:mm");
}

export function getDateGroup(timestamp: number): string {
  const date = new Date(timestamp);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  if (isThisWeek(date)) return "This Week";
  if (isThisMonth(date)) return "This Month";
  return format(date, "MMMM yyyy");
}

export function groupBy<T>(array: T[], key: (item: T) => string): Record<string, T[]> {
  return array.reduce((groups, item) => {
    const group = key(item);
    groups[group] = groups[group] || [];
    groups[group].push(item);
    return groups;
  }, {} as Record<string, T[]>);
}

export interface InkCategory {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export const DEFAULT_CATEGORIES: InkCategory[] = [
  { id: "groceries",   name: "Groceries",     color: "#d4a574", icon: "◐" },
  { id: "dining",      name: "Dining",        color: "#c4502e", icon: "◑" },
  { id: "food",        name: "Delivery",      color: "#e8a05a", icon: "◒" },
  { id: "transport",   name: "Transport",     color: "#6b8e7f", icon: "◓" },
  { id: "subs",        name: "Subscriptions", color: "#8b7cb8", icon: "◔" },
  { id: "shopping",    name: "Shopping",      color: "#5b7ca8", icon: "◕" },
  { id: "travel",      name: "Travel",        color: "#a87c5b", icon: "○" },
  { id: "utilities",   name: "Utilities",     color: "#7a7a7a", icon: "●" },
  { id: "health",      name: "Health",        color: "#5ba87c", icon: "◉" },
  { id: "fun",         name: "Entertainment", color: "#b85ba8", icon: "◎" },
  { id: "loans",       name: "Loans",         color: "#a85ba8", icon: "◈" },
  { id: "cash",        name: "Cash",          color: "#9a9a9a", icon: "◌" },
  { id: "other",       name: "Other",         color: "#6b7280", icon: "·" },
];

const MERCHANT_TO_CATEGORY: Array<[RegExp, string]> = [
  // Check Loans and Cash (ATM) first — they come from the parser with stable,
  // curated merchant strings, so match on the exact phrase.
  [/^loan repayment$/i, "loans"],
  [/^atm$/i, "cash"],
  [/\b(wolt|glovo|bolt\s*food)\b/i, "food"],
  [/\b(carrefour|goodwill|metro|spar|nikora|მეტრო|ნიკორა)\b/i, "groceries"],
  [/\b(bolt|yandex|uber|taxi)\b/i, "transport"],
  [/\b(socar|gulf|petrol|fuel|tegeta\s*motor)\b/i, "transport"],
  [/\b(spotify|netflix|claude|anthropic|github|icloud|apple\.com|figma|openai|chatgpt)\b/i, "subs"],
  [/\b(silk\s*pharmacy|psp\s*pharmacy|pharmacy|fitness|gym)\b/i, "health"],
  [/\b(h&m|zara|ikea|elit|electronics|shopping|galleria)\b/i, "shopping"],
  [/\b(booking|wizz|airbnb|hotel|airline|air|flight)\b/i, "travel"],
  [/\b(magti|tegeta\s*energy|silknet|internet|bill)\b/i, "utilities"],
  [/\b(cinema|kino|theater|concert)\b/i, "fun"],
  [/\b(atm|cash)\b/i, "cash"],
  [/\b(lolita|shavi\s*lomi|stamba|cafe|café|restaurant|entrée|litera|ქაფე)\b/i, "dining"],
];

export function categorizeId(merchant: string | null | undefined, raw?: string | null): string {
  const hay = `${merchant ?? ""} ${raw ?? ""}`;
  for (const [re, id] of MERCHANT_TO_CATEGORY) {
    if (re.test(hay)) return id;
  }
  return "other";
}

export function getCategory(merchant: string | null | undefined, raw?: string | null): InkCategory {
  const id = categorizeId(merchant, raw);
  return DEFAULT_CATEGORIES.find((c) => c.id === id) || DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1];
}

export function autoCategorize(merchant: string | null | undefined): string {
  return getCategory(merchant).name;
}
