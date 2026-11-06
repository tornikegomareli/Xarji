import { init, i } from "@instantdb/react";
import { isDemoMode, getDemoSeed } from "../dev/demoMode";

// Define the schema
const schema = i.schema({
  entities: {
    payments: i.entity({
      transactionId: i.string().unique(),
      transactionType: i.string(),
      amount: i.number().indexed(),
      currency: i.string().indexed(),
      merchant: i.string().optional().indexed(),
      cardLastDigits: i.string().optional(),
      transactionDate: i.number().indexed(),
      messageTimestamp: i.number(),
      syncedAt: i.number(),
      plusEarned: i.number().optional(),
      plusTotal: i.number().optional(),
      bankSenderId: i.string().indexed(),
      rawMessage: i.string(),
      // User-toggled flag that hides this transaction from spending
      // aggregates (Dashboard hero, donut, top-merchants, trends,
      // signals). The transaction stays visible in the /transactions
      // ledger with a small "excluded" pill so the user can audit
      // and un-hide it. Optional / defaults to false for existing
      // rows that predate this field.
      excludedFromAnalytics: i.boolean().optional(),
    }),
    failedPayments: i.entity({
      transactionId: i.string().unique(),
      transactionType: i.string(),
      currency: i.string().indexed(),
      merchant: i.string().optional().indexed(),
      cardLastDigits: i.string().optional(),
      failureReason: i.string().optional(),
      balance: i.number().optional(),
      transactionDate: i.number().indexed(),
      messageTimestamp: i.number(),
      syncedAt: i.number(),
      bankSenderId: i.string().indexed(),
      rawMessage: i.string(),
    }),
    categories: i.entity({
      name: i.string(),
      color: i.string(),
      icon: i.string(),
      isDefault: i.boolean(),
      // Flex-budgeting fields (all optional, all client-managed). See
      // service-side schema for full descriptions. Categories without
      // a `bucket` are unclassified and only show in the /budgets
      // setup wizard.
      bucket: i.string().optional(),
      targetAmount: i.number().optional(),
      frequencyMonths: i.number().optional(),
      rolloverEnabled: i.boolean().optional(),
    }),
    // Per-month flex-budgeting plan, keyed on "YYYY-MM". Holds the
    // user's expected-income override + flex-pool override + savings
    // target for that month. Phase 1 reads/writes only the current
    // month; Phase 2 walks prior months for rollover math.
    budgetPlans: i.entity({
      planMonth: i.string().unique(),
      expectedIncome: i.number(),
      expectedIncomeAuto: i.boolean(),
      flexPool: i.number(),
      flexPoolAuto: i.boolean(),
      savingsTarget: i.number().optional(),
      createdAt: i.number(),
      updatedAt: i.number(),
    }),
    bankSenders: i.entity({
      senderId: i.string().unique(),
      displayName: i.string(),
      enabled: i.boolean(),
      createdAt: i.number(),
    }),
    // Manual category overrides per merchant — see service-side
    // schema for the rationale; this is the client-side mirror so
    // db.useQuery is typed.
    merchantCategoryOverrides: i.entity({
      merchant: i.string().unique(),
      categoryId: i.string(),
      createdAt: i.number(),
    }),
    transactionCategoryOverrides: i.entity({
      paymentId: i.string().unique(),
      categoryId: i.string(),
      createdAt: i.number(),
    }),
    // Free-form "things I owe" list. Not derived from SMS — the user
    // types these in directly. Used by the Must Pay page to give them
    // a glance at obligations vs the wallet pot before they spend.
    mustPayItems: i.entity({
      title: i.string(),
      amountGEL: i.number(),
      // null = never paid (still pending). Number = epoch ms of the
      // most recent mark-paid click. Derived paid state is computed in
      // useMustPay.isItemPaidThisCycle so recurring items auto-reset on
      // month rollover without a cron.
      lastPaidAt: i.number().optional(),
      isRecurring: i.boolean(),
      notes: i.string().optional(),
      dueDate: i.number().optional(),
      createdAt: i.number(),
      updatedAt: i.number(),
    }),
    // Singleton row holding the user's current "pot" — how much money
    // they have right now. Subtracted from the pending obligations
    // total to surface the headline "free" figure on the Must Pay
    // page. Keyed "singleton" with a unique constraint so concurrent
    // upserts can't duplicate it.
    mustPayState: i.entity({
      key: i.string().unique(),
      currentPotGEL: i.number(),
      updatedAt: i.number(),
    }),
    credits: i.entity({
      transactionId: i.string().unique(),
      transactionType: i.string(),
      amount: i.number().indexed(),
      currency: i.string().indexed(),
      counterparty: i.string().optional().indexed(),
      cardLastDigits: i.string().optional(),
      transactionDate: i.number().indexed(),
      messageTimestamp: i.number(),
      syncedAt: i.number(),
      bankSenderId: i.string().indexed(),
      rawMessage: i.string(),
      // Same as payments.excludedFromAnalytics — hides the credit
      // from Income aggregates while keeping it visible in the
      // /income ledger with an excluded indicator.
      excludedFromAnalytics: i.boolean().optional(),
    }),
  },
  links: {},
});

// Resolve the InstantDB app id at page-load time. Order of resolution:
//   1. window.__XARJI_APP_ID__  (runtime-injected by xarji-core in the
//                                compiled binary; matches ~/.xarji/config.json)
//   2. /api/config              (dev-mode fallback — Vite serves the HTML
//                                so step 1 never fires; this fetches the
//                                live config directly from the bun service)
//   3. VITE_INSTANT_APP_ID      (build-time env, only if the API is
//                                unreachable at boot)
//   4. Hard-coded sentinel      (will produce an obvious failure)
//
// Why the fetch (step 2): we used to rely on writing client/.env from
// applySetup so Vite would restart and bake the new id in. That cascaded
// into killing the setup POST mid-flight. Removing the .env write means
// Vite no longer restarts; we just ask the service for the current id.
declare global {
  interface Window {
    __XARJI_APP_ID__?: string;
  }
}

async function resolveAppId(): Promise<string> {
  if (typeof window !== "undefined" && window.__XARJI_APP_ID__) {
    return window.__XARJI_APP_ID__;
  }
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const body = (await res.json()) as { instantdb?: { appId?: string } };
      const fromApi = body?.instantdb?.appId;
      if (fromApi) return fromApi;
    }
  } catch {
    // Service unreachable at boot — fall through to env / sentinel.
  }
  return import.meta.env.VITE_INSTANT_APP_ID || "f78a0d50-1945-431a-91ea-96f68570d4a5";
}

type Db = ReturnType<typeof init<typeof schema>>;

// Dev-only demo mode: when active, swap the live InstantDB client for a
// mutable in-memory fake (see ../dev/demoDb). The static `import.meta.env.DEV`
// literal short-circuits in production builds, so Vite/Rollup tree-shake
// the dynamic import + the dev module + the fixtures out of the bundle.
let _db: Db;
if (import.meta.env.DEV && isDemoMode()) {
  const { makeDemoDb } = await import("../dev/demoDb");
  _db = makeDemoDb(getDemoSeed()) as unknown as Db;
} else {
  const APP_ID = await resolveAppId();
  _db = init({ appId: APP_ID, schema });
}

export const db: Db = _db;

// Export types for use in components (using undefined for optional fields to match InstantDB)
export type Payment = {
  id: string;
  transactionId: string;
  transactionType: string;
  amount: number;
  currency: string;
  merchant?: string;
  cardLastDigits?: string;
  transactionDate: number;
  messageTimestamp: number;
  syncedAt: number;
  plusEarned?: number;
  plusTotal?: number;
  bankSenderId: string;
  rawMessage: string;
  excludedFromAnalytics?: boolean;
};

export type FailedPayment = {
  id: string;
  transactionId: string;
  transactionType: string;
  currency: string;
  merchant?: string;
  cardLastDigits?: string;
  failureReason?: string;
  balance?: number;
  transactionDate: number;
  messageTimestamp: number;
  syncedAt: number;
  bankSenderId: string;
  rawMessage: string;
};

export type Category = {
  id: string;
  name: string;
  color: string;
  icon: string;
  isDefault: boolean;
  // Stored as a free-form string in InstantDB (the schema's
  // `i.string().optional()` resolves to `string | undefined` at the
  // type level). Consumers narrow to the Bucket literal union via
  // `lib/budgets.ts`'s BUCKETS check before reading it as one of
  // the three valid values; an unrecognised string is treated as
  // unclassified.
  bucket?: string;
  targetAmount?: number;
  frequencyMonths?: number;
  rolloverEnabled?: boolean;
};

export type BudgetPlan = {
  id: string;
  planMonth: string;
  expectedIncome: number;
  expectedIncomeAuto: boolean;
  flexPool: number;
  flexPoolAuto: boolean;
  savingsTarget?: number;
  createdAt: number;
  updatedAt: number;
};

export type BankSender = {
  id: string;
  senderId: string;
  displayName: string;
  enabled: boolean;
  createdAt: number;
};

export type MerchantCategoryOverride = {
  id: string;
  merchant: string;
  categoryId: string;
  createdAt: number;
};

export type TransactionCategoryOverride = {
  id: string;
  paymentId: string;
  categoryId: string;
  createdAt: number;
};

export type MustPayItem = {
  id: string;
  title: string;
  amountGEL: number;
  lastPaidAt?: number;
  isRecurring: boolean;
  notes?: string;
  dueDate?: number;
  createdAt: number;
  updatedAt: number;
};

export type MustPayState = {
  id: string;
  key: string;
  currentPotGEL: number;
  updatedAt: number;
};

export type Credit = {
  id: string;
  transactionId: string;
  transactionType: string;
  amount: number;
  currency: string;
  counterparty?: string;
  cardLastDigits?: string;
  transactionDate: number;
  messageTimestamp: number;
  syncedAt: number;
  bankSenderId: string;
  rawMessage: string;
  excludedFromAnalytics?: boolean;
};
