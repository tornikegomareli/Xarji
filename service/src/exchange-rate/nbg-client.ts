/**
 * Thin HTTP client for the National Bank of Georgia (NBG) currency
 * endpoint. Mirrors the surface of the Stichoza/nbg-currency PHP library:
 * fetch a day's full rate sheet for a given language, parse it into
 * normalised per-currency entries, surface NBG's quirky error shapes as
 * typed exceptions.
 *
 * Endpoint:
 *   GET https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/{lang}/json
 *       [?date=YYYY-MM-DD]
 *
 * `lang` accepts "ka" (Georgian, default), "en", or "ru". Omitting the
 * date returns today's rates in the Asia/Tbilisi timezone (NBG publishes
 * once per business day).
 *
 * The raw payload quotes some currencies per N units (e.g. JPY per 100,
 * UZS per 10000). The PHP lib divides `rate / quantity` to give a
 * GEL-per-1-unit rate; we do the same so callers never have to think
 * about quantity.
 */

export type NbgLanguage = "ka" | "en" | "ru";

export const NBG_TIMEZONE = "Asia/Tbilisi";
const NBG_URL = "https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/%s/json";

export interface NbgRawCurrency {
  code: string;
  rate: number;
  quantity: number;
  name: string;
  diff: number;
  date: string;
  validFromDate: string;
}

interface NbgRawResponseEntry {
  date: string;
  currencies: NbgRawCurrency[];
}

export interface NbgCurrencyRate {
  code: string;
  rate: number; // GEL per 1 unit of the foreign currency
  diff: number; // change vs previous publication, normalised by quantity
  change: -1 | 0 | 1;
  name: string;
  date: string; // ISO date (when this rate was published)
  validFrom: string; // ISO date (when this rate becomes valid)
}

export interface NbgRateSheet {
  date: string; // YYYY-MM-DD in the requested timezone
  language: NbgLanguage;
  rates: Map<string, NbgCurrencyRate>;
}

export class NbgRequestFailedError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "NbgRequestFailedError";
  }
}

export class NbgInvalidLanguageError extends Error {
  constructor(language: string) {
    super(`NBG rejected language code "${language}"`);
    this.name = "NbgInvalidLanguageError";
  }
}

export class NbgDateNotFoundError extends Error {
  constructor(date: string) {
    super(`NBG returned no rates for ${date}`);
    this.name = "NbgDateNotFoundError";
  }
}

export class NbgFutureDateError extends Error {
  constructor(date: string) {
    super(`Cannot request future date ${date}`);
    this.name = "NbgFutureDateError";
  }
}

/**
 * YYYY-MM-DD in Asia/Tbilisi for a Date instance. NBG publishes on its
 * local calendar; using the user's local date would skew by hours when
 * the user is in a different timezone (and rotate the day boundary
 * around midnight Tbilisi).
 */
export function formatTbilisiDate(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: NBG_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

function todayTbilisi(): string {
  return formatTbilisiDate(new Date());
}

function isFutureDate(yyyymmdd: string): boolean {
  return yyyymmdd > todayTbilisi();
}

interface FetchRatesOptions {
  language?: NbgLanguage;
  date?: Date | string;
  /** Override fetch (tests). */
  fetcher?: typeof fetch;
}

/**
 * Fetch a day's NBG rate sheet. `date` undefined → today (Tbilisi).
 *
 * The PHP library passes no query string at all when the date is "today"
 * to hit NBG's edge-cached default response — same here. Explicit dates
 * always go through with `?date=`.
 */
export async function fetchRateSheet(opts: FetchRatesOptions = {}): Promise<NbgRateSheet> {
  const language: NbgLanguage = opts.language ?? "ka";
  const fetcher = opts.fetcher ?? fetch;

  let dateString: string | null;
  if (opts.date === undefined) {
    dateString = null;
  } else if (typeof opts.date === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
      throw new NbgRequestFailedError(`Date "${opts.date}" must be YYYY-MM-DD`);
    }
    dateString = opts.date;
  } else {
    dateString = formatTbilisiDate(opts.date);
  }

  if (dateString !== null && isFutureDate(dateString)) {
    throw new NbgFutureDateError(dateString);
  }

  const url = NBG_URL.replace("%s", language) + (dateString ? `?date=${dateString}` : "");

  let response: Response;
  try {
    response = await fetcher(url, { method: "GET" });
  } catch (err) {
    throw new NbgRequestFailedError(`Network error contacting NBG: ${String(err)}`, err);
  }

  if (!response.ok) {
    throw new NbgRequestFailedError(`NBG returned HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    throw new NbgRequestFailedError("NBG returned non-JSON response", err);
  }

  // NBG signals an invalid language by returning an object with an
  // `errors.key` field — and the key itself is misspelled "langaugeCode"
  // in the upstream API (sic). Surface it as a typed error so callers
  // can recover (e.g. fall back to "ka").
  if (payload && typeof payload === "object" && "errors" in payload) {
    const errors = (payload as { errors?: { key?: string } }).errors;
    if (errors?.key === "langaugeCode" || errors?.key === "languageCode") {
      throw new NbgInvalidLanguageError(language);
    }
  }

  if (!Array.isArray(payload) || payload.length === 0) {
    throw new NbgDateNotFoundError(dateString ?? todayTbilisi());
  }

  const entry = payload[0] as Partial<NbgRawResponseEntry>;
  if (!entry || typeof entry.date !== "string" || !Array.isArray(entry.currencies)) {
    throw new NbgDateNotFoundError(dateString ?? todayTbilisi());
  }

  const rates = new Map<string, NbgCurrencyRate>();
  for (const raw of entry.currencies) {
    const normalised = normaliseCurrency(raw);
    if (normalised) rates.set(normalised.code, normalised);
  }

  return {
    date: dateString ?? entry.date.slice(0, 10),
    language,
    rates,
  };
}

function normaliseCurrency(raw: Partial<NbgRawCurrency> | null | undefined): NbgCurrencyRate | null {
  if (!raw || typeof raw.code !== "string" || raw.code.length === 0) return null;
  if (typeof raw.rate !== "number" || !Number.isFinite(raw.rate)) return null;
  const quantity = typeof raw.quantity === "number" && raw.quantity > 0 ? raw.quantity : 1;
  const rate = raw.rate / quantity;
  const diff = typeof raw.diff === "number" ? raw.diff / quantity : 0;
  const change: -1 | 0 | 1 = diff > 0 ? 1 : diff < 0 ? -1 : 0;
  return {
    code: raw.code.toUpperCase(),
    rate,
    diff,
    change,
    name: raw.name ?? "",
    date: typeof raw.date === "string" ? raw.date : "",
    validFrom: typeof raw.validFromDate === "string" ? raw.validFromDate : "",
  };
}

/**
 * Convenience: fetch a single currency's rate. Mirrors `NbgCurrency::rate`
 * in the PHP lib. Throws if the currency isn't published on that date.
 */
export async function fetchRate(code: string, opts: FetchRatesOptions = {}): Promise<number> {
  const sheet = await fetchRateSheet(opts);
  const rate = sheet.rates.get(code.toUpperCase());
  if (!rate) {
    throw new NbgDateNotFoundError(sheet.date);
  }
  return rate.rate;
}
