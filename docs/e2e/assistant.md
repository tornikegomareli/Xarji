# Assistant — manual E2E

Surface: `client/src/components/AssistantChat.tsx`, `client/src/pages/Assistant.tsx`,
`client/src/hooks/useAgentRunner.ts`, `client/src/lib/ai/orchestrator.ts`.

**Demo mode required.** Confirm via Prereqs in `README.md` before running.

**Real LLM provider required.** Unlike most other test files, the assistant tests
hit a real LLM (OpenAI or Anthropic) via `/api/ai/stream` because the assistant's
behaviour is the model's behaviour — there's nothing meaningful to assert against
a stubbed stream. The user's installed Xarji.app must be running on `:8721` with
at least one AI provider key configured (visible at the bottom of `/assistant`:
"connected to OpenAI · keys never leave this Mac" or similar).

These tests cost API tokens. Run them deliberately, not on every pre-merge sweep
unless touching assistant code.

Open `http://localhost:5173/assistant`.

---

## T-AI-01 — Empty-state landing renders

**Steps**
1. Navigate to `/assistant` with no existing conversations (or click "New conversation" to start fresh).

**Expected**
- Six suggestion cards render: "Create a 'Coffee shops' category", "Set a ₾800 food budget", "Plan to save for a Honda — $1,000", "Filter all transit > ₾20 last 30 days", "Summarize my April spending", "Find subscriptions I'm not using".
- "What can Xarji do for you?" header visible.
- Bottom-right strip shows the connected provider (e.g. "connected to OpenAI · keys never leave this Mac").
- Input row at the bottom with placeholder "Ask anything — set a budget, plan savings, find unused subscriptions…".

---

## T-AI-02 — Single-turn prompt streams a response

**Steps**
1. Click any suggestion card (or type a short prompt and press Enter).
2. Wait for the stream to complete.

**Expected**
- The user message appears as a coral-bg pill at the right.
- "Thinking…" / "Looking it up…" / "Crunching numbers…" status pill renders while the model is mid-stream.
- Tool-call pills render as the model invokes tools (e.g. `TOOL CALL compare_months 6ms`).
- Final response streams in token-by-token below the tool calls.
- Inline formatting works: `₾<amount>` and merchant names render in monospaced code-blocks; **bold** and `\`backticks\`` parse correctly.
- Stream completes; the input row reverts from "Thinking…" placeholder to the normal one.
- No errors in the browser console.

---

## T-AI-03 — Multi-turn memory: assistant sees prior turn context

**Why this exists:** The orchestrator built a one-shot `messages: [{ role: "user", content: userPrompt }]` array on every call up until the fix in PR #27. The thread UI displayed prior turns visually but never sent them to the provider, so each follow-up arrived at the model with zero conversation context. This test pins multi-turn memory.

**Steps**
1. Start a fresh conversation.
2. Send turn 1: a prompt with a memorable, unusual token. e.g. `"My favourite merchant this month is Wizz Air. Remember that for the rest of this conversation."`
3. Wait for the response.
4. Send turn 2: a follow-up that requires turn 1's context. e.g. `"What did I say my favourite merchant was?"`
5. Wait for the response.

**Expected**
- Turn 2's response correctly identifies "Wizz Air" (or whatever merchant you used in turn 1).
- The model does NOT respond with "I don't have context from earlier in this conversation" or similar amnesia language.
- This works whether or not the model called tools in turn 1 — past tool calls aren't preserved across turns (text-only collapse), but the user's text is.

---

## T-AI-04 — Streaming long response: scroll-up doesn't yank user back

**Why this exists:** PR #20's autoscroll dep change initially yanked the viewport back to the bottom on every streamed token, making prior context unreadable mid-response. The PR shipped with a `isAtBottomRef` fix that only autoscrolls when the user is already pinned to the bottom (within 60px).

**Steps**
1. Send a prompt that produces a long response. e.g. `"List every category I spent in this month and give me 2 bullet points each on what stood out."`
2. As soon as the response starts streaming, scroll up to the top of the chat.
3. Hold position while streaming continues.

**Expected**
- The viewport stays at the top. New tokens appear at the bottom but do NOT scroll the chat back down.
- After the stream completes, the user can scroll back to the bottom themselves.
- If the user is already at the bottom (within 60px) when a stream starts, autoscroll DOES follow as new tokens arrive.

---

## T-AI-05 — Long agentic loops survive the idle timeout

**Why this exists:** PR #20 originally introduced `idleTimeout: 60` on the Bun server, which would have killed `/api/ai/stream` mid-response if the model paused for >60s during a multi-tool agentic loop. PR #20's followup commit set `idleTimeout: 0` (disabled) for the entire server. This test pins that the long-stall path stays alive.

**Steps**
1. Send a prompt that requires multiple tool calls. e.g. `"Compare every category between this month and last month and give me a recommendation per category."`
2. Watch the streaming response. Multiple `TOOL CALL` pills should appear (likely `compare_months`, `list_categories`, possibly more).
3. The model may pause for many seconds between events.

**Expected**
- The stream completes successfully even if the total elapsed time exceeds 60 seconds.
- No "stream aborted" error message appears.
- All tool results arrive. The final text response renders.

---

## Write tools (issue #29)

These tests cover the assistant's write-tool surface. v1 ships two CREATE-type
tools (`create_category`, `apply_category_override`), both auto-apply. EDIT
and DELETE happen via UI affordances (the × button on `/categories` and the
"Clear override" button in `CategoryPicker` on `/transactions`).

### T-AI-07 — `create_category` auto-applies and renders end-to-end

**Steps**
1. Start a fresh assistant conversation.
2. Send: `"Make a new category called Coffee shops."`
3. After the response, navigate to `/categories`.
4. After that, navigate to `/transactions` and open the category dropdown filter.

**Expected**
- Chat shows a `TOOL CALL create_category` pill (sub-second).
- Assistant's text response confirms the category was created (exact wording drifts).
- `/categories` left list shows `Coffee shops` with a small × delete button next to its row (it's deletable because `isDefault: false`).
- `/transactions` category dropdown includes `Coffee shops` as a filter option.
- The category persists across page reloads.

### T-AI-08 — `create_category` rejects duplicate names

**Steps**
1. After T-AI-07 (or with `Coffee shops` already created), send: `"Make a coffee shops category."`

**Expected**
- The tool errors. The model surfaces the existing category instead of creating a parallel one (e.g. "You already have a Coffee shops category — want me to move transactions into it instead?").
- Duplicate detection is case-insensitive: `"Coffee Shops"`, `"coffee shops"`, `"COFFEE SHOPS"` all collide with `"Coffee shops"`.
- Default categories also collide: `"Make a Groceries category"` should fail with the same response.

### T-AI-09 — `apply_category_override` moves a merchant

**Pre:** at least one `Coffee shops` category exists (run T-AI-07 first if not).

**Steps**
1. Send: `"Move all my Carrefour transactions to Coffee shops."` (substitute any merchant present in your demo data — Carrefour, Spotify, IKEA, etc.)
2. Wait for the response.
3. Navigate to `/transactions`.
4. Filter by category = Coffee shops.

**Expected**
- The model calls `apply_category_override` once with `merchant=Carrefour, categoryId=<coffee-shops-id>`.
- The tool result includes `categoryName: "Coffee shops"` and `replacedExistingOverride: false`.
- `/transactions` filtered by Coffee shops shows all the Carrefour rows that previously categorised as Groceries.
- Spending mix on `/` (Dashboard) re-allocates: Coffee shops now has the Carrefour total, Groceries has correspondingly less.

### T-AI-10 — `apply_category_override` is reversible via the UI

**Pre:** T-AI-09 just ran (Carrefour is overridden to Coffee shops).

**Steps**
1. Open `/transactions`. Find any Carrefour row.
2. Click the merchant's category badge.
3. Click "Clear override · use the auto category".
4. Refresh.

**Expected**
- The CategoryPicker dropdown now lists `Coffee shops` alongside the default categories (the picker uses `allCategories` per the foundation commit).
- After clicking "Clear override", every Carrefour row reverts to "Groceries" (the auto-detected category).
- Spending mix on `/` matches what it was before T-AI-09.

### T-AI-11 — Delete a category from `/categories`

**Pre:** at least one user-created category exists (run T-AI-07 if not). Bonus: an override targeting that category exists (run T-AI-09 first).

**Steps**
1. Open `/categories`.
2. Click the × button on the user-created category row.
3. Confirm the dialog.

**Expected**
- The category disappears from the left list.
- Any merchant overrides pointing at the deleted category are also cleaned up — the affected merchants revert to their auto-detected category in `/transactions`.
- The dialog message reflects what's about to happen: empty category vs. N transactions affected.
- Default categories (those with `isDefault: true` in DB or hardcoded in `DEFAULT_CATEGORIES`) do NOT show a × button.

### T-AI-12 — Multi-write turn (multiple `apply_category_override` in one response)

**Pre:** `Coffee shops` exists.

**Steps**
1. Send: `"Move my Starbucks, Coffee LAB, and Skola transactions to Coffee shops."` (substitute three merchants present in your data).

**Expected**
- The assistant emits 3 `TOOL CALL apply_category_override` pills in sequence.
- All three merchants now show "Coffee shops" in `/transactions`.
- If a merchant doesn't exist in the data, the tool still succeeds (it creates an override row even if no transactions currently match) — the model should tell the user how many transactions are now mapped (0 if the merchant has no transactions yet).

---

## T-AI-06 — Side-panel scrolling works (Layout-overflow regression guard)

**Why this exists:** PR #20 set Layout's `<main>` to `overflow: auto` to give the chat a bounded viewport, then PR #27 reverted that to keep document scroll working everywhere else, and instead wrapped only the assistant page in `calc(100vh - 56px)`. This test confirms both the chat scroller AND the input row layout still work after the rewrap.

**Steps**
1. Send a long prompt that produces a response longer than the viewport.
2. After the stream completes, attempt to scroll the chat content area with the mouse wheel.

**Expected**
- The chat content area scrolls within its bounded container.
- The input row at the bottom stays anchored above the viewport bottom (does NOT scroll off-screen with the content).
- The sidebar and the conversations list (left column) are also independently scrollable.
- The browser's outer scrollbar does NOT appear — the assistant page still fits within the viewport.
