// AITool shape — pairs a JSON-Schema definition (sent to the LLM) with
// a typed executor (called locally with the React-side data context).
// Some tools also map their result into a structured assistant block
// (CategoryCard, BudgetCard, etc.) via the optional `toBlock`.

import type { AIToolDefinition } from "../types";
import type { AIBlock } from "../../aiThreads";
import type { ConvertedPayment } from "../../../hooks/useTransactions";
import type { ConvertedCredit } from "../../../hooks/useCredits";
import type { FailedPayment, Category, BankSender, MerchantCategoryOverride } from "../../instant";
import type { InkCategory } from "../../utils";

/** A snapshot getter that returns the freshest value available at the
 *  moment of read. Backed by a ref the React layer mutates on every
 *  render; tools call this inside their executors to see the live state
 *  even when an earlier tool in the same agentic loop just mutated it
 *  (e.g. create_category followed by apply_category_override in the
 *  same multi-iteration run). Without this, captured-at-runAgent-start
 *  snapshots produce stale-data bugs across chained writes. */
export type Live<T> = () => T;

export interface AIToolContext {
  payments: ConvertedPayment[];
  credits: ConvertedCredit[];
  failedPayments: FailedPayment[];
  /** Raw DB-backed category rows. Use sparingly — most tools should
   *  prefer `getAllCategories()` which merges DEFAULT_CATEGORIES so
   *  tools can target defaults that aren't yet persisted in DB. */
  categories: Category[];
  bankSenders: BankSender[];
  /** Live merchant-override rows. Write tools (apply_category_override)
   *  read this to find an existing row's id so updates reuse it instead
   *  of failing the unique-merchant constraint. Read tools also have
   *  access in case the model wants to reason about which merchants
   *  have been manually re-categorised. */
  overrides: MerchantCategoryOverride[];
  now: Date;
  /** Override-aware category-name lookup for a merchant. Honours the
   *  user's manual `merchantCategoryOverrides` rows; falls back to the
   *  regex categoriser. Tools should always call this instead of the
   *  static `autoCategorize` so an "I moved Spotify to Subscriptions"
   *  override actually shows up in the AI's view of the data. */
  categorizeName: (merchant: string | null | undefined) => string;
  /** Returns the merged category list (DEFAULT_CATEGORIES + DB rows,
   *  deduped by name with DB winning). Use this from tools that need
   *  to expose categories to the model (list_categories) or validate
   *  category ids in input (apply_category_override). Reads live state
   *  via a getter so chained writes in the same agentic loop see fresh
   *  data. */
  getAllCategories: Live<InkCategory[]>;
  /** Returns live merchant-override rows. Same staleness story as
   *  getAllCategories — use this from write tools that need to find
   *  an existing row's id. */
  getOverrides: Live<MerchantCategoryOverride[]>;
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
