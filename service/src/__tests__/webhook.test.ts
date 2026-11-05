import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { StateDb } from "../state-db";
import { buildWebhookEvent, deliverWebhookQueue } from "../sync";
import type { Transaction } from "../parser";

const webhook = {
  enabled: true,
  url: "https://bot.example/hook",
  headers: { Authorization: "Bearer s3cret" },
};

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "id-0",
    messageId: 100,
    bankKey: "SOLO",
    bankSenderId: "SOLO",
    transactionType: "payment",
    status: "success",
    direction: "out",
    amount: 30,
    currency: "GEL",
    merchant: "MAGIC CITY",
    cardLastDigits: "5607",
    transactionDate: new Date("2026-11-05T12:51:44.000Z"),
    messageTimestamp: new Date("2026-11-05T12:51:45.000Z"),
    rawMessage: "გადახდა: GEL30.00\nCard:***5607\nMAGIC CITY",
    failureReason: null,
    balance: null,
    plusEarned: 90,
    plusTotal: 2310.36,
    counterparty: null,
    ...overrides,
  };
}

let db: StateDb;
let calls: Array<{ url: string; init: RequestInit }>;
let responses: Array<number | Error>;
const realFetch = globalThis.fetch;

function enqueue(t: Transaction): void {
  db.enqueueWebhookEvent(t.id, t.transactionDate, JSON.stringify(buildWebhookEvent(t)));
}

function sentIds(): string[] {
  return calls.map((c) => JSON.parse(String(c.init.body)).eventId);
}

beforeEach(() => {
  db = new StateDb(":memory:");
  calls = [];
  responses = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift() ?? 200;
    if (next instanceof Error) throw next;
    return new Response(null, { status: next });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  db.close();
});

describe("buildWebhookEvent", () => {
  test("emits the xarji.payment/v1 shape with nulls for missing fields", () => {
    const event = buildWebhookEvent(tx(), new Date("2026-11-05T13:00:00.000Z"));
    expect(event).toEqual({
      schema: "xarji.payment/v1",
      source: "xarji",
      eventId: "id-0",
      receivedAt: "2026-11-05T13:00:00.000Z",
      transaction: {
        id: "id-0",
        messageId: 100,
        bankKey: "SOLO",
        bankSenderId: "SOLO",
        kind: "payment",
        status: "success",
        direction: "out",
        amount: 30,
        currency: "GEL",
        merchant: "MAGIC CITY",
        counterparty: null,
        cardLastDigits: "5607",
        balance: null,
        failureReason: null,
        transactionDate: "2026-11-05T12:51:44.000Z",
        messageTimestamp: "2026-11-05T12:51:45.000Z",
      },
    });
  });

  test("never includes the raw SMS text", () => {
    const json = JSON.stringify(buildWebhookEvent(tx()));
    expect(json).not.toContain("rawMessage");
    expect(json).not.toContain("გადახდა");
  });
});

describe("deliverWebhookQueue", () => {
  test("sends one POST per transaction, oldest first, with the auth header", async () => {
    enqueue(tx({ id: "late", transactionDate: new Date("2026-11-05T15:00:00Z") }));
    enqueue(tx({ id: "early", transactionDate: new Date("2026-11-05T09:00:00Z") }));

    const result = await deliverWebhookQueue(db, webhook);

    expect(result).toEqual({ success: true, syncedCount: 2 });
    expect(sentIds()).toEqual(["early", "late"]);
    for (const call of calls) {
      expect(call.url).toBe(webhook.url);
      expect(call.init.method).toBe("POST");
      expect(call.init.headers).toMatchObject({
        "Content-Type": "application/json",
        Authorization: "Bearer s3cret",
      });
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  test("does not send a delivered event again, even when it is enqueued again", async () => {
    enqueue(tx({ id: "a" }));
    await deliverWebhookQueue(db, webhook);

    // A batch held back by an InstantDB failure re-enqueues the same
    // transactions on the next run.
    enqueue(tx({ id: "a" }));
    await deliverWebhookQueue(db, webhook);

    expect(sentIds()).toEqual(["a"]);
  });

  test("stops at a 5xx and retries that event and the later ones next run", async () => {
    enqueue(tx({ id: "1", transactionDate: new Date("2026-11-05T09:00:00Z") }));
    enqueue(tx({ id: "2", transactionDate: new Date("2026-11-05T10:00:00Z") }));
    enqueue(tx({ id: "3", transactionDate: new Date("2026-11-05T11:00:00Z") }));
    responses = [200, 503];

    const first = await deliverWebhookQueue(db, webhook);
    expect(first.success).toBe(false);
    expect(first.error).toBe("HTTP 503");
    expect(sentIds()).toEqual(["1", "2"]);

    calls = [];
    const second = await deliverWebhookQueue(db, webhook);
    expect(second).toEqual({ success: true, syncedCount: 2 });
    expect(sentIds()).toEqual(["2", "3"]);
  });

  test.each([408, 429, new Error("connect ECONNREFUSED")])(
    "keeps the event queued on %p",
    async (failure) => {
      enqueue(tx({ id: "a" }));
      responses = [failure];

      expect((await deliverWebhookQueue(db, webhook)).success).toBe(false);
      expect(db.pendingWebhookEvents().map((e) => e.eventId)).toEqual(["a"]);
    }
  );

  test("drops an event on a non-retryable 4xx and continues", async () => {
    enqueue(tx({ id: "bad", transactionDate: new Date("2026-11-05T09:00:00Z") }));
    enqueue(tx({ id: "good", transactionDate: new Date("2026-11-05T10:00:00Z") }));
    responses = [400, 200];

    const result = await deliverWebhookQueue(db, webhook);

    expect(result).toEqual({ success: true, syncedCount: 1 });
    expect(sentIds()).toEqual(["bad", "good"]);
    expect(db.pendingWebhookEvents()).toEqual([]);
  });
});
