import { LOCAL_ONLY } from "./local-mode";
// Lazy converter that turns a foreign-currency amount into its GEL
// equivalent using NBG's per-day rate. Hits /api/exchange-rate when a
// rate isn't already in the in-memory cache; subscribed components
// re-render once the fetch resolves and the converter starts returning
// numbers instead of nulls.
//
// Why null on the first call (instead of the raw amount or 0): the
// caller is almost always summing into a GEL total, so returning null
// lets the aggregate hook skip the row during the load window. Once the
// rate arrives the row gets included and the total snaps to the correct
// value. Returning the raw amount would briefly inflate the total with
// USD-denominated numbers added to GEL ones; returning 0 would have the
// same UX as null without the explicit "not loaded yet" signal.

import { useCallback, useEffect, useState } from "react";
import { formatLocalDay } from "../ink/format";

type RatesByCurrency = Map<string, number>;

const cache = new Map<string, RatesByCurrency>();
const missingLocal = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();
const subscribers = new Set<() => void>();

const STORAGE_KEY = "xarji-nbg-rates-v1";
const CODES = "USD,EUR";
const TODAY_TTL_MS = 15 * 60 * 1000;

interface PersistedEntry {
  rates: Record<string, number>;
  fetchedAt: number;
}

function todayKey(): string {
  return formatLocalDay(Date.now());
}

function loadFromStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, PersistedEntry>;
    const now = Date.now();
    for (const [date, entry] of Object.entries(parsed)) {
      // Today's rate has a TTL because NBG publishes mid-day. Historical
      // dates are immutable so we trust them indefinitely.
      if (date === todayKey() && now - entry.fetchedAt > TODAY_TTL_MS) continue;
      cache.set(date, new Map(Object.entries(entry.rates)));
    }
  } catch {
    /* corrupt cache — let live fetches overwrite */
  }
}

function persistToStorage() {
  try {
    const obj: Record<string, PersistedEntry> = {};
    for (const [date, rates] of cache) {
      obj[date] = {
        rates: Object.fromEntries(rates),
        fetchedAt: Date.now(),
      };
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* private mode / quota exceeded — degrade silently */
  }
}

if (!LOCAL_ONLY && typeof window !== "undefined") loadFromStorage();

function notify() {
  for (const fn of subscribers) fn();
}

async function fetchRatesForDate(dateStr: string): Promise<void> {
  if (cache.has(dateStr)) return;
  if (LOCAL_ONLY && (missingLocal.get(dateStr) ?? 0) > Date.now() - 30000) return;
  const existing = inflight.get(dateStr);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/exchange-rate?date=${dateStr}&lang=en&codes=${CODES}`);
      if (!res.ok) { if (LOCAL_ONLY) missingLocal.set(dateStr, Date.now()); return; }
      const body = (await res.json()) as { rates?: Record<string, { rate: number }> };
      const rates: RatesByCurrency = new Map();
      for (const [code, info] of Object.entries(body.rates ?? {})) {
        if (typeof info.rate === "number" && Number.isFinite(info.rate)) {
          rates.set(code, info.rate);
        }
      }
      cache.set(dateStr, rates);
      if (!LOCAL_ONLY) persistToStorage();
      notify();
    } catch {
      /* network/server error — cache stays empty, converter keeps
         returning null, aggregators keep skipping */
    } finally {
      inflight.delete(dateStr);
    }
  })();
  inflight.set(dateStr, promise);
  return promise;
}

export type GelConverter = (amount: number, currency: string, dateMs: number) => number | null;

export function useGelConverter(): GelConverter {
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);

  return useCallback((amount, currency, dateMs) => {
    if (currency === "GEL") return amount;
    const dateStr = formatLocalDay(dateMs);
    const rates = cache.get(dateStr);
    if (!rates) {
      void fetchRatesForDate(dateStr);
      return null;
    }
    const rate = rates.get(currency.toUpperCase());
    return rate !== undefined ? amount * rate : null;
  }, []);
}
