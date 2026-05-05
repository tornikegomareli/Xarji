# Transactions — manual E2E

Surface: `client/src/pages/Transactions.tsx`.

**Demo mode required.** Confirm via Prereqs in `README.md` before running.

Open `http://localhost:5173/transactions` (or click "Transactions" in the
sidebar). Default range: **Month**.

## Demo-data baseline (current month)

- Total ledger across all months: ~1,200+ transactions (sidebar counter).
- Current month: ~120+ payments + recurring subs + ~5+ failed payments + ~7+ credits.
- Specific merchant strings present this month: `IKEA` (1), `Pulse Fitness` (1), `Wolt` (≥3 incl. 2 declines), `Tech Co LLC` (2 salary credits), various restaurants / petrol / pharmacies.
- Bank dropdown options: `SOLO · SOLO`, `TBC · TBC SMS`, `BOG · Main`.
- Categories dropdown: 11 default categories.

---

## T-TX-01 — Page loads with Month-scope ledger

**Steps**
1. Navigate to `/transactions`.

**Expected**
- Eyebrow: "All transactions · read-only from SMS".
- Title: "Transactions".
- Range buttons visible top-right (**Today / Week / Month / Year / Custom / Cycle**) with **Month** highlighted.
- "<N> results" pill in the top-right reflects the visible filtered count.
- Filter row: search box, kind pills (All / Successful / Declined), bank dropdown, category dropdown.
- Day-grouped list newest-first, each day group has its date label + transaction count + GEL day-total.

---

## T-TX-02 — Range buttons re-scope the ledger

**Steps**
1. From Month, click **Today / Week / Year / Custom / Cycle** in turn.
2. With Custom, set `From`/`To` and verify the list updates.
3. With Cycle, use ← → to navigate one cycle back; verify the day-group dates match the cycle window shown in the nav pill.

**Expected**
- "<N> results" updates to reflect the active range.
- Day groups visible all fall within the active range.
- Custom: date inputs appear inline in the header.
- Cycle: `← [Mmm d – Mmm d, yyyy] →` nav pill and `Day [N]` input appear; transactions outside the cycle window are absent.

---

## T-TX-03 — URL drill-down ingestion (`?category`)

**Steps**
1. Navigate to `/transactions?category=other` (or any known category id from `client/src/lib/utils.ts` `DEFAULT_CATEGORIES`).

**Expected**
- Category dropdown pre-selected to that id.
- "<N> results" reflects the category filter applied within the default Month range.
- Day groups contain only transactions whose categorization matches.

---

## T-TX-04 — URL drill-down ingestion (`?merchant`)

**Steps**
1. Navigate to `/transactions?merchant=IKEA`.

**Expected**
- Search box pre-filled with `IKEA`.
- List shows exactly 1 row in current month: IKEA ₾4,280 on card `1423`, BOG sender.

---

## T-TX-05 — URL drill-down ingestion (`?dateFrom` + `?dateTo`)

**Steps**
1. Navigate to `/transactions?dateFrom=2026-04-01&dateTo=2026-04-30`.
2. Then `/transactions?dateFrom=2025-11-01&dateTo=2025-11-30`.

**Expected**
- Range button shows **Custom** highlighted.
- Custom date inputs in the header show the matching `From` / `To`.
- "<N> results" reflects the date window.
- Day groups all within the requested range.

---

## T-TX-06 — Codex MEDIUM fix: malformed dates fall back to default

**Steps**
1. Navigate to `/transactions?dateFrom=garbage&dateTo=lol`.
2. Then `/transactions?dateFrom=2026-99-99&dateTo=2026-04-30`.
3. Then `/transactions?dateFrom=2026-04-30&dateTo=2026-04-01` (start > end).

**Expected (each)**
- Range button shows **Month** highlighted (NOT Custom).
- Custom date inputs hidden (because we're not in Custom mode).
- Page renders the current month's transactions, not an empty state.
- No console errors.

This pins the Codex MEDIUM fix from PR #23 (`c214df0`).

---

## T-TX-07 — Combined drill-down: category + merchant + range

**Steps**
1. Navigate to `/transactions?category=other&merchant=Loan+repayment&dateFrom=2026-04-01&dateTo=2026-04-30`.

**Expected**
- All three filters apply: category dropdown set, search box filled, range = Custom with the right dates.
- "<N> results" reflects all filters AND'd together.

---

## T-TX-08 — Side panel responds to row click

**Steps**
1. Click any transaction row.

**Expected**
- Right-side detail panel slides in (340px wide on non-narrow viewports).
- Panel shows: kind label, merchant name (or "—"), raw merchant string, amount with currency, "When / Card / Bank / Category" rows, "Points" or "Reason" depending on kind, and the raw SMS text.
- Click the `×` in the panel header → panel closes.

---

## T-TX-09 — Codex MEDIUM fix: side panel respects active filters

**Steps**
1. Click a transaction row to open the side panel.
2. Switch the range to **Today** (or change category dropdown to one that excludes the selected row).
3. Re-observe.

**Expected**
- The selected row is no longer in the list.
- The side panel **clears** automatically — it does not keep showing a row that's been filtered out.

This pins the Codex MEDIUM fix from PR #23 (`fdfffee`).

---

## T-TX-10 — Bank + kind + category filters compose

**Steps**
1. Pick a single bank from the dropdown.
2. Pick the **Declined** kind pill.
3. Pick a category.

**Expected**
- "<N> results" updates after each pick.
- Only rows matching all three filters show.
- Search input also composes (substring match on merchant or rawMessage).

---

## T-TX-11 — Search composes with range

**Steps**
1. With Month active, type a known merchant fragment (e.g. `apple`) into the search input.
2. Switch to **Year** and re-observe.

**Expected**
- Day groups filtered to matches.
- Search persists across range changes.
- "<N> results" updates.

---

## T-TX-12 — Day-group totals only sum successful payments

**Steps**
1. Find a day group with both successful and declined transactions.

**Expected**
- Day total in the right of the day-group header sums only the `kind === "payment"` rows that have a `gelAmount` resolved.
- If a day has only declines, the right side shows `—`, not `−₾0`.
