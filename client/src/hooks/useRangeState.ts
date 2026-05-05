// Shared range-button state for any page that renders the
// Today/Week/Month/Year/Custom switcher in PageHeader. Returns the
// derived DateRange + the props PageHeader needs (active/onRange/
// custom inputs). Pages stay one-liner thin.

import { useEffect, useMemo, useState } from "react";
import { rangeFromKey, type DateRange, type RangeKey } from "../lib/dateRange";

export interface RangeStateProps {
  active: RangeKey;
  onRange: (key: string) => void;
  customStart: string;
  customEnd: string;
  onCustomChange: (start: string, end: string) => void;
  cycleDay: number;
  cycleOffset: number;
  cycleLabel: string;
  onCycleDayChange: (day: number) => void;
  onCyclePrev: () => void;
  onCycleNext: () => void;
}

export interface UseRangeStateResult {
  range: DateRange;
  props: RangeStateProps;
}

export interface UseRangeStateOptions {
  /** Pre-fill custom dates and switch to "Custom" on mount. Used by drill-down
   *  links that pass `?dateFrom=…&dateTo=…` so the user lands on the same
   *  window the chart bar represented. Both must be YYYY-MM-DD. */
  customInitial?: { start: string; end: string };
}

function loadCycleDay(): number {
  const stored = parseInt(localStorage.getItem("xarji-cycle-day") ?? "25", 10);
  return Number.isNaN(stored) ? 25 : Math.max(1, Math.min(31, stored));
}

export function useRangeState(
  initial: RangeKey = "Month",
  options?: UseRangeStateOptions
): UseRangeStateResult {
  const customInitial = options?.customInitial;
  const useCustom = !!(customInitial && customInitial.start && customInitial.end);
  const [active, setActive] = useState<RangeKey>(useCustom ? "Custom" : initial);
  const [customStart, setCustomStart] = useState(useCustom ? customInitial!.start : "");
  const [customEnd, setCustomEnd] = useState(useCustom ? customInitial!.end : "");
  const [cycleDay, setCycleDay] = useState<number>(loadCycleDay);
  const [cycleOffset, setCycleOffset] = useState(0);
  const clockTick = useMidnightTick();

  const range = useMemo(
    () => rangeFromKey(active, new Date(), { start: customStart, end: customEnd, cycleDay, cycleOffset }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, customStart, customEnd, cycleDay, cycleOffset, clockTick]
  );

  return {
    range,
    props: {
      active,
      onRange: (k) => {
        if (k === "Cycle") setCycleOffset(0);
        setActive(k as RangeKey);
      },
      customStart,
      customEnd,
      onCustomChange: (start, end) => {
        setCustomStart(start);
        setCustomEnd(end);
      },
      cycleDay,
      cycleOffset,
      cycleLabel: range.key === "Cycle" ? range.label : "",
      onCycleDayChange: (day) => {
        const clamped = Math.max(1, Math.min(31, day));
        setCycleDay(clamped);
        localStorage.setItem("xarji-cycle-day", String(clamped));
        setCycleOffset(0);
      },
      onCyclePrev: () => setCycleOffset((o) => o - 1),
      onCycleNext: () => setCycleOffset((o) => o + 1),
    },
  };
}

/** Returns a state value that bumps once per local-midnight rollover.
 *  Cheap (one timeout at a time, no per-second polling) and only fires
 *  while the tab is mounted, so it doesn't leak when the user
 *  navigates away. */
function useMidnightTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let timeoutId: number | null = null;
    const schedule = () => {
      const now = new Date();
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        0,
        0
      ).getTime();
      // +500ms cushion so we land safely on the new day even if the
      // event loop runs the callback a few ms early.
      const ms = Math.max(1000, nextMidnight - now.getTime() + 500);
      timeoutId = window.setTimeout(() => {
        setTick((t) => t + 1);
        schedule();
      }, ms);
    };
    schedule();
    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, []);
  return tick;
}
