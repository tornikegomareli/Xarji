import { describe, test, expect } from "bun:test";
import {
  fetchRate,
  fetchRateSheet,
  formatTbilisiDate,
  NbgDateNotFoundError,
  NbgFutureDateError,
  NbgInvalidLanguageError,
  NbgRequestFailedError,
} from "../nbg-client";

// A trimmed copy of the real NBG response shape. Quantity is deliberately
// non-1 for JPY (per 100) and UZS (per 10000) so the normalisation
// (rate / quantity) is actually exercised by tests.
const SAMPLE_PAYLOAD = [
  {
    date: "2026-04-23T17:30:00.000Z",
    currencies: [
      {
        code: "USD",
        rate: 2.7123,
        quantity: 1,
        name: "US Dollar",
        diff: 0.0034,
        date: "2026-04-23T17:30:00.000Z",
        validFromDate: "2026-04-24T00:00:00.000Z",
      },
      {
        code: "EUR",
        rate: 2.9412,
        quantity: 1,
        name: "Euro",
        diff: -0.0021,
        date: "2026-04-23T17:30:00.000Z",
        validFromDate: "2026-04-24T00:00:00.000Z",
      },
      {
        code: "JPY",
        rate: 1.7890,
        quantity: 100,
        name: "Japanese Yen",
        diff: 0,
        date: "2026-04-23T17:30:00.000Z",
        validFromDate: "2026-04-24T00:00:00.000Z",
      },
    ],
  },
];

function fakeFetch(payload: unknown, init: { status?: number; nonJson?: boolean; throws?: boolean } = {}) {
  return async () => {
    if (init.throws) throw new Error("network down");
    const status = init.status ?? 200;
    if (init.nonJson) {
      return new Response("not json", { status });
    }
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

describe("fetchRateSheet", () => {
  test("parses the canonical NBG payload and normalises by quantity", async () => {
    const sheet = await fetchRateSheet({
      language: "en",
      date: "2026-04-23",
      fetcher: fakeFetch(SAMPLE_PAYLOAD) as unknown as typeof fetch,
    });

    expect(sheet.date).toBe("2026-04-23");
    expect(sheet.language).toBe("en");

    const usd = sheet.rates.get("USD");
    expect(usd?.rate).toBeCloseTo(2.7123, 4);
    expect(usd?.change).toBe(1);

    const eur = sheet.rates.get("EUR");
    expect(eur?.change).toBe(-1);

    // Quantity normalisation: API quotes JPY per 100 → divide.
    const jpy = sheet.rates.get("JPY");
    expect(jpy?.rate).toBeCloseTo(0.017890, 6);
    expect(jpy?.change).toBe(0);
  });

  test("uppercases lookups regardless of API casing", async () => {
    const sheet = await fetchRateSheet({
      language: "en",
      date: "2026-04-23",
      fetcher: fakeFetch([
        { ...SAMPLE_PAYLOAD[0], currencies: [{ ...SAMPLE_PAYLOAD[0].currencies[0], code: "usd" }] },
      ]) as unknown as typeof fetch,
    });
    expect(sheet.rates.get("USD")?.rate).toBeCloseTo(2.7123, 4);
  });

  test("rejects malformed YYYY-MM-DD strings before fetching", async () => {
    let called = 0;
    const fetcher = (async () => { called += 1; return new Response("{}"); }) as unknown as typeof fetch;
    await expect(
      fetchRateSheet({ language: "en", date: "23-04-2026", fetcher })
    ).rejects.toBeInstanceOf(NbgRequestFailedError);
    expect(called).toBe(0);
  });

  test("refuses future dates without hitting the network", async () => {
    let called = 0;
    const fetcher = (async () => { called += 1; return new Response("{}"); }) as unknown as typeof fetch;
    const future = formatTbilisiDate(new Date(Date.now() + 7 * 86400000));
    await expect(
      fetchRateSheet({ language: "en", date: future, fetcher })
    ).rejects.toBeInstanceOf(NbgFutureDateError);
    expect(called).toBe(0);
  });

  test("surfaces NBG's misspelled langaugeCode error as a typed exception", async () => {
    await expect(
      fetchRateSheet({
        language: "en",
        date: "2026-04-23",
        fetcher: fakeFetch({ errors: { key: "langaugeCode" } }) as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(NbgInvalidLanguageError);
  });

  test("throws DateNotFound when the response is empty", async () => {
    await expect(
      fetchRateSheet({
        language: "en",
        date: "2026-04-23",
        fetcher: fakeFetch([]) as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(NbgDateNotFoundError);
  });

  test("throws RequestFailed for non-2xx responses", async () => {
    await expect(
      fetchRateSheet({
        language: "en",
        date: "2026-04-23",
        fetcher: fakeFetch(null, { status: 503 }) as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(NbgRequestFailedError);
  });

  test("throws RequestFailed for non-JSON responses", async () => {
    await expect(
      fetchRateSheet({
        language: "en",
        date: "2026-04-23",
        fetcher: fakeFetch(null, { nonJson: true }) as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(NbgRequestFailedError);
  });

  test("throws RequestFailed when the fetcher itself rejects", async () => {
    await expect(
      fetchRateSheet({
        language: "en",
        date: "2026-04-23",
        fetcher: fakeFetch(null, { throws: true }) as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(NbgRequestFailedError);
  });

  test("omits ?date= when no date is given (lets NBG serve cached today)", async () => {
    const seen: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      seen.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify(SAMPLE_PAYLOAD));
    }) as unknown as typeof fetch;

    await fetchRateSheet({ language: "en", fetcher });

    expect(seen[0]).toContain("/currencies/en/json");
    expect(seen[0]).not.toContain("?date=");
  });

  test("includes ?date= when an explicit date is given", async () => {
    const seen: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      seen.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify(SAMPLE_PAYLOAD));
    }) as unknown as typeof fetch;

    await fetchRateSheet({ language: "en", date: "2026-04-23", fetcher });

    expect(seen[0]).toContain("?date=2026-04-23");
  });

  test("accepts a Date object and converts to Tbilisi-local YYYY-MM-DD", async () => {
    const seen: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      seen.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify(SAMPLE_PAYLOAD));
    }) as unknown as typeof fetch;

    // 23 April 2026 22:00 UTC is 24 April 02:00 in Tbilisi (UTC+4).
    await fetchRateSheet({
      language: "en",
      date: new Date("2026-04-23T22:00:00Z"),
      fetcher,
    });
    expect(seen[0]).toContain("?date=2026-04-24");
  });
});

describe("fetchRate", () => {
  test("returns just the rate for a single currency code", async () => {
    const rate = await fetchRate("eur", {
      language: "en",
      date: "2026-04-23",
      fetcher: fakeFetch(SAMPLE_PAYLOAD) as unknown as typeof fetch,
    });
    expect(rate).toBeCloseTo(2.9412, 4);
  });

  test("throws when the currency is missing from the sheet", async () => {
    await expect(
      fetchRate("XYZ", {
        language: "en",
        date: "2026-04-23",
        fetcher: fakeFetch(SAMPLE_PAYLOAD) as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(NbgDateNotFoundError);
  });
});

describe("formatTbilisiDate", () => {
  test("formats consistently to YYYY-MM-DD in Tbilisi time", () => {
    expect(formatTbilisiDate(new Date("2026-04-23T22:00:00Z"))).toBe("2026-04-24");
    expect(formatTbilisiDate(new Date("2026-04-23T19:00:00Z"))).toBe("2026-04-23");
  });
});
