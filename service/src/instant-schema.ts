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
    }),

    // User-defined categories shown on the dashboard. Managed by the
    // client — included here so the schema-backed bootstrap pass in
    // setup/apply.ts can register all namespaces the app uses.
    categories: i.entity({
      name: i.string(),
      color: i.string(),
      icon: i.string(),
      isDefault: i.boolean(),
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
  },
  links: {},
});

export default schema;
export type Schema = typeof schema;
