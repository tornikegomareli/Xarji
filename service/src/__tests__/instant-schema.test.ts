import { describe, test, expect } from "bun:test";
import schema from "../instant-schema";
import { bootstrapSeed } from "../setup/apply";

// The schema object's internal shape is defined by @instantdb/admin —
// we access `entities.<name>.attrs.<field>` and each attr has `valueType`,
// `required`, `isIndexed`, and a `config` object that carries `unique` and
// `indexed` flags. We treat these as untyped below because the InstantDB
// types don't export the inner shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entities: Record<string, any> = (schema as any).entities;

describe("InstantDB schema structure", () => {
  test("exposes the three transaction tables the sync router writes to", () => {
    const names = Object.keys(entities).sort();
    expect(names).toContain("payments");
    expect(names).toContain("failedPayments");
    expect(names).toContain("credits");
  });
});

describe("payments entity", () => {
  const p = entities.payments;
  const must = [
    "transactionId",
    "transactionType",
    "amount",
    "currency",
    "merchant",
    "cardLastDigits",
    "transactionDate",
    "messageTimestamp",
    "syncedAt",
    "bankSenderId",
    "rawMessage",
  ];

  test("declares all required fields", () => {
    for (const name of must) {
      expect(p.attrs[name]).toBeDefined();
    }
  });

  test("transactionId is unique — dedup integrity relies on this", () => {
    expect(p.attrs.transactionId.config.unique).toBe(true);
  });

  test("analytics fields are indexed for fast client queries", () => {
    expect(p.attrs.amount.config.indexed).toBe(true);
    expect(p.attrs.currency.config.indexed).toBe(true);
    expect(p.attrs.transactionDate.config.indexed).toBe(true);
    expect(p.attrs.bankSenderId.config.indexed).toBe(true);
  });
});

describe("failedPayments entity", () => {
  const f = entities.failedPayments;

  test("has the fields the failed-payment parser populates", () => {
    for (const name of [
      "transactionId",
      "transactionType",
      "currency",
      "merchant",
      "cardLastDigits",
      "failureReason",
      "balance",
      "transactionDate",
      "messageTimestamp",
      "syncedAt",
      "bankSenderId",
      "rawMessage",
    ]) {
      expect(f.attrs[name]).toBeDefined();
    }
  });

  test("transactionId is unique", () => {
    expect(f.attrs.transactionId.config.unique).toBe(true);
  });

  test("deliberately has no amount field — failed SMS often omits it", () => {
    expect(f.attrs.amount).toBeUndefined();
  });
});

describe("credits entity", () => {
  const c = entities.credits;

  test("has the fields the incoming parser populates", () => {
    for (const name of [
      "transactionId",
      "transactionType",
      "amount",
      "currency",
      "counterparty",
      "cardLastDigits",
      "transactionDate",
      "messageTimestamp",
      "syncedAt",
      "bankSenderId",
      "rawMessage",
    ]) {
      expect(c.attrs[name]).toBeDefined();
    }
  });

  test("transactionId is unique", () => {
    expect(c.attrs.transactionId.config.unique).toBe(true);
  });

  test("counterparty is indexed — it is the primary grouping key for income", () => {
    expect(c.attrs.counterparty.config.indexed).toBe(true);
  });

  test("has amount (unlike failedPayments)", () => {
    expect(c.attrs.amount).toBeDefined();
    expect(c.attrs.amount.config.indexed).toBe(true);
  });
});

describe("bootstrap seed coverage", () => {
  // The applySetup bootstrap pass writes a stub row + then deletes it
  // for each entity in bootstrapSeed, which forces InstantDB to create
  // the attrs. Any schema entity that is queried before the user has
  // written real data to it (e.g. mustPayItems from Layout's sidebar
  // badge, or budgetPlans from /budgets) needs to be in this seed.
  // Forgetting to add a new entity here is what triggered the Codex
  // P1 finding on PR #51 — this test guards future schema additions.
  test("every schema entity has a corresponding seed row", () => {
    const entityNames = Object.keys(entities).sort();
    const seededTables = bootstrapSeed().map((s) => s.table).sort();
    for (const name of entityNames) {
      expect(seededTables).toContain(name);
    }
  });

  test("seed rows are unique per table — no double-write that would skip an entity", () => {
    const seededTables = bootstrapSeed().map((s) => s.table);
    const counts = new Map<string, number>();
    for (const t of seededTables) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [name, n] of counts) {
      expect(n).toBe(1);
    }
  });
});

describe("invariants across the three transaction tables", () => {
  const tables = ["payments", "failedPayments", "credits"] as const;

  test("every transaction table has a unique transactionId", () => {
    for (const name of tables) {
      expect(entities[name].attrs.transactionId.config.unique).toBe(true);
    }
  });

  test("every transaction table has transactionDate indexed", () => {
    for (const name of tables) {
      expect(entities[name].attrs.transactionDate.config.indexed).toBe(true);
    }
  });

  test("every transaction table keeps the raw SMS text", () => {
    for (const name of tables) {
      expect(entities[name].attrs.rawMessage).toBeDefined();
      expect(entities[name].attrs.rawMessage.valueType).toBe("string");
    }
  });
});
