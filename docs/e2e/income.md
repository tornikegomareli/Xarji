# Income — manual E2E

Surface: `client/src/pages/Income.tsx`.

**Demo mode required.** Confirm via Prereqs in `README.md` before running.

Open `http://localhost:5173/income`. Default range: **Month**.

## Demo-data baseline (current month)

- Hero `+₾<total>` ≥ ₾15,000 (Tech Co LLC ₾7,500 × 2 = ₾15,000 alone).
- ≥6 incoming transactions: 2 salaries + freelance (1) + Wolt refund + Carrefour refund + Mom + (Stripe Payout USD, filtered out by GEL filter).
- Counterparties present: `Tech Co LLC`, one of `Design Studio|Acme GmbH|Northwind|Studio Twelve|Civic Lab` (rotates by month), `Wolt refund`, `Carrefour refund`, `Mom`, `Stripe Payout` (USD, may not appear in GEL view).

---

## T-INC-01 — Page loads with Month-scope hero

**Steps**
1. Navigate to `/income`.

**Expected**
- Eyebrow: "Money in · <range.label>".
- Title: "Income".
- Range buttons visible top-right (**Today / Week / Month / Year / Custom / Cycle**) with **Month** highlighted.
- Hero card shows `+₾<total>` for incoming GEL credits in the active range, plus a `<count> incoming transactions · <month>` subline.
- 9-month income trend AreaChart below the hero (when `T.chartsVisible` and at least one month had income).

---

## T-INC-02 — Range buttons re-scope hero + ledger

**Steps**
1. Click **Today / Week / Year / Custom / Cycle** in turn.

**Expected**
- Hero `+₾<total>` and incoming-transaction count update.
- Eyebrow updates with `range.label`.
- Ledger below filters to credits within the active range.
- The 9-month trend chart at the top is intentionally always 9 months — it does NOT re-scope with the range buttons. (If we change that behaviour, update this test.)

---

## T-INC-03 — Codex HIGH fix: ledger respects active range

**Steps**
1. Click **Year** in the header.
2. Scroll to the credits ledger.

**Expected**
- The ledger contains credits across the entire year, not just the current month.
- Earlier behaviour (pre-PR #23) showed credits ledger frozen on the current month even when the hero re-scoped. That's the regression this test guards against.

This pins the Codex HIGH fix from PR #16 (`0e8803a`).

---

## T-INC-04 — Bank filter + search compose with range

**Steps**
1. Pick a single bank from the dropdown.
2. Type a known counterparty fragment in the search box.

**Expected**
- Ledger filters by bank AND search AND active range simultaneously.
- "<N> incoming transactions" subline reflects the filtered count.

---

## T-INC-05 — Side panel on row click

**Steps**
1. Click any credit row.

**Expected**
- Right-side detail panel slides in.
- Shows: counterparty, amount + currency, when, bank, raw SMS.
- `×` closes the panel.

---

## T-INC-06 — Income trend hover tooltip

**Steps**
1. Hover the income trend AreaChart.

**Expected**
- Tooltip shows bucket label + `₾<value>` + (if prior bucket exists) `vs <prev label> ₾<prev value> ±X%`.
- Same theme rules as Dashboard trend tooltip.
