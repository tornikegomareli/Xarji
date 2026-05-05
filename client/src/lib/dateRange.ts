// Shared date-range model the page-header range buttons drive. Aggregator
// hooks (useRangeStats, useRangeCredits, useRangeTopMerchants) consume
// `DateRange` directly so a button change re-runs the right slice of the
// transactions list with no per-hook special-casing.
//
// "Custom" is a placeholder until the user sets explicit start/end dates
// via the inline date inputs in PageHeader; before they do, it falls back
// to the last 30 days so the UI never shows a blank screen.

import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  format,
} from "date-fns";

export type RangeKey = "Today" | "Week" | "Month" | "Year" | "Custom" | "Cycle";

export const RANGE_OPTIONS: RangeKey[] = ["Today", "Week", "Month", "Year", "Custom", "Cycle"];

export interface DateRange {
  /** Inclusive start, local time. */
  start: Date;
  /** Inclusive end, local time. */
  end: Date;
  /** "April 2026", "Apr 1 – 26", etc. — used for chart subtitles + tooltips. */
  label: string;
  /** Which named range this came from. "Custom" means the user picked a
   *  bespoke window via the date inputs. */
  key: RangeKey;
  /** Original cycle anchor day, preserved across previousRange/nextRange
   *  transformations so end-of-month clamping (e.g. day 31 in Feb)
   *  doesn't lose the user's intended cycle day when we walk back to a
   *  prior period. Only set on Cycle ranges. */
  cycleDay?: number;
}

function lastDayOfMonth(year: number, monthZeroIndexed: number): number {
  return new Date(year, monthZeroIndexed + 1, 0).getDate();
}

export interface CustomRange {
  start: string; // YYYY-MM-DD
  end: string;
  cycleDay?: number;   // 1–31; which day of the month each cycle starts
  cycleOffset?: number; // 0 = current cycle, -1 = previous, +1 = next
}

/** Compute a pay-cycle DateRange for a given cycle-start day and offset.
 *  offset=0 → the cycle whose start day most recently passed (current);
 *  offset=-1 → the one before that; offset=+1 → the upcoming one.
 *
 *  All start/end Dates are clamped to the actual last day of their target
 *  month so cycleDay=29..31 doesn't overflow into the following month
 *  (e.g. day 31 in Feb would otherwise produce a March start date). The
 *  user's chosen cycleDay is preserved on the returned DateRange so
 *  previousRange can walk back without losing the original anchor.
 */
export function rangeFromCycle(cycleDay: number, offset: number, now: Date): DateRange {
  const day = Math.max(1, Math.min(31, Math.round(cycleDay)));

  // Determine the base month: the most recent month where the (clamped)
  // cycle anchor has already passed. Clamp `day` against the current
  // month's last day so e.g. now=Feb 5 + day=31 still resolves correctly
  // (it'd otherwise treat "Feb 31" as overflowed Mar 3 and pick the wrong
  // base month). (Codex P2 on PR #44.)
  const nowMonthLast = lastDayOfMonth(now.getFullYear(), now.getMonth());
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), Math.min(day, nowMonthLast));
  const baseMonth = thisMonthStart > now ? now.getMonth() - 1 : now.getMonth();

  // Anchor month-of-start via Date(yr, mo, 1) so Date normalises any
  // negative or 12+ month value into a valid (year, month) pair.
  const startAnchor = new Date(now.getFullYear(), baseMonth + offset, 1);
  const startMonthLast = lastDayOfMonth(
    startAnchor.getFullYear(),
    startAnchor.getMonth()
  );
  const startDate = new Date(
    startAnchor.getFullYear(),
    startAnchor.getMonth(),
    Math.min(day, startMonthLast)
  );

  // End is "day-1 of the next calendar month". day=1 → day=0, which JS
  // Date interprets as "last day of the previous (= start) month" so a
  // day=1 cycle is one calendar month exactly. For day=2..31 we clamp
  // day-1 to the end month's last day so day=31 ending in Feb→Apr also
  // doesn't overflow.
  const endAnchor = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1);
  const endMonthLast = lastDayOfMonth(
    endAnchor.getFullYear(),
    endAnchor.getMonth()
  );
  const endDay = day === 1 ? 0 : Math.min(day - 1, endMonthLast);
  const endDate = endOfDay(
    new Date(endAnchor.getFullYear(), endAnchor.getMonth(), endDay)
  );

  return {
    start: startOfDay(startDate),
    end: endDate,
    label: `${format(startDate, "MMM d")} – ${format(endDate, "MMM d, yyyy")}`,
    key: "Cycle",
    cycleDay: day,
  };
}

/** Build a DateRange from the active button + optional custom dates.
 *  `now` is injected so tests / per-page mounts compute against the
 *  same instant for the lifetime of a render. */
export function rangeFromKey(key: RangeKey, now: Date, custom?: CustomRange): DateRange {
  switch (key) {
    case "Today": {
      const start = startOfDay(now);
      const end = endOfDay(now);
      return { start, end, label: format(start, "MMMM d, yyyy"), key };
    }
    case "Week": {
      // Calendar week starting Monday — matches the convention most
      // Georgian users expect (Sunday-start would push half the
      // weekend into the next bucket).
      const start = startOfWeek(now, { weekStartsOn: 1 });
      const end = endOfWeek(now, { weekStartsOn: 1 });
      return { start, end, label: `${format(start, "MMM d")} – ${format(end, "MMM d")}`, key };
    }
    case "Month": {
      const start = startOfMonth(now);
      const end = endOfMonth(now);
      return { start, end, label: format(start, "MMMM yyyy"), key };
    }
    case "Year": {
      const start = startOfYear(now);
      const end = endOfYear(now);
      return { start, end, label: format(start, "yyyy"), key };
    }
    case "Cycle":
      return rangeFromCycle(custom?.cycleDay ?? 25, custom?.cycleOffset ?? 0, now);
    case "Custom": {
      if (isValidIsoDateRange(custom)) {
        // <input type="date"> emits YYYY-MM-DD which `new Date(...)`
        // parses as UTC midnight. In timezones west of UTC that lands
        // on the previous calendar day, so a user-picked boundary
        // would silently exclude the intended last day. Parse the
        // components manually so the bounds line up with the user's
        // local calendar regardless of timezone.
        const start = startOfDay(parseLocalIsoDate(custom!.start));
        const end = endOfDay(parseLocalIsoDate(custom!.end));
        return { start, end, label: `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`, key };
      }
      // Fallback while the user hasn't set explicit dates yet, or when
      // a deep-link / stale bookmark passed malformed values that
      // would otherwise resolve to NaN bounds (every transaction
      // filtered out, page looks empty with no error).
      const start = startOfDay(subDays(now, 29));
      const end = endOfDay(now);
      return { start, end, label: "Last 30 days", key };
    }
  }
}

/** Parses a YYYY-MM-DD string as a local-time date. `new Date(string)`
 *  treats it as UTC; we want the bounds to follow the user's wall
 *  clock so date-range filters match what they typed. */
function parseLocalIsoDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when both bounds are syntactically valid YYYY-MM-DD, parse to
 *  real local-time dates, and start ≤ end. Used to gate the Custom
 *  branch so a malformed deep-link or stale bookmark falls back to
 *  the "Last 30 days" default instead of silently emptying the page. */
export function isValidIsoDateRange(custom: CustomRange | undefined | null): boolean {
  if (!custom?.start || !custom?.end) return false;
  if (!ISO_DATE_RE.test(custom.start) || !ISO_DATE_RE.test(custom.end)) return false;
  const start = parseLocalIsoDate(custom.start);
  const end = parseLocalIsoDate(custom.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return start.getTime() <= end.getTime();
}

/** Returns a {dateFrom, dateTo} pair suitable for passing to a drill-down
 *  link so the destination Transactions page lands on the same window the
 *  source page was viewing. Always emits both keys so callers can spread
 *  the result into a URLSearchParams build directly. */
export function rangeToDateParams(range: DateRange): { dateFrom: string; dateTo: string } {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { dateFrom: fmt(range.start), dateTo: fmt(range.end) };
}

export function isInRange(ts: number, range: DateRange): boolean {
  return ts >= range.start.getTime() && ts <= range.end.getTime();
}

/** Returns the equivalent range shifted back by one period — used for
 *  the "vs. previous period" comparison labels in tooltips and stat
 *  cards. */
export function previousRange(range: DateRange): DateRange {
  const span = range.end.getTime() - range.start.getTime();
  const prevEnd = new Date(range.start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - span);
  // Anchor the comparison label to the same shape as the source.
  switch (range.key) {
    case "Today":
      return { start: startOfDay(prevStart), end: endOfDay(prevStart), label: format(prevStart, "MMM d, yyyy"), key: "Today" };
    case "Week":
      return { start: startOfWeek(prevStart, { weekStartsOn: 1 }), end: endOfWeek(prevStart, { weekStartsOn: 1 }), label: `${format(prevStart, "MMM d")} – ${format(prevEnd, "MMM d")}`, key: "Week" };
    case "Month":
      return { start: startOfMonth(prevStart), end: endOfMonth(prevStart), label: format(prevStart, "MMMM yyyy"), key: "Month" };
    case "Year":
      return { start: startOfYear(prevStart), end: endOfYear(prevStart), label: format(prevStart, "yyyy"), key: "Year" };
    case "Cycle": {
      // Pay cycles are calendar-anchored, not millisecond-spans. Walking
      // back by `(end - start)` ms (the generic shift above) lands one
      // day off whenever the prior cycle has a different length than
      // the current one — e.g. Apr 25–May 24 (30 days) shifted back by
      // 30 days gives Mar 26–Apr 24 instead of the documented
      // Mar 25–Apr 24. Recompute via rangeFromCycle anchored to the day
      // before the active cycle's start so the "most recent past day-N"
      // logic resolves into the prior calendar month, preserving the
      // original cycleDay through end-of-month clamping.
      // (Codex P2 on PR #44.)
      const cycleDay = range.cycleDay ?? range.start.getDate();
      const refDate = new Date(range.start.getTime() - 86400000);
      return rangeFromCycle(cycleDay, 0, refDate);
    }
    case "Custom":
    default:
      return { start: prevStart, end: prevEnd, label: `${format(prevStart, "MMM d")} – ${format(prevEnd, "MMM d, yyyy")}`, key: "Custom" };
  }
}
