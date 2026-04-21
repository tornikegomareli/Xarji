import { init, i } from "@instantdb/react";

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
    }),
    bankSenders: i.entity({
      senderId: i.string().unique(),
      displayName: i.string(),
      enabled: i.boolean(),
      createdAt: i.number(),
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
    }),
  },
  links: {},
});

// Initialize InstantDB
const APP_ID = import.meta.env.VITE_INSTANT_APP_ID || "f78a0d50-1945-431a-91ea-96f68570d4a5";

export const db = init({ appId: APP_ID, schema });

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
};

export type BankSender = {
  id: string;
  senderId: string;
  displayName: string;
  enabled: boolean;
  createdAt: number;
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
};
