# Dashboard — manual E2E

Surface: `client/src/pages/Dashboard.tsx` and the hooks it consumes.

**Demo mode required.** Confirm via Prereqs in `README.md` before running.
Open `http://localhost:5173/`. Default range: **Month**.

## Demo-data baseline (current month)

The current-month view should always include:

- ≥100 successful payments distributed across 11 categories.
- 5+ recurring subs (Spotify, Netflix, Claude, GitHub, iCloud+, Figma — minus any whose `dayOfMonth` falls after today).
- 1 IKEA purchase ₾4,280 (BOG, large outlier).
- 1 Pulse Fitness purchase ₾95 (SOLO, brand-new merchant signal).
- 2× Wolt declines on card `8891` within 4h of each other (yesterday).
- Income ≥ ₾15,000 from Tech Co LLC alone (₾7500 × 2 salaries) plus freelance + refunds + Mom + Stripe Payout. (Sized so /budgets has positive net cashflow at any day-of-month — see `budgets.md`.)

These numbers are deterministic for a given calendar day; reseeded as the day rolls over.

---

## T-DASH-01 — Page loads with Month-scope hero

**Steps**
1. Navigate to `http://localhost:5173/`.
2. Wait for the dashboard to render.

**Expected**
- Eyebrow: `Good morning|afternoon|evening` (depending on local hour).
- Title: `<current month name> <year>, at a glance` (e.g. `April 2026, at a glance`).
- Range buttons visible top-right: **Today / Week / Month / Year / Custom / Cycle** with **Month** highlighted.
- Sidebar shows ~1,000+ transactions counter (proves demo mode is active).
- Hero "You spent" figure ≥ ₾10,000 (current-month payments + IKEA outlier + recurring subs).
- Subline: `±₾<delta> more|less than <prev month name> · <N> days · <count> transactions` where `<N>` ≤ days elapsed in the month and `<count>` ≥ 100 on demo data.
- Spending mix donut renders with ≥5 colored segments.
- Today & recent shows newest-first activity from multiple senders (SOLO / TBC / BOG visible).
- Top merchants card shows 5 tiles, each with category color dot + name, merchant name, `₾<total>`, `×<count>`.

---

## T-DASH-02 — Range buttons re-scope every widget

**Steps**
1. From Month view, click **Week**.
2. Click **Year**.
3. Click **Custom**, then set `From` and `To` date inputs to a known window (e.g. last 30 days).
4. Click **Today**.
5. Click **Cycle** — leave the default day (25). Use ← → to navigate one cycle back and one cycle forward.
6. Click **Month** to return.

**Expected (each step)**
- Eyebrow on the hero card updates: e.g. Week → "OUTGOING · <Mon-Sun range>", Year → "OUTGOING · <year>", Custom → "OUTGOING · <Mmm d – Mmm d>", Today → "OUTGOING · <full date>", Cycle → "OUTGOING · <Mmm d – Mmm d, yyyy>".
- Page title updates: "<range.label>, at a glance" — e.g. "2026, at a glance" for Year, "April 1 – April 27, 2026, at a glance" for Custom.
- "You spent" figure recomputes; Year ≥ Month, Today usually small, Week ≤ Month.
- Subline `<N> days · <count> transactions` matches the active range length capped at days elapsed (Today = 1, Week ≤ 7, Year up to 117 in late April).
- Donut center label matches the range (e.g. Year → `<year>`, Month → uppercase month name, Today → date label).
- Top merchants title reads "Top merchants · <range.label>".
- Custom button: when active, two `<input type="date">` controls render inline in the header.
- Cycle button: when active, a `← [Mmm d – Mmm d, yyyy] →` navigation pill and a `Day [N]` input appear inline; ← shifts to the prior cycle, → shifts forward.

---

## T-DASH-03 — Hero "vs prior period" delta

**Steps**
1. With **Month** active, observe the pill in the top-right of the hero card.
2. Switch to **Year** and re-observe.

**Expected**
- Pill shows `↑ X.X% vs <prev period short label>` (or `↓` if down). Color: accent (coral) for an increase in spending, green for a decrease.
- Subline `+₾<delta> more|less than <prev period name>` matches the pill's direction.
- For Year view, "vs 2025" should appear in the pill if there's data for 2025.

---

## T-DASH-04 — AreaChart hover tooltip (9-month trend)

**Steps**
1. Hover the area chart at the bottom of the hero card.
2. Move the cursor across multiple month buckets.

**Expected**
- A tooltip appears anchored to the active bucket, showing:
  - bucket label (e.g. `NOV`)
  - current value formatted `₾<value>`
  - if a prior bucket exists in the series: `vs <prev label> ₾<prev value> ±X%`
- Delta uses **green** for an increase (current > prior), **accent (coral)** for a decrease.
- Active dot draws a white-filled circle with a 1.5px stroke at the hovered point.
- Tooltip background, border, and font follow the active theme (toggle dark/light via the tweaks panel — the tooltip should track).

---

## T-DASH-05 — AreaChart click drill-down

**Steps**
1. Click the area chart on a visible month (e.g. November).

**Expected**
- URL changes to `/transactions?dateFrom=YYYY-MM-01&dateTo=YYYY-MM-DD` where the dates bound the clicked month.
- Transactions page renders with **Custom** range highlighted; the date inputs in the header show the same window.
- Transactions list contains only entries from that month.

---

## T-DASH-06 — Donut hover tooltip

**Steps**
1. Hover the spending-mix donut on each colored ring segment in turn.

**Expected**
- The donut shows ≥5 colored segments. Top categories on demo data are typically Shopping, Travel, Other, Transport, Dining (order may vary by day).
- A tooltip appears anchored to the hovered segment showing:
  - color dot
  - segment name (e.g. `Shopping`, `Travel`, `Transport`, `Dining`, `Health`, `Utilities`, `Subscriptions`, `Groceries`, `Travel`, `Fun`, `Cash`)
  - `₾<value>` (rounded)
  - `<X.X>% of total`
- Tooltip background follows the active theme (toggle dark/light via tweaks panel — tooltip should track).

---

## T-DASH-07 — Donut click drill-down propagates active range

**Steps**
1. With **Month** active, click any donut segment.
2. Navigate back, switch to **Year**, click any donut segment.
3. Navigate back, switch to **Custom** with a known `dateFrom`/`dateTo`, click any donut segment.

**Expected (each)**
- URL changes to `/transactions?category=<id>&dateFrom=<X>&dateTo=<Y>` where:
  - `<id>` is the clicked segment's category id.
  - `<X>`/`<Y>` reflect the **source page's active range**, NOT a hardcoded month. Year click → `2026-01-01`/`2026-12-31`. Custom click → the picked custom dates.
- Transactions page lands with **Custom** range highlighted (because it received explicit dates) and category filter pre-selected.
- Transactions list reflects both filters.

This test pins **Codex HIGH fix** from PR #23 (`c214df0`).

---

## T-DASH-08 — Donut center / hole click is a no-op

**Steps**
1. Click the empty center hole of the donut (inside the inner radius).

**Expected**
- No navigation. URL stays at `/`.

The donut is a snapshot widget when there's nothing to drill into; only ring clicks navigate.

---

## T-DASH-09 — Top merchant tile drill-down

**Steps**
1. Scroll to "Top merchants · <range.label>" card at the bottom.
2. Note the leftmost merchant tile's name (likely IKEA in current month due to the ₾4280 outlier when range is Month).
3. Click that tile.

**Expected**
- URL changes to `/transactions?merchant=<merchant-name-encoded>&dateFrom=<X>&dateTo=<Y>` where dates reflect the source page's active range.
- Transactions page renders with the merchant search box pre-filled and the **Custom** range showing the source window.
- Filtered list shows only that merchant's transactions in the window.

---

## T-DASH-10 — Income / Net cashflow side cards

**Steps**
1. Look at the right column on the hero row.
2. Switch ranges and re-observe.

**Expected**
- Income card shows `+₾<total>`, a top-credits list (up to 5), and a `±X% vs <prev period>` pill.
- Net cashflow card shows `±₾<delta>` and `<X>% saved|overspent` based on income vs spent.
- Both cards re-scope to whatever range is active.

---

## T-DASH-11 — Loading / empty states

**Steps**
1. Switch to **Today** when there have been no transactions today.
2. Switch to **Custom** with `From` and `To` set to the same future date.

**Expected**
- "You spent ₾0", "0 transactions", subline shows the day count for the range.
- Spending mix card shows "No spending data yet."
- Today & recent shows whatever existing recent activity (this card isn't range-scoped).

---

## T-DASH-12 — Wheel scroll works on Overview

**Why this exists:** PR #20 once set the Layout shell to `height: 100vh` + `<main>` to `overflow: auto`, which silently killed mouse-wheel scrolling on every page that doesn't have an inner scroll container. Pinning this test prevents regressing into the same shape again.

**Steps**
1. Navigate to `http://localhost:5173/` (Overview).
2. Confirm there's content below the fold (Top merchants tiles or further sections should be partially or fully out of viewport at default browser size).
3. Hover the mouse over the empty space between cards (NOT over a chart or donut — Recharts can intercept wheel events on its own surfaces).
4. Scroll the mouse wheel down.

**Expected**
- The page scrolls. The Top merchants row (or whatever is below the fold) comes into view.
- Two-finger trackpad scroll behaves identically.
- This works regardless of cursor position, INCLUDING over the sidebar.
