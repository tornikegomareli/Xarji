# Flex Budgeting — manual E2E

Surface: `client/src/pages/Budgets.tsx`, `client/src/hooks/useBudgets.ts`,
`client/src/lib/budgets.ts`, plus the AI tools in `client/src/lib/ai/tools/budgets.ts`.

**Demo mode required.** Confirm via Prereqs in `README.md` before running.
Open `http://localhost:5173/budgets`.

## Demo-data baseline (current month)

The seed in `client/src/dev/demoData.ts` ships pre-classified bucket
assignments + two `budgetPlans` rows (current + previous month, both
auto-everything). Specifically:

- **Fixed**: Subscriptions (target ₾200, rollover ON), Utilities (₾220,
  rollover OFF), Loans (₾800, rollover OFF).
- **Non-Monthly**: Travel (target ₾2400 / 12 months → ₾200/mo accrual).
- **Flex**: Groceries, Dining, Delivery, Transport, Shopping, Health,
  Entertainment, Cash, Other (no per-category targets).
- **Plans seeded**: previous month + current month, savingsTarget = ₾500
  on both, expectedIncome and flexPool both auto-derived.
- **Income sized for headroom**: Tech Co LLC salary is ₾7500 × 2/mo so
  flex remaining stays comfortably positive at any day-of-month (~₾4-7k
  typical). No artificial spending dampener — early-month dashboards
  honestly show low totals and grow as the month progresses.

These numbers are deterministic for a given calendar day; reseeded as the
day rolls over.

---

## T-BUD-01 — Page loads with three buckets populated

**Steps**
1. Navigate to `http://localhost:5173/budgets`.
2. Wait for the page to fully render (skeleton disappears).

**Expected**
- Sidebar entry **Flex Budgeting** appears between Categories and Merchants
  with glyph `◇`. No NEW pill.
- While data loads: the "Flex remaining · GEL" card shows four pulsing
  skeleton blocks (number, subtitle, bar, spent line). No wrong-data flash.
- After load: eyebrow reads `Plan for <current month name> <year>`
  (e.g. `Plan for May 2026`). Range buttons **Month** and **Cycle** are
  visible in the header; **Month** is active.
- Title: `Flex Budgeting`.
- Right-side pill shows `0 unclassified` (every demo category has a bucket).
- Headline card "Flex remaining · GEL" renders a non-zero number (≥₾2k on a
  typical demo day).
- Subtitle reads `₾<X>/day for the next <N> days · ₾<pool> pool (auto)`.
- Progress bar under the headline is coral, fills proportionally to actuals,
  followed by `₾<spent> spent · <pct>% of pool`.
- Three small cards in a row: **Fixed**, **Non-Monthly**, **Flex**.
- Income & allocations card with three editable fields: Expected income,
  Savings target, Flex pool.
- Three bucket sections render below: **Fixed** (3 rows), **Non-Monthly**
  (1 row: Travel), **Flex** (≥7 rows).

---

## T-BUD-02 — Headline math is internally consistent

**Steps**
1. From the Budgets page, note: expectedIncome (top of Income card),
   sum of fixed targets (Fixed bucket card "of ₾X"), Non-Monthly accruals
   ("of ₾X" on the Non-Monthly bucket card), savings target, and the flex
   pool.
2. Compute: `flexPool_expected = expectedIncome − fixedTargets −
   nonMonthlyAccruals − savingsTarget`.

**Expected**
- The displayed Flex pool number equals `flexPool_expected` (within ±₾1
  rounding).
- The headline "Flex remaining" equals `flexPool − flexActual` (the spent
  number on the Flex bucket-strip card).
- Negative results clamp to 0 — if the math goes below zero, the headline
  reads ₾0 not a negative number.

---

## T-BUD-03 — Bucket-strip progress bars match per-row sums

**Steps**
1. Sum the actuals shown on every Fixed-row's right-side stack.
2. Sum the actuals shown on every Non-Monthly-row's right-side stack.
3. Sum the actuals shown on every Flex-row's right-side stack.
4. Compare each total against the corresponding card in the bucket strip.

**Expected**
- Fixed strip "₾A / ₾B" — A matches the per-row sum, B matches the sum of
  category target amounts.
- Non-Monthly strip A matches per-row sum, B matches sum of monthly
  accruals (target ÷ frequencyMonths).
- Flex strip A matches per-row sum, B matches the flex pool from T-BUD-02.

---

## T-BUD-04 — Expected income manual override + reset

**Steps**
1. Click the Expected income field — value becomes editable. Note the auto
   value before editing.
2. Type `9000` and press Enter.
3. The field re-renders showing the new value.
4. Below the field, click `reset` next to "manual".

**Expected**
- After step 3: Expected income shows `₾9,000` and the helper line reads
  `manual` instead of `auto · 3-month avg of your credits`.
- A `reset` link appears next to "manual".
- The headline Flex remaining recomputes against the new income.
- After step 4: Field snaps back to the original auto value, helper line
  flips back to `auto · …`, the `reset` link disappears.
- The headline updates again to reflect the auto value.

---

## T-BUD-05 — Savings target slider commits + reflects in flex pool

**Steps**
1. Click the Savings target field. Note the current Flex pool value.
2. Type `1500` and press Enter.

**Expected**
- Savings target field shows `₾1,500`.
- Flex pool drops by exactly `(new - old)` = ₾1000 if it was ₾500 before.
- Headline Flex remaining drops by the same amount.

---

## T-BUD-06 — Flex pool manual override + reset

**Steps**
1. Click the Flex pool field. Note the auto value.
2. Type `2500` + Enter.
3. Click `reset` next to "manual".

**Expected**
- Step 2: Flex pool reads `₾2,500` with helper `manual` and a `reset` link.
- Headline + Flex bucket-strip card update accordingly.
- Step 3: Snaps back to the auto-derived value (the income-minus-everything
  formula). Helper flips to `auto · income − fixed − non-monthly − savings`.

---

## T-BUD-07 — Edit Fixed-category target inline

**Steps**
1. In the Fixed section, click `set target` (or the existing target value)
   on the Subscriptions row.
2. The input is pre-filled with `200`. Type `350` and press Enter.

**Expected**
- Target updates to `₾350`. Per-row "of ₾X" updates. Per-row progress bar
  re-scales.
- Fixed bucket-strip card "of ₾X" total recomputes (was ₾1220, now ₾1370 if
  Subs went 200→350).
- Flex pool drops by the difference (since fixed targets feed the formula).

---

## T-BUD-08 — Edit Non-Monthly target + frequency without losing focus

**Codex P2 regression guard from PR #42.**

**Steps**
1. In the Non-Monthly section, click `set target` on the Travel row.
2. Two inputs appear inline (target + months). Target is pre-filled with
   `2400`, months with `12`.
3. Click into the **months** input directly (don't tab — actually click).
4. Without that triggering a close, change months to `6`.
5. Press Enter.

**Expected**
- Step 3: The months input keeps focus and remains editable. The editor
  does NOT close on click-out from target → months.
- Step 5: Both target and months commit. The per-row monthly accrual now
  shows ₾2400 ÷ 6 = ₾400/mo.
- Non-Monthly bucket-strip card "of ₾X" reflects the new accrual.

---

## T-BUD-09 — Fixed rollover toggle + carry indicator

**Steps**
1. In the Fixed section, find the Subscriptions row. The `↻ ON` button is
   highlighted (rollover enabled by demo seed).
2. With at least one prior plan-month saved (the demo seed includes the
   previous month), the row's right-side stack should show
   `±₾<X> carried` beneath the spent number — green for positive carry,
   coral for negative.
3. Click `↻ ON` to toggle off. Click again to re-enable.
4. Repeat with Utilities (rollover OFF in the demo seed).

**Expected**
- Step 1–2: Subscriptions shows the carry line because rollover is ON
  AND there's a prior plan month for the anchor.
- Step 3: When toggled off, the carry line disappears for Subscriptions.
  Toggling back on, it returns.
- Step 4: Utilities does NOT show a carry line by default (rollover OFF).
  Toggling ON makes the carry line appear (it'll likely be positive since
  Utilities was under target last month).

---

## T-BUD-10 — Non-Monthly sinking fund header

**Steps**
1. Look at the Non-Monthly section header.
2. Verify the inline `+₾<X> sinking fund` text on the right.

**Expected**
- The total reads `+₾<X>` in green when the sum of unspent accruals is
  positive (typical case — Travel hasn't been spent yet).
- If Travel was overspent, the value would render in coral with `−₾<X>`.
- The number equals the sum of `rolloverIn` across Non-Monthly rows.

---

## T-BUD-11 — Reassign category bucket via dropdown

**Steps**
1. In the Flex section, find the **Dining** row.
2. Click the bucket dropdown on its right edge. Select **Fixed**.
3. Verify Dining now appears in the Fixed section with no target set.
4. Click `set target` on the new Fixed Dining row, set ₾400, Enter.
5. Move it back to Flex via the dropdown.

**Expected**
- Step 3: Dining disappears from Flex section, appears in Fixed.
- Step 4: Target commits, per-row "of ₾400" appears, Fixed bucket-strip
  total grows by ₾400.
- Step 5: Dining returns to Flex section, but its target is preserved (not
  reset) — re-classifying back to Fixed would still show ₾400.

---

## T-BUD-12 — Excluded transactions don't count toward budgets

**Steps**
1. Open `/transactions` and exclude one Groceries payment via the detail
   panel toggle.
2. Note the displayed amount on the excluded transaction.
3. Return to `/budgets`.

**Expected**
- The Groceries row's actual drops by exactly the excluded transaction's
  GEL amount.
- Flex bucket-strip card "₾A / ₾B" updates A.
- Headline Flex remaining grows by the excluded amount.
- Re-include the same transaction → numbers revert.

---

## T-BUD-13 — Setup wizard renders for fully unclassified accounts

**Setup**
- In TweaksPanel, switch to "Empty demo" or use a real account with no
  category bucket assignments.

**Steps**
1. Navigate to `/budgets`.

**Expected**
- The wizard "Let's set this up" card renders instead of the bucket
  sections.
- Each category row shows three bucket buttons: Fixed / Flex / Non-Monthly.
- A `~₾N/mo` median spend hint renders next to each row that has prior
  spending.
- Click any bucket button on a row → category is classified, row leaves the
  wizard list. Once all rows are classified, the wizard disappears and the
  regular page renders.

---

## T-BUD-14 — Sidebar reflects unclassified count

**Steps**
1. From a fully classified state, move one category to "—" (unclassified)
   via the bucket dropdown in its row.
2. Reload `/budgets`.

**Expected**
- The right-side pill in the page header now reads `1 unclassified`.
- An **Unclassified** section appears at the bottom listing the category.
- Reassigning that category to a bucket clears the pill back to `0
  unclassified` and removes the Unclassified section.

---

## T-BUD-15 — Assistant: get_budget_summary matches page

**Steps**
1. From `/budgets`, note the current values: flex remaining, fixed actual,
   non-monthly accruals, savings target.
2. Open `/assistant` (with API key configured).
3. Type: `How much flex do I have left this month?` and submit.
4. Type: `What's my savings target?` and submit.

**Expected**
- The assistant calls `get_budget_summary`, returns numbers that match
  step 1 within ±₾1 rounding.
- The savings target answer matches step 1 exactly.
- The status text during the tool call reads `Reading your budget…`.

---

## T-BUD-16 — Assistant: chained writes don't duplicate plans

**Codex P2 regression guard from PR #42.**

**Setup**
- Wipe the budgetPlans table (TweaksPanel "Delete all data") OR use a real
  account with no plans saved yet.

**Steps**
1. Open `/assistant`.
2. Type: `Set my expected income to 8000 and cap flex at 2500 for this
   month.` and submit.
3. After the assistant responds, check `/budgets` — verify both values are
   set.
4. Use TweaksPanel's data inspector (or check via the InstantDB dashboard
   for real accounts) to count `budgetPlans` rows for the current month.

**Expected**
- The assistant calls both `set_expected_income` and `set_flex_pool` in the
  same turn.
- After the calls complete, exactly **one** `budgetPlans` row exists for
  the current month, with both `expectedIncome=8000`,
  `expectedIncomeAuto=false`, `flexPool=2500`, `flexPoolAuto=false`.
- Pre-fix bug: two duplicate rows OR a unique-constraint error during the
  second tool call.

---

## T-BUD-17 — Assistant: bucket reassignment tool

**Steps**
1. From `/assistant`, type: `Move dining to fixed and give it a 400 budget`
   and submit.

**Expected**
- The assistant calls `set_category_bucket` (dining → fixed) followed by
  `set_category_target` (dining, 400) in the same turn.
- Reload `/budgets` — Dining now appears in the Fixed section with target
  ₾400.
- The Codex P2 fix #1 (memo for chained creates) only covers
  budgetPlans; chained category writes use upsert-by-id which is
  naturally idempotent.

---

## T-BUD-18 — Assistant: AI numbers match page after raw-SMS-driven category

**Codex P2 regression guard from PR #42.**

**Steps**
1. Pick a category that depends on rawMessage matching for some
   transactions (e.g. Subscriptions — the demo seed uses
   `apple.com/bill itunes` which only matches via rawMessage).
2. From `/budgets`, note the Subscriptions actual.
3. From `/assistant`, type: `What did I spend on Subscriptions this month?`
   and submit.

**Expected**
- The assistant's number matches the `/budgets` row exactly.
- Pre-fix bug: AI used `categorizeName(merchant)` only and ignored
  rawMessage / per-transaction overrides, so the numbers diverged for
  raw-SMS-matched payments.

---

## T-BUD-19 — Sinking fund accrues across months

**Steps**
1. Note the current Non-Monthly section's `+₾<X> sinking fund` value.
2. Note Travel's per-row carry indicator.
3. Spend ₾0 on Travel this month (don't add a Travel transaction).

**Expected**
- The sinking fund header value equals: `(months_since_anchor − 1) ×
  monthly_accrual − total_actual_since_anchor`. With the demo's two-month
  plan (previous + current), if Travel had ₾0 actual last month and ₾0
  this month, the carried value is `1 × 200 − 0 = ₾200` (one prior month
  of accrual).
- This is the demo's expected state on a fresh seed — Travel typically
  has zero actuals because the random walk doesn't always land on travel
  merchants in the current month.

---

## T-BUD-20 — Page survives the month rollover

**Setup (manual)**
- Set system clock forward to the 1st of next month, OR seed a future
  date by manipulating `now` in the demo (advanced).

**Steps**
1. Reload `/budgets`.

**Expected**
- planMonth flips to the new month.
- Current-month actuals reset to 0 (no transactions yet in the new month).
- The previous month's plan becomes the rollover anchor — Subscriptions
  (Fixed, rollover ON) and Travel (Non-Monthly) carry their prior surplus
  forward.
- Fixed-rollover-OFF rows (Utilities, Loans) start fresh with no carry.
- The Income card's auto-derived expected income may shift because the
  3-month rolling window moved forward by one month.

---

## T-BUD-21 — Cycle range scopes all numbers to the custom window

**Steps**
1. Navigate to `/budgets`. Note the current Flex remaining value and the
   eyebrow (`Plan for <month> <year>`).
2. Click the **Cycle** range button in the header.
3. The cycle-day input defaults to `25`. Leave it at 25.
4. Note the new eyebrow label (e.g. `Cycle: Apr 25 – May 24, 2026`).
5. Note the updated Flex remaining, `daysLeft`, and bucket actuals.
6. Click **←** (previous cycle) — eyebrow shifts back one cycle.
7. Click **→** (next cycle) — eyebrow advances to the next cycle.
8. Change the cycle-day input to `10`. Eyebrow updates to the 10th–9th window.
9. Click **Month** — page returns to calendar-month view.

**Expected**
- Step 2: `Month` deactivates, `Cycle` activates. Cycle controls appear
  (prev/next arrows + day input).
- Step 4: Eyebrow reads `Cycle: <start date> – <end date, year>`.
- Step 5: Actuals and Flex remaining reflect only transactions within the
  cycle window, not the full calendar month. On a day after the 25th the
  cycle window is shorter than the calendar month, so actuals will be lower.
  `daysLeft` shows days until the cycle end (e.g. `19 days` if today is the
  5th of a month with a 25th-to-24th cycle).
- Step 6–7: Eyebrow label shifts backward/forward by one cycle period.
  Actuals update to match the selected historical or future window.
- Step 8: Eyebrow updates to reflect the 10th-to-9th cycle.
- Step 9: Eyebrow returns to `Plan for <month> <year>`. Range controls
  collapse back to just Month/Cycle pills. Actuals revert to the full
  calendar month.
