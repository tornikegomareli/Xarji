import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../../config";
import { clearMemoryCache, getRateSheet } from "../exchange-service";
import { formatTbilisiDate } from "../nbg-client";

// Strip the disk cache between tests so the persistence layer is exercised
// from a known state. We isolate to ~/.xarji/exchange-cache to keep blast
// radius tiny — the only thing this test layer manages.
const CACHE_DIR = join(CONFIG_DIR, "exchange-cache");

const SAMPLE_PAYLOAD = (date: string) => [
  {
    date: `${date}T17:30:00.000Z`,
    currencies: [
      {
        code: "USD",
        rate: 2.7123,
        quantity: 1,
        name: "US Dollar",
        diff: 0.001,
        date: `${date}T17:30:00.000Z`,
        validFromDate: `${date}T00:00:00.000Z`,
      },
    ],
  },
];

function installFetchMock(payloadByDate: Record<string, unknown>) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const m = url.match(/[?&]date=(\d{4}-\d{2}-\d{2})/);
    const dateKey = m ? m[1] : "today";
    const payload = payloadByDate[dateKey] ?? payloadByDate["today"];
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function wipeDiskCache() {
  if (existsSync(CACHE_DIR)) rmSync(CACHE_DIR, { recursive: true, force: true });
}

beforeEach(() => {
  clearMemoryCache();
  wipeDiskCache();
  mkdirSync(CACHE_DIR, { recursive: true });
});

afterEach(() => {
  clearMemoryCache();
  wipeDiskCache();
});

describe("getRateSheet", () => {
  test("hits the network on first call and caches in memory", async () => {
    const mock = installFetchMock({ "2026-04-23": SAMPLE_PAYLOAD("2026-04-23") });
    try {
      const a = await getRateSheet({ date: "2026-04-23", language: "en" });
      const b = await getRateSheet({ date: "2026-04-23", language: "en" });
      expect(a.rates.get("USD")?.rate).toBeCloseTo(2.7123, 4);
      expect(b.rates.get("USD")?.rate).toBeCloseTo(2.7123, 4);
      // Second call must not re-fetch.
      expect(mock.calls.length).toBe(1);
    } finally {
      mock.restore();
    }
  });

  test("rehydrates a historical date from disk after a process restart", async () => {
    const mock1 = installFetchMock({ "2026-04-23": SAMPLE_PAYLOAD("2026-04-23") });
    try {
      await getRateSheet({ date: "2026-04-23", language: "en" });
      expect(mock1.calls.length).toBe(1);
    } finally {
      mock1.restore();
    }

    // Simulate a restart: drop in-memory cache, reinstall fetch mock, ask
    // again. Disk cache should answer without a network call.
    clearMemoryCache();
    const mock2 = installFetchMock({ "2026-04-23": SAMPLE_PAYLOAD("2026-04-23") });
    try {
      const sheet = await getRateSheet({ date: "2026-04-23", language: "en" });
      expect(sheet.rates.get("USD")?.rate).toBeCloseTo(2.7123, 4);
      expect(mock2.calls.length).toBe(0);
    } finally {
      mock2.restore();
    }
  });

  test("refresh: true forces a network round-trip past both caches", async () => {
    const first = installFetchMock({ "2026-04-23": SAMPLE_PAYLOAD("2026-04-23") });
    try {
      await getRateSheet({ date: "2026-04-23", language: "en" });
    } finally {
      first.restore();
    }

    const second = installFetchMock({
      "2026-04-23": [
        {
          ...SAMPLE_PAYLOAD("2026-04-23")[0],
          currencies: [
            { ...SAMPLE_PAYLOAD("2026-04-23")[0].currencies[0], rate: 2.8000 },
          ],
        },
      ],
    });
    try {
      const sheet = await getRateSheet({ date: "2026-04-23", language: "en", refresh: true });
      expect(sheet.rates.get("USD")?.rate).toBeCloseTo(2.8, 4);
      expect(second.calls.length).toBe(1);
    } finally {
      second.restore();
    }
  });

  test("today's request omits ?date= so NBG can serve its edge cache", async () => {
    const mock = installFetchMock({ today: SAMPLE_PAYLOAD(formatTbilisiDate(new Date())) });
    try {
      await getRateSheet({ language: "en" });
      expect(mock.calls.length).toBe(1);
      expect(mock.calls[0]).not.toContain("?date=");
    } finally {
      mock.restore();
    }
  });

  test("language is part of the cache key — different langs hit network independently", async () => {
    const mock = installFetchMock({ "2026-04-23": SAMPLE_PAYLOAD("2026-04-23") });
    try {
      await getRateSheet({ date: "2026-04-23", language: "en" });
      await getRateSheet({ date: "2026-04-23", language: "ka" });
      expect(mock.calls.length).toBe(2);
      // And both should be cached afterwards.
      await getRateSheet({ date: "2026-04-23", language: "en" });
      await getRateSheet({ date: "2026-04-23", language: "ka" });
      expect(mock.calls.length).toBe(2);
    } finally {
      mock.restore();
    }
  });
});

// Suppress the unused mock warning from bun:test when we only import it
// for completeness (some IDEs flag the import otherwise).
void mock;
