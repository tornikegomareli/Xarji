import { i } from "@instantdb/admin";

/**
 * InstantDB Schema for SMS Expense Tracker
 *
 * Two tables:
 * - payments: successful transactions
 * - failedPayments: failed transaction attempts
 */
const schema = i.schema({
  entities: {
    // Successful payments
    payments: i.entity({
      transactionId: i.string().unique(),
      transactionType: i.string(),
      amount: i.number().indexed(),
      currency: i.string().indexed(),
      merchant: i.string().optional().indexed(),
      cardLastDigits: i.string().optional(),
      transactionDate: i.date().indexed(),
      messageTimestamp: i.date(),
      syncedAt: i.date(),
      plusEarned: i.number().optional(),
      plusTotal: i.number().optional(),
      bankSenderId: i.string().indexed(),
      rawMessage: i.string(),
      // Client-managed flag — when true, the dashboard hides this
      // transaction from spending aggregates (donut, totals, trends,
      // signals) but keeps it visible in the /transactions ledger.
      // The service never sets this; it just persists what the client
      // writes through to InstantDB.
      excludedFromAnalytics: i.boolean().optional(),
    }),

    // Failed payment attempts
    failedPayments: i.entity({
      transactionId: i.string().unique(),
      transactionType: i.string(),
      currency: i.string().indexed(),
      merchant: i.string().optional().indexed(),
      cardLastDigits: i.string().optional(),
      failureReason: i.string().optional(),
      balance: i.number().optional(),
      transactionDate: i.date().indexed(),
      messageTimestamp: i.date(),
      syncedAt: i.date(),
      bankSenderId: i.string().indexed(),
      rawMessage: i.string(),
    }),

    // Incoming money (salary, deposits, transfers received)
    credits: i.entity({
      transactionId: i.string().unique(),
      transactionType: i.string(),
      amount: i.number().indexed(),
      currency: i.string().indexed(),
      counterparty: i.string().optional().indexed(),
      cardLastDigits: i.string().optional(),
      transactionDate: i.date().indexed(),
      messageTimestamp: i.date(),
      syncedAt: i.date(),
      bankSenderId: i.string().indexed(),
      rawMessage: i.string(),
      // Same as payments.excludedFromAnalytics — client-managed flag
      // that hides this credit from Income aggregates while keeping
      // it visible in the /income ledger.
      excludedFromAnalytics: i.boolean().optional(),
    }),

    // User-defined categories shown on the dashboard. Managed by the
    // client — included here so the schema-backed bootstrap pass in
    // setup/apply.ts can register all namespaces the app uses.
    //
    // The four budget-related fields (bucket, targetAmount,
    // frequencyMonths, rolloverEnabled) are added by the flex-budgeting
    // feature. All optional + client-managed: the service never sets
    // them, only persists what the /budgets page writes. Categories
    // without a bucket are treated as "unclassified" and only appear in
    // the /budgets setup wizard until the user assigns them.
    categories: i.entity({
      name: i.string(),
      color: i.string(),
      icon: i.string(),
      isDefault: i.boolean(),
      // "fixed" | "flex" | "non_monthly". Drives which section the
      // category renders in on /budgets and which formula it
      // contributes to in computeFlexPool. Optional so existing
      // pre-feature rows tolerate the schema migration.
      bucket: i.string().optional(),
      // GEL. For Fixed categories: monthly target. For Non-Monthly:
      // total target across `frequencyMonths` (Phase 2 divides it).
      // Flex categories don't have a target — the bucket-level pool
      // is the limit. Optional so unclassified rows have no value.
      targetAmount: i.number().optional(),
      // Non-Monthly only. Number of months the targetAmount spreads
      // across (e.g. 12 for an annual sinking fund). Always rolling
      // for Non-Monthly; this field is meaningless for the other
      // buckets. Phase 2 wires the accrual math.
      frequencyMonths: i.number().optional(),
      // Fixed only. When true, leftover or overshoot from a month
      // carries to the next month's effective target. Phase 2 wires
      // the rollover math (always-on for Non-Monthly regardless of
      // this flag).
      rolloverEnabled: i.boolean().optional(),
    }),

    // Per-month flex-budgeting plan. One row per month keyed on
    // "YYYY-MM" so the user can override expected income or the flex
    // pool just for one month without losing the auto-derive behavior
    // in future months. Phase 1 only writes the row when the user
    // saves changes; later months auto-derive from the formula.
    budgetPlans: i.entity({
      planMonth: i.string().unique(),
      // Both income + pool default to auto-derived numbers. The "Auto"
      // booleans flip false the moment the user types a manual value,
      // which freezes that month's number while leaving the auto path
      // active for other months.
      expectedIncome: i.number(),
      expectedIncomeAuto: i.boolean(),
      flexPool: i.number(),
      flexPoolAuto: i.boolean(),
      savingsTarget: i.number().optional(),
      createdAt: i.number(),
      updatedAt: i.number(),
    }),

    // Configured bank SMS senders, one row per sender the user trusts.
    bankSenders: i.entity({
      senderId: i.string().unique(),
      displayName: i.string(),
      enabled: i.boolean(),
      createdAt: i.number(),
    }),

    // Manual category overrides per merchant. The dashboard's regex
    // categoriser is a sensible default but doesn't know about the
    // user's intent — e.g. they may want SOCAR routed to "Cash &
    // ATM" instead of "Transport" because they pay with cash there.
    // One row per merchant; the override wins everywhere the user-
    // facing categoriser is consulted (Dashboard donut, Categories
    // page, AI tools).
    merchantCategoryOverrides: i.entity({
      merchant: i.string().unique(),
      categoryId: i.string(),
      createdAt: i.number(),
    }),

    // Per-transaction category overrides. Takes priority over the
    // per-merchant override. paymentId is the InstantDB entity id of
    // the payments row — stable, unique, never changes after creation.
    transactionCategoryOverrides: i.entity({
      paymentId: i.string().unique(),
      categoryId: i.string(),
      createdAt: i.number(),
    }),

    // Free-form "things I owe" list. Not derived from SMS — the user
    // types these in directly on the Must Pay page. We keep the
    // service-side mirror so future tooling (cron exports, AI
    // read-only summaries, etc.) has a typed schema to query against.
    mustPayItems: i.entity({
      title: i.string(),
      amountGEL: i.number(),
      // null = never paid (still pending). Number = epoch ms of the
      // most recent mark-paid click. Recurring items auto-reset on
      // month rollover purely as a render-time computation in
      // useMustPay.isItemPaidThisCycle — no cron, no migration.
      lastPaidAt: i.number().optional(),
      isRecurring: i.boolean(),
      notes: i.string().optional(),
      dueDate: i.number().optional(),
      createdAt: i.number(),
      updatedAt: i.number(),
    }),

    // Singleton row holding the user's current "pot" — how much money
    // they have right now. The Must Pay page subtracts pending
    // obligations from this to give them "free" — the headline number
    // they actually came to the page for. Keyed "singleton" with a
    // unique constraint so concurrent upserts can't duplicate it.
    mustPayState: i.entity({
      key: i.string().unique(),
      currentPotGEL: i.number(),
      updatedAt: i.number(),
    }),
  },
  links: {},
});

export default schema;
export type Schema = typeof schema;
