// AITool shape — pairs a JSON-Schema definition (sent to the LLM) with
// a typed executor (called locally with the React-side data context).
// Some tools also map their result into a structured assistant block
// (CategoryCard, BudgetCard, etc.) via the optional `toBlock`.

import type { AIToolDefinition } from "../types";
import type { AIBlock } from "../../aiThreads";
import type { ConvertedPayment } from "../../../hooks/useTransactions";
import type { ConvertedCredit } from "../../../hooks/useCredits";
import type { FailedPayment, Category, BankSender } from "../../instant";

export interface AIToolContext {
  payments: ConvertedPayment[];
  credits: ConvertedCredit[];
  failedPayments: FailedPayment[];
  categories: Category[];
  bankSenders: BankSender[];
  now: Date;
  /** Override-aware category-name lookup for a merchant. Honours the
   *  user's manual `merchantCategoryOverrides` rows; falls back to the
   *  regex categoriser. Tools should always call this instead of the
   *  static `autoCategorize` so an "I moved Spotify to Subscriptions"
   *  override actually shows up in the AI's view of the data. */
  categorizeName: (merchant: string | null | undefined) => string;
}

export interface AITool {
  definition: AIToolDefinition;
  /** Executes the tool against the live data context. The returned
   *  value gets JSON-stringified and sent back to the model as the
   *  tool result. Throw to surface as an error result. */
  executor: (input: Record<string, unknown>, ctx: AIToolContext) => Promise<unknown> | unknown;
  /** Short user-facing verb shown in the chat's loading indicator while
   *  this tool runs (e.g. "Reading your month summary…"). The orchestrator
   *  falls back to a generic "Working…" when omitted. */
  statusText?: string;
  /** Optional UI bridge — when present, the orchestrator calls this with
   *  the executor's return value and emits the resulting block into the
   *  assistant message. Lets specific tool outputs render as structured
   *  cards (savings plan, budget, etc.) instead of raw JSON. */
  toBlock?: (output: unknown) => AIBlock | null;
}
