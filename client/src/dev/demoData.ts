// Rich, deterministic demo dataset. Anchored to "now" at module load so
// the dashboard always shows current-month data regardless of recording
// date. Every default category is represented; the current month is
// crafted to trigger every signal in `useSignals`.
//
// Tree-shaken from the production bundle: only loaded via dynamic import
// from `./demoDb`, which itself is only reached behind a static
// `import.meta.env.DEV && isDemoMode()` gate in `lib/instant.ts`.

import type { Payment, FailedPayment, Credit, Category, BankSender, BudgetPlan } from "../lib/instant";
import { DEFAULT_CATEGORIES } from "../lib/utils";

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const SENDERS: BankSender[] = [
  { id: "bs-solo", senderId: "SOLO", displayName: "SOLO", enabled: true, createdAt: Date.now() - 9 * 30 * 86400000 },
  { id: "bs-tbc", senderId: "TBC", displayName: "TBC SMS", enabled: true, createdAt: Date.now() - 9 * 30 * 86400000 },
  { id: "bs-bog", senderId: "BOG", displayName: "Main", enabled: true, createdAt: Date.now() - 9 * 30 * 86400000 },
];

// Bucket assignments for the demo dataset. Hand-picked so the
// /budgets page renders a non-trivial example out of the box: a few
// Fixed (predictable subscriptions/utilities), the rest Flex
// (discretionary), one Non-Monthly (Travel — accrues to a sinking
// fund). Targets reflect realistic GEL amounts that sum into a
// flex-pool the demo income (~₾4800) actually supports.
const DEMO_BUCKET_ASSIGNMENTS: Record<
  string,
  { bucket: "fixed" | "flex" | "non_monthly"; targetAmount?: number; frequencyMonths?: number; rolloverEnabled?: boolean }
> = {
  groceries: { bucket: "flex" },
  dining: { bucket: "flex" },
  food: { bucket: "flex" },
  transport: { bucket: "flex" },
  subs: { bucket: "fixed", targetAmount: 200, rolloverEnabled: true },
  shopping: { bucket: "flex" },
  travel: { bucket: "non_monthly", targetAmount: 2400, frequencyMonths: 12 },
  utilities: { bucket: "fixed", targetAmount: 220, rolloverEnabled: false },
  health: { bucket: "flex" },
  fun: { bucket: "flex" },
  loans: { bucket: "fixed", targetAmount: 800, rolloverEnabled: false },
  cash: { bucket: "flex" },
  other: { bucket: "flex" },
};

const CATEGORIES: Category[] = DEFAULT_CATEGORIES.map((c) => {
  const bucketSpec = DEMO_BUCKET_ASSIGNMENTS[c.id];
  return {
    id: `cat-${c.id}`,
    name: c.name,
    color: c.color,
    icon: c.icon,
    isDefault: true,
    ...(bucketSpec ?? {}),
  };
});

// Merchants chosen to match every regex bucket in lib/utils.ts so the
// donut populates all 11 default categories. Amount ranges in GEL.
type MerchantSpec = { name: string; raw: string; range: [number, number] };

const MERCHANTS: MerchantSpec[] = [
  // groceries
  { name: "Carrefour", raw: "CARREFOUR EAST POINT TBILISI", range: [22, 180] },
  { name: "Goodwill", raw: "GOODWILL VAKE TBILISI GE", range: [18, 140] },
  { name: "Spar", raw: "SPAR SABURTALO TBILISI GE", range: [8, 64] },
  { name: "Nikora", raw: "NIKORA SHOP 0143 TBILISI", range: [6, 42] },
  // dining
  { name: "Lolita", raw: "LOLITA CHAVCHAVADZE 37", range: [28, 95] },
  { name: "Shavi Lomi", raw: "SHAVI LOMI 23 AMAGHLEBA", range: [45, 160] },
  { name: "Stamba Cafe", raw: "STAMBA HOTEL RESTAURANT", range: [22, 88] },
  { name: "Cafe Litera", raw: "CAFE LITERA RUSTAVELI", range: [18, 46] },
  // delivery (food)
  { name: "Wolt", raw: "WOLT.COM/HELSINKI FI", range: [12, 58] },
  { name: "Glovo", raw: "GLOVO TBILISI GE", range: [10, 42] },
  // transport
  { name: "Bolt", raw: "BOLT.EU/RYY TALLINN EE", range: [4, 22] },
  { name: "Yandex Go", raw: "YANDEX.GO MOSCOW RU", range: [5, 28] },
  { name: "SOCAR", raw: "SOCAR PETROL ST. 042", range: [60, 180] },
  { name: "Gulf", raw: "GULF GEORGIA GLDANI", range: [55, 160] },
  // shopping
  { name: "H&M", raw: "H&M EAST POINT TBILISI", range: [45, 280] },
  { name: "Zara", raw: "ZARA GALLERIA TBILISI", range: [65, 340] },
  { name: "Elit Electronics", raw: "ELIT ELECTRONICS 02", range: [40, 1200] },
  // travel
  { name: "Booking.com", raw: "BOOKING.COM AMSTERDAM NL", range: [180, 620] },
  { name: "Wizz Air", raw: "WIZZAIR.COM BUDAPEST HU", range: [240, 580] },
  // utilities
  { name: "Magti", raw: "MAGTICOM BILL PAYMENT", range: [35, 72] },
  { name: "Silknet", raw: "SILKNET INTERNET MONTHLY", range: [48, 48] },
  // health
  { name: "Silk Pharmacy", raw: "SILK PHARMACY VAKE 14", range: [14, 78] },
  { name: "PSP Pharmacy", raw: "PSP PHARMACY 024 TBILISI", range: [9, 65] },
  { name: "Fitness House", raw: "FITNESS HOUSE VAKE", range: [85, 85] },
  // entertainment (fun)
  { name: "Cinema City", raw: "CINEMA CITY GALLERIA", range: [18, 42] },
  // cash
  { name: "ATM", raw: "ATM SOLO VAKE BRANCH", range: [100, 500] },
  // loans (curated parser string)
  { name: "Loan repayment", raw: "TBC LOAN REPAYMENT MONTHLY", range: [320, 320] },
];

// Recurring monthly subscriptions — same amount every month so the
// Subscriptions category bucket fills predictably and the recurring
// pattern is visible in the merchant detail view.
const RECURRING_SUBS: { name: string; raw: string; amount: number; dayOfMonth: number }[] = [
  { name: "Spotify", raw: "SPOTIFY P2FA1B9C STOCKHOLM", amount: 17, dayOfMonth: 5 },
  { name: "Netflix", raw: "NETFLIX.COM LOS GATOS US", amount: 32, dayOfMonth: 11 },
  { name: "Claude", raw: "ANTHROPIC CLAUDE SF US", amount: 56, dayOfMonth: 15 },
  { name: "GitHub", raw: "GITHUB.COM SAN FRANCISCO", amount: 11, dayOfMonth: 22 },
  { name: "iCloud+", raw: "APPLE.COM/BILL ITUNES", amount: 8, dayOfMonth: 3 },
  { name: "Figma", raw: "FIGMA.COM SAN FRANCISCO", amount: 42, dayOfMonth: 18 },
];

const CARDS = ["1423", "8891", "2230"];
const FAIL_REASONS = [
  "insufficient funds",
  "card blocked",
  "daily limit exceeded",
  "3D-Secure timeout",
];

function buildPayments(rng: () => number, now: Date): Payment[] {
  const out: Payment[] = [];
  let n = 0;

  // 9 months of organic transactions.
  for (let daysBack = 0; daysBack < 270; daysBack++) {
    const date = new Date(now.getTime() - daysBack * 86400000);
    const weekday = date.getDay();
    const weekMul = weekday === 0 || weekday === 6 ? 1.3 : 1.0;
    const recencyMul = daysBack < 45 ? 1.0 : 0.85;
    // Dampen current-month flex spending so /budgets and the
    // Dashboard show positive net cashflow + meaningful flex
    // remaining in demos. Two levers, both ×0.5 → 0.25× total spend
    // reduction. Halving the count alone wasn't enough because
    // big-ticket merchants (Elit Electronics, Booking, Wizz Air)
    // pull the per-transaction average up; halving the per-tx
    // amount as well clips outlier impact without removing those
    // merchants from the demo entirely. Past months keep full
    // volume so the trend chart + rollover math (Phase 2) still
    // have realistic actuals to walk over.
    const inCurrentMonth =
      date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    const countMul = inCurrentMonth ? 0.5 : 1.0;
    const amountMul = inCurrentMonth ? 0.5 : 1.0;
    const count = Math.max(0, Math.round((2 + rng() * 5) * weekMul * recencyMul * countMul));

    for (let i = 0; i < count; i++) {
      const m = pick(rng, MERCHANTS);
      const rawBaseAmount = round2(m.range[0] + rng() * (m.range[1] - m.range[0]));
      const baseAmount = round2(rawBaseAmount * amountMul);
      const hour = 8 + Math.floor(rng() * 14);
      const minute = Math.floor(rng() * 60);
      date.setHours(hour, minute, Math.floor(rng() * 60));

      // ~7% USD, ~3% EUR — exercises currency filters in stats hooks.
      const r = rng();
      const currency = r < 0.07 ? "USD" : r < 0.10 ? "EUR" : "GEL";
      const amount = currency === "USD" ? round2(baseAmount / 2.7) : currency === "EUR" ? round2(baseAmount / 2.95) : baseAmount;
      const card = pick(rng, CARDS);
      const sender = pick(rng, SENDERS);

      const id = `pay-${n}-${date.getTime()}`;
      n += 1;
      out.push({
        id,
        transactionId: id,
        transactionType: "payment",
        amount,
        currency,
        merchant: m.name,
        cardLastDigits: card,
        transactionDate: date.getTime(),
        messageTimestamp: date.getTime(),
        syncedAt: Date.now(),
        plusEarned: currency === "GEL" ? Math.floor(amount * 0.5) : 0,
        bankSenderId: sender.senderId,
        rawMessage: `${sender.senderId}: ${m.raw}. თანხა: ${amount} ${currency}. ბარათი *${card}`,
      });
    }
  }

  // Recurring subs — one entry per month for the last 9 months.
  for (let monthBack = 0; monthBack < 9; monthBack++) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - monthBack, 1);
    for (const sub of RECURRING_SUBS) {
      const day = Math.min(sub.dayOfMonth, new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate());
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day, 9, 30);
      // Skip future dates within the current month.
      if (date.getTime() > now.getTime()) continue;
      const id = `sub-${sub.name.toLowerCase()}-${monthDate.getFullYear()}-${monthDate.getMonth() + 1}`;
      out.push({
        id,
        transactionId: id,
        transactionType: "payment",
        amount: sub.amount,
        currency: "GEL",
        merchant: sub.name,
        cardLastDigits: "1423",
        transactionDate: date.getTime(),
        messageTimestamp: date.getTime(),
        syncedAt: Date.now(),
        plusEarned: 0,
        bankSenderId: "SOLO",
        rawMessage: `SOLO: ${sub.raw}. თანხა: ${sub.amount} GEL. ბარათი *1423`,
      });
    }
  }

  // Current-month bait for `useSignals`:
  //   - One large outlier so largeTx[0] is dominant
  //   - One brand-new merchant absent from the prior 90 days
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dayInMonth = Math.max(1, Math.floor((now.getTime() - monthStart.getTime()) / 86400000) - 2);

  const largeId = `pay-outlier-${monthStart.getTime()}`;
  out.push({
    id: largeId,
    transactionId: largeId,
    transactionType: "payment",
    amount: 4280,
    currency: "GEL",
    merchant: "IKEA",
    cardLastDigits: "1423",
    transactionDate: monthStart.getTime() + dayInMonth * 86400000 + 14 * 3600000,
    messageTimestamp: monthStart.getTime() + dayInMonth * 86400000 + 14 * 3600000,
    syncedAt: Date.now(),
    plusEarned: 2140,
    bankSenderId: "BOG",
    rawMessage: "BOG: IKEA GLDANI 0017. თანხა: 4280 GEL. ბარათი *1423",
  });

  const newMerchantId = `pay-new-${monthStart.getTime()}`;
  out.push({
    id: newMerchantId,
    transactionId: newMerchantId,
    transactionType: "payment",
    amount: 95,
    currency: "GEL",
    merchant: "Pulse Fitness",
    cardLastDigits: "1423",
    transactionDate: now.getTime() - 2 * 86400000,
    messageTimestamp: now.getTime() - 2 * 86400000,
    syncedAt: Date.now(),
    plusEarned: 47,
    bankSenderId: "SOLO",
    rawMessage: "SOLO: PULSE FITNESS GYM. თანხა: 95 GEL. ბარათი *1423",
  });

  out.sort((a, b) => b.transactionDate - a.transactionDate);
  return out;
}

function buildFailedPayments(rng: () => number, now: Date): FailedPayment[] {
  const out: FailedPayment[] = [];
  let n = 0;

  for (let daysBack = 0; daysBack < 270; daysBack++) {
    if (rng() > 0.18) continue;
    const date = new Date(now.getTime() - daysBack * 86400000);
    const m = pick(rng, MERCHANTS);
    const card = pick(rng, CARDS);
    const sender = pick(rng, SENDERS);
    const reason = pick(rng, FAIL_REASONS);
    date.setHours(8 + Math.floor(rng() * 12), Math.floor(rng() * 60));
    const id = `fail-${n}-${date.getTime()}`;
    n += 1;
    out.push({
      id,
      transactionId: id,
      transactionType: "payment_failed",
      currency: "GEL",
      merchant: m.name,
      cardLastDigits: card,
      failureReason: reason,
      balance: round2(rng() * 200),
      transactionDate: date.getTime(),
      messageTimestamp: date.getTime(),
      syncedAt: Date.now(),
      bankSenderId: sender.senderId,
      rawMessage: `${sender.senderId}: ტრანზაქცია უარყოფილია. ${m.raw}. მიზეზი: ${reason}`,
    });
  }

  // Current-month signal bait: 2 declines at "Wolt" within 24h on the
  // same card so `repeatedDeclines` fires.
  const base = now.getTime() - 86400000;
  for (let i = 0; i < 2; i++) {
    const id = `fail-wolt-${i}`;
    out.push({
      id,
      transactionId: id,
      transactionType: "payment_failed",
      currency: "GEL",
      merchant: "Wolt",
      cardLastDigits: "8891",
      failureReason: "insufficient funds",
      balance: 4.5,
      transactionDate: base + i * 4 * 3600000,
      messageTimestamp: base + i * 4 * 3600000,
      syncedAt: Date.now(),
      bankSenderId: "SOLO",
      rawMessage: "SOLO: ტრანზაქცია უარყოფილია. WOLT.COM/HELSINKI FI. მიზეზი: insufficient funds",
    });
  }

  out.sort((a, b) => b.transactionDate - a.transactionDate);
  return out;
}

function buildCredits(rng: () => number, now: Date): Credit[] {
  const out: Credit[] = [];
  let n = 0;

  // Recurring salary: 1st and 15th of every month for 9 months.
  for (let monthBack = 0; monthBack < 9; monthBack++) {
    for (const day of [1, 15]) {
      const date = new Date(now.getFullYear(), now.getMonth() - monthBack, day, 10, 0);
      if (date.getTime() > now.getTime()) continue;
      const id = `salary-${date.getFullYear()}-${date.getMonth() + 1}-${day}`;
      out.push({
        id,
        transactionId: id,
        transactionType: "credit",
        amount: 4800,
        currency: "GEL",
        counterparty: "Tech Co LLC",
        cardLastDigits: "1423",
        transactionDate: date.getTime(),
        messageTimestamp: date.getTime(),
        syncedAt: Date.now(),
        bankSenderId: "BOG",
        rawMessage: `BOG: ჩარიცხვა Tech Co LLC. თანხა: 4800 GEL.`,
      });
    }
  }

  // Mid-month freelance invoices (variable counterparty) for variety.
  const freelanceClients = ["Design Studio", "Acme GmbH", "Northwind", "Studio Twelve", "Civic Lab"];
  for (let monthBack = 0; monthBack < 9; monthBack++) {
    const date = new Date(now.getFullYear(), now.getMonth() - monthBack, 11, 14, 30);
    if (date.getTime() > now.getTime()) continue;
    const amount = round2(800 + rng() * 1400);
    const counterparty = freelanceClients[monthBack % freelanceClients.length];
    const id = `freelance-${date.getFullYear()}-${date.getMonth() + 1}`;
    out.push({
      id,
      transactionId: id,
      transactionType: "credit",
      amount,
      currency: "GEL",
      counterparty,
      cardLastDigits: "1423",
      transactionDate: date.getTime(),
      messageTimestamp: date.getTime(),
      syncedAt: Date.now(),
      bankSenderId: "BOG",
      rawMessage: `BOG: ჩარიცხვა ${counterparty}. თანხა: ${amount} GEL.`,
    });
    n += 1;
  }

  // Current-month diversity: refunds + P2P transfers. Together with the
  // 2 salaries + freelance, this puts the current month at 5+ distinct
  // counterparties, enough to make the Income page's top-sources view
  // non-trivial. Plus one USD credit so the GEL filter has work to do.
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const extras: Array<Omit<Credit, "id" | "transactionId" | "syncedAt">> = [
    {
      transactionType: "credit",
      amount: 18,
      currency: "GEL",
      counterparty: "Wolt refund",
      cardLastDigits: "1423",
      transactionDate: monthStart.getTime() + 5 * 86400000 + 12 * 3600000,
      messageTimestamp: monthStart.getTime() + 5 * 86400000 + 12 * 3600000,
      bankSenderId: "SOLO",
      rawMessage: "SOLO: დაბრუნება Wolt. თანხა: 18 GEL.",
    },
    {
      transactionType: "credit",
      amount: 52,
      currency: "GEL",
      counterparty: "Carrefour refund",
      cardLastDigits: "1423",
      transactionDate: monthStart.getTime() + 9 * 86400000 + 9 * 3600000,
      messageTimestamp: monthStart.getTime() + 9 * 86400000 + 9 * 3600000,
      bankSenderId: "SOLO",
      rawMessage: "SOLO: დაბრუნება Carrefour. თანხა: 52 GEL.",
    },
    {
      transactionType: "credit",
      amount: 300,
      currency: "GEL",
      counterparty: "Mom",
      cardLastDigits: "1423",
      transactionDate: monthStart.getTime() + 12 * 86400000 + 18 * 3600000,
      messageTimestamp: monthStart.getTime() + 12 * 86400000 + 18 * 3600000,
      bankSenderId: "BOG",
      rawMessage: "BOG: P2P გადარიცხვა Mom. თანხა: 300 GEL.",
    },
    {
      transactionType: "credit",
      amount: 200,
      currency: "USD",
      counterparty: "Stripe Payout",
      cardLastDigits: "1423",
      transactionDate: monthStart.getTime() + 7 * 86400000 + 16 * 3600000,
      messageTimestamp: monthStart.getTime() + 7 * 86400000 + 16 * 3600000,
      bankSenderId: "BOG",
      rawMessage: "BOG: ჩარიცხვა Stripe Payout. თანხა: 200 USD.",
    },
  ];
  for (const e of extras) {
    if (e.transactionDate > now.getTime()) continue;
    const id = `credit-extra-${n}-${e.transactionDate}`;
    n += 1;
    out.push({ ...e, id, transactionId: id, syncedAt: Date.now() });
  }

  out.sort((a, b) => b.transactionDate - a.transactionDate);
  return out;
}

export interface DemoDataset {
  payments: Payment[];
  failedPayments: FailedPayment[];
  credits: Credit[];
  categories: Category[];
  bankSenders: BankSender[];
  budgetPlans: BudgetPlan[];
}

// Two months of budgetPlans seeded for the demo: the current month
// (auto-everything) plus the previous month (also auto). Two rows
// gives the rollover anchor a real value, so demo viewers see
// non-zero "carried" indicators on Fixed-with-rollover + Non-Monthly
// rows after at least one historical month exists.
function buildBudgetPlans(now: Date): BudgetPlan[] {
  const cur = new Date(now.getFullYear(), now.getMonth(), 1);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const ts = (d: Date) => d.getTime();
  return [
    {
      id: `plan-${fmt(prev)}`,
      planMonth: fmt(prev),
      expectedIncome: 0,
      expectedIncomeAuto: true,
      flexPool: 0,
      flexPoolAuto: true,
      savingsTarget: 500,
      createdAt: ts(prev),
      updatedAt: ts(prev),
    },
    {
      id: `plan-${fmt(cur)}`,
      planMonth: fmt(cur),
      expectedIncome: 0,
      expectedIncomeAuto: true,
      flexPool: 0,
      flexPoolAuto: true,
      savingsTarget: 500,
      createdAt: ts(cur),
      updatedAt: ts(cur),
    },
  ];
}

export function buildDemoDataset(seed: "default" | "empty"): DemoDataset {
  if (seed === "empty") {
    return {
      payments: [],
      failedPayments: [],
      credits: [],
      categories: [],
      bankSenders: [],
      budgetPlans: [],
    };
  }
  const rng = mulberry32(20260424);
  const now = new Date();
  return {
    payments: buildPayments(rng, now),
    failedPayments: buildFailedPayments(rng, now),
    credits: buildCredits(rng, now),
    categories: CATEGORIES,
    bankSenders: SENDERS,
    budgetPlans: buildBudgetPlans(now),
  };
}
