import { i } from "@instantdb/admin";

const schema = i.schema({
  entities: {
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
  },
  links: {},
});

export default schema;
