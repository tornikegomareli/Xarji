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
}

export interface UseRangeStateResult {
  range: DateRange;
  props: RangeStateProps;
}

export function useRangeState(initial: RangeKey = "Month"): UseRangeStateResult {
  const [active, setActive] = useState<RangeKey>(initial);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  // `clockTick` advances at the next local-midnight boundary so a
  // long-lived dashboard tab doesn't keep showing yesterday's "Today"
  // (or the previous month's "Month") after the calendar rolls over.
  // Including it in the memo deps below recomputes the range without
  // wedging it on a stale `new Date()` from the initial render.
  const clockTick = useMidnightTick();

  const range = useMemo(
    () => rangeFromKey(active, new Date(), { start: customStart, end: customEnd }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, customStart, customEnd, clockTick]
  );

  return {
    range,
    props: {
      active,
      onRange: (k) => setActive(k as RangeKey),
      customStart,
      customEnd,
      onCustomChange: (start, end) => {
        setCustomStart(start);
        setCustomEnd(end);
      },
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
