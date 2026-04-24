/**
 * Caching wrapper around the NBG client. Two layers:
 *
 *   1. In-process Map keyed by `<date>-<language>`. Wiped on restart.
 *   2. Disk cache at ~/.xarji/exchange-cache/<date>-<lang>.json.
 *      Persists across launches so we don't re-hit NBG every cold start.
 *
 * NBG publishes once per business day, so a long TTL is safe. Today's
 * sheet uses a short in-memory TTL (15 min) to pick up the morning
 * publication; historical dates are immutable and cached forever.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../config";
import {
  fetchRateSheet,
  formatTbilisiDate,
  type NbgCurrencyRate,
  type NbgLanguage,
  type NbgRateSheet,
} from "./nbg-client";

const TODAY_TTL_MS = 15 * 60 * 1000;
const CACHE_DIR = join(CONFIG_DIR, "exchange-cache");

type CacheEntry = { sheet: NbgRateSheet; fetchedAt: number };

const memory = new Map<string, CacheEntry>();

function cacheKey(date: string, language: NbgLanguage): string {
  return `${date}-${language}`;
}

function cacheFilePath(date: string, language: NbgLanguage): string {
  return join(CACHE_DIR, `${cacheKey(date, language)}.json`);
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

interface SerialisedSheet {
  date: string;
  language: NbgLanguage;
  rates: NbgCurrencyRate[];
  fetchedAt: number;
}

function serialise(sheet: NbgRateSheet, fetchedAt: number): SerialisedSheet {
  return {
    date: sheet.date,
    language: sheet.language,
    rates: Array.from(sheet.rates.values()),
    fetchedAt,
  };
}

function deserialise(raw: SerialisedSheet): CacheEntry {
  const map = new Map<string, NbgCurrencyRate>();
  for (const r of raw.rates) map.set(r.code, r);
  return {
    sheet: { date: raw.date, language: raw.language, rates: map },
    fetchedAt: raw.fetchedAt,
  };
}

function readDisk(date: string, language: NbgLanguage): CacheEntry | null {
  const path = cacheFilePath(date, language);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SerialisedSheet;
    return deserialise(raw);
  } catch {
    // Corrupt cache — let the network refresh overwrite it.
    return null;
  }
}

function writeDisk(sheet: NbgRateSheet, fetchedAt: number) {
  ensureCacheDir();
  const path = cacheFilePath(sheet.date, sheet.language);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(serialise(sheet, fetchedAt)), "utf8");
  // Atomic rename so a crashed half-write never lingers as the final file.
  renameSync(tmp, path);
}

interface GetSheetOptions {
  date?: string; // YYYY-MM-DD; default = today (Tbilisi)
  language?: NbgLanguage;
  /** Force a network round-trip even if a fresh cache entry exists. */
  refresh?: boolean;
}

export async function getRateSheet(opts: GetSheetOptions = {}): Promise<NbgRateSheet> {
  const language: NbgLanguage = opts.language ?? "ka";
  const date = opts.date ?? formatTbilisiDate(new Date());
  const isToday = date === formatTbilisiDate(new Date());
  const key = cacheKey(date, language);

  if (!opts.refresh) {
    const mem = memory.get(key);
    if (mem && (!isToday || Date.now() - mem.fetchedAt < TODAY_TTL_MS)) {
      return mem.sheet;
    }
    if (!isToday) {
      const disk = readDisk(date, language);
      if (disk) {
        memory.set(key, disk);
        return disk.sheet;
      }
    }
  }

  // The "today" branch always passes no `date` so NBG can serve its
  // edge-cached default response; explicit dates always go through with
  // ?date=YYYY-MM-DD.
  const sheet = await fetchRateSheet(isToday ? { language } : { language, date });
  const fetchedAt = Date.now();
  memory.set(key, { sheet, fetchedAt });
  writeDisk(sheet, fetchedAt);
  return sheet;
}

export async function getRate(code: string, opts: GetSheetOptions = {}): Promise<number> {
  const sheet = await getRateSheet(opts);
  const rate = sheet.rates.get(code.toUpperCase());
  if (!rate) {
    throw new Error(`Currency ${code.toUpperCase()} not found in NBG sheet for ${sheet.date}`);
  }
  return rate.rate;
}

/**
 * Drop in-process cache. Disk cache is left alone — restart re-hydrates
 * from disk. Tests use this between cases.
 */
export function clearMemoryCache() {
  memory.clear();
}
