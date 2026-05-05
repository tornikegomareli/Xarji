# Ranges & date plumbing — manual E2E

Cross-cutting tests for `useRangeState`, `dateRange.ts`, and the URL-param
contract every page reads. These exercise invariants that aren't owned by
any one page — they live across the whole app.

**Demo mode required.** Confirm via Prereqs in `README.md` before running.

Run this file in addition to the page-specific files when changing
`client/src/lib/dateRange.ts` or `client/src/hooks/useRangeState.ts`.

---

## T-RANGE-01 — Range button consistency across pages

**Steps**
1. Open `/`. Switch to **Year**.
2. Navigate to `/transactions` via the sidebar.
3. Navigate to `/categories`.
4. Navigate to `/merchants`.
5. Navigate back to `/`.

**Expected**
- Each page mounts with **Month** by default. Range state is per-page, not global. Switching to Year on `/` does NOT carry to `/transactions` automatically.
- This is intentional — every page owns its own `useRangeState` instance.

---

## T-RANGE-02 — Custom range survives midnight rollover

(Hard to reproduce on demand without time-travel; tested via `useMidnightTick`
unit logic. Document for awareness — when running over midnight, the "Today"
preset should refresh without a manual reload.)

**Expected**
- A long-lived dashboard tab left open across local midnight should re-render
  the "Today" range to the new calendar day on the next state tick.

---

## T-RANGE-03 — `<input type="date">` parses as local-time

**Steps**
1. On any page, switch to **Custom**.
2. Set `From` and `To` to the same date — e.g. today.
3. Observe the resulting filter.

**Expected**
- The day's transactions all appear in the filtered list.
- This guards against `new Date("YYYY-MM-DD")` parsing the date as UTC and
  silently shifting boundaries by one day west of UTC. On macOS in Tbilisi
  (+04:00) the bug wouldn't surface; on a North American developer machine
  it would. Test still runs because `parseLocalIsoDate` is the actual
  shared code path.

---

## T-RANGE-04 — Codex MEDIUM fix: malformed dates fall back to default

**Steps**
1. Navigate to `/transactions?dateFrom=garbage&dateTo=lol`.
2. Then `/transactions?dateFrom=2026-99-99&dateTo=2026-04-30`.
3. Then `/transactions?dateFrom=2026-04-30&dateTo=2026-04-01` (start > end).
4. Then `/transactions?dateFrom=&dateTo=` (empty).

**Expected (each)**
- Page renders Month by default, NOT empty.
- No console errors.
- Custom date inputs not visible.

This pins `isValidIsoDateRange` in `client/src/lib/dateRange.ts`.

---

## T-RANGE-05 — Codex HIGH fix: drill-downs preserve source range

**Steps**
1. Open `/`, switch to **Year**, click any donut segment.
2. Open `/`, switch to **Year**, click any top-merchant tile.
3. Open `/categories`, switch to **Year**, click any merchant row.
4. Open `/merchants`, switch to **Year**, click any table row.

**Expected (each)**
- Destination URL includes `dateFrom=2026-01-01&dateTo=2026-12-31` (or whatever year is current). NOT the current month's bounds.
- Repeat with **Custom** active and explicit dates → destination URL carries those exact dates.

This pins `rangeToDateParams` and the threading through every drill-down call site.

---

## T-RANGE-06 — Bucket clicks override source range

**Steps**
1. Open `/`, switch to **Year**.
2. Click any November bucket on the 9-month trend chart.

**Expected**
- URL → `/transactions?dateFrom=2025-11-01&dateTo=2025-11-30`.
- The clicked bucket's specific month wins over the source page's Year range. (A more specific signal beats a broader one.)
- Repeat from `/categories` per-cat trend: same behaviour.

---

## T-RANGE-07 — `previousRange()` produces same-shape windows

(Visual verification via the Dashboard hero.)

**Steps**
1. Switch to **Today** → look at the "vs <prev>" pill.
2. Switch to **Week** → same.
3. Switch to **Month** → same.
4. Switch to **Year** → same.
5. Switch to **Cycle** → same.

**Expected**
- Each pill compares against the equivalent prior period (yesterday, last
  week, last month, last year, previous cycle). The label format on the pill matches the
  source range shape.
- Cycle: prior period is the previous ~30-day cycle window (e.g. if active is Apr 25–May 24, prev is Mar 25–Apr 24).
