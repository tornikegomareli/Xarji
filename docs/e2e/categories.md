# Categories — manual E2E

Surface: `client/src/pages/Categories.tsx`.

**Demo mode required.** Confirm via Prereqs in `README.md` before running.

Open `http://localhost:5173/categories`. Default range: **Month**.

## Demo-data baseline (current month)

- ≥9 of the 11 default categories should be populated this month (Subscriptions guaranteed via the recurring subs; Cash via ATM; the rest from the random merchant draw).
- Largest category by total varies day-to-day but Shopping or Travel is usually #1 due to the IKEA outlier landing in Shopping.
- Subscriptions category contains: Spotify, Netflix, Claude, GitHub, iCloud+, Figma (any whose `dayOfMonth` ≤ today).
- Selecting Shopping → IKEA visible in merchant list with avg ≥₾1,000 (because of the outlier).
- Selecting Subscriptions → 6 merchants ordered by amount: Claude (₾56), Figma (₾42), Netflix (₾32), Spotify (₾17), GitHub (₾11), iCloud+ (₾8).

---

## T-CAT-01 — Page loads with Month-scope summary

**Steps**
1. Navigate to `/categories`.

**Expected**
- Eyebrow: "Where your money went · <month>".
- Title: "Categories".
- Range buttons visible top-right with **Month** highlighted.
- Left card: donut + scrollable list of categories ordered by total descending.
- Right column: detail card for the top category by default + merchant rows + recent-in-category transactions.
- If the active range has no transactions, page shows the empty-state card "No transactions in <month> yet."

---

## T-CAT-02 — Range buttons re-scope every panel

**Steps**
1. Click **Today / Week / Year / Custom** in turn.

**Expected**
- Donut, list, detail card, merchant rows, and recent-in-category transactions all re-scope.
- Page reloads aggregates without flicker.
- Per-cat trend (top-right of the detail card, when shown) keeps its 6-month bucket window — that's intentional, the trend is always 6m even when the active range is shorter.

---

## T-CAT-03 — Left list is clickable, drives the detail pane

**Steps**
1. Click a category in the left list (not the donut).
2. Click another.

**Expected**
- Selected row highlights with `panelAlt` background and bold weight.
- Right detail card updates to show the new category's name, color dot, total, % of month, merchant count, transaction count, and recent rows.
- Per-cat trend chart (when `T.chartsVisible`) updates to that category's 6-month series.

---

## T-CAT-04 — Codex MEDIUM fix: stale selection clears on range switch

**Steps**
1. With **Month** active, click a non-default category in the left list (anything other than the first/largest).
2. Switch to **Today** (or any range where that category has zero transactions).
3. Observe the right pane.
4. Switch back to **Month**.

**Expected**
- After step 2: the previously-selected category is no longer in the left list. Right pane falls back to the **first available** category in the new range — it does NOT keep showing the stale category with empty totals and empty merchant/transaction lists.
- After step 4: the original month list is back. Right pane shows the first/largest category (default), since the prior selection was cleared.

This pins the Codex MEDIUM fix from PR #23 (`fdfffee`).

---

## T-CAT-05 — Per-cat trend bucket-click drill-down

**Steps**
1. Select any category that has trend data.
2. Click any visible bucket on the per-cat AreaChart (right of the detail card).

**Expected**
- URL changes to `/transactions?category=<id>&dateFrom=YYYY-MM-01&dateTo=YYYY-MM-DD` where dates bound the clicked bucket month.
- Transactions page lands with category filter pre-selected and Custom range showing that month.

---

## T-CAT-06 — Per-cat trend hover tooltip

**Steps**
1. Hover the per-cat AreaChart.

**Expected**
- Tooltip shows bucket label + `₾<value>` + (if prior bucket exists) `vs <prev label> ₾<prev value> ±X%`.
- Same theme/styling rules as the Dashboard trend tooltip.

---

## T-CAT-07 — Merchant row click drill-down

**Steps**
1. Click a merchant row in the "Merchants" card (right column, below the detail header).

**Expected**
- URL changes to `/transactions?category=<id>&merchant=<merchant-name>&dateFrom=<X>&dateTo=<Y>` where dates reflect the source page's active range.
- Transactions page lands with category + search both pre-filled.

---

## T-CAT-08 — "All →" link on Recent-in-category card

**Steps**
1. Click "All →" in the "Recent in <category>" card header.

**Expected**
- URL changes to `/transactions?category=<id>&dateFrom=<X>&dateTo=<Y>` where dates reflect the source page's active range.
- This pins the Codex HIGH fix's range propagation through the Categories page.

---

## T-CAT-09 — Donut on Categories does NOT navigate

**Steps**
1. Click directly on the donut on the Categories page (left card).

**Expected**
- No navigation. URL stays at `/categories`.
- The donut on this page is intentionally non-clickable — it competes with the in-page selection state on the left list. Test exists to prevent regression if someone wires `onSegmentClick` here in the future.
