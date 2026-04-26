# Merchants — manual E2E

Surface: `client/src/pages/Merchants.tsx`.

**Demo mode required.** Confirm via Prereqs in `README.md` before running.

Open `http://localhost:5173/merchants`. Default range: **Month**.

## Demo-data baseline (current month)

- "<N> unique" pill shows ≥20 unique merchants in current month.
- IKEA at or near the top of the table (₾4,280 single-tx outlier).
- All recurring subs visible: Spotify, Netflix, Claude, GitHub, iCloud+, Figma — each with `×1` or `×2` count.
- Pulse Fitness present with `×1` count.
- Search for `wolt` filters to Wolt rows (≥1 successful payment + 2 declines exist on the demo dataset; declines don't appear in the merchant table since it's payments-only).

---

## T-MERCH-01 — Page loads with Month-scope merchant table

**Steps**
1. Navigate to `/merchants`.

**Expected**
- Eyebrow: "Who you paid · <range.label>".
- Title: "Merchants".
- Range buttons visible top-right with **Month** highlighted.
- Top-right: "<N> unique" pill.
- Search box visible.
- Table header row showing the active columns. On wide viewports: `Merchant / Category / Tx / Avg / Share / Total`. On narrow: `Merchant / Tx / Total` only.
- Rows ordered by Total descending.

---

## T-MERCH-02 — Range buttons re-scope the table

**Steps**
1. Click **Today / Week / Year / Custom**.

**Expected**
- "<N> unique" pill updates.
- Eyebrow updates with the new `range.label`.
- Rows recompute totals/counts/averages for the new window.
- If the new range has no data, "No merchants match." renders inside the scrollable area.

---

## T-MERCH-03 — Search filters by name OR raw SMS

**Steps**
1. Type a known merchant fragment into the search box.
2. Type a fragment that only appears in raw SMS (not the cleaned merchant name) — e.g. a POS descriptor.

**Expected**
- Rows filter as you type.
- Both cleaned merchant name and the union of all raw SMS strings for that merchant are matched (`searchBlob` lowercased substring).
- Clear the search → all rows back.

---

## T-MERCH-04 — Table row click drill-down propagates active range

**Steps**
1. With **Month** active, click any merchant row.
2. Navigate back, switch to **Year**, click any row.
3. Navigate back, switch to **Custom** with explicit dates, click any row.

**Expected (each)**
- URL changes to `/transactions?merchant=<merchant-name>&dateFrom=<X>&dateTo=<Y>`.
- Dates reflect the **source page's active range**, not a hardcoded month. Year click → `2026-01-01`/`2026-12-31`. Custom click → the picked dates.
- Transactions page lands with search box pre-filled and **Custom** range highlighted.

This pins the Codex HIGH fix from PR #23 (`c214df0`).

---

## T-MERCH-05 — Row hover affordance

**Steps**
1. Hover any row.

**Expected**
- Cursor flips to pointer.
- Row remains visually distinguishable (row hover styling is currently minimal but should still feel clickable). Not a strict assertion — just confirm the row doesn't feel inert.

---

## T-MERCH-06 — Avg + share columns

**Steps**
1. Pick a row and verify the math.

**Expected**
- `Tx` = total transaction count for that merchant in the active range.
- `Avg` = `Total / Tx` rounded.
- `Share` = `Total / sum(all merchants in range) * 100`, rendered as a small bar + percentage.
- `Total` = `₾<rounded>` GEL equivalent.

---

## T-MERCH-07 — Narrow viewport hides Category/Avg/Share

**Steps**
1. Resize browser window narrow (or use DevTools device toolbar to a phone width).

**Expected**
- Table collapses to `Merchant / Tx / Total` columns.
- Search and range buttons remain accessible (range buttons may stack into a different layout via the PageHeader).
