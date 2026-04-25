// Provider-agnostic types for the AI layer. The orchestrator (lib/ai/
// orchestrator.ts) speaks this protocol; each provider implementation
// (lib/ai/providers/*) translates it to and from its native SDK shape.
// Adding a new provider = one new file under providers/, register it in
// provider.ts. No changes to the orchestrator or the chat UI.

import type { AIProviderId } from "../aiConfig";

/** A single piece of conversational content. Mirrors the Anthropic
 *  content-block model — OpenAI maps tool calls + tool results onto its
 *  separate `tool_calls`/`tool` role messages internally. */
export type AIContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; output: string; isError?: boolean };

export type AICoreMessage =
  | { role: "user"; content: string | AIContentPart[] }
  | { role: "assistant"; content: AIContentPart[] };

export interface AIToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. Both Anthropic and OpenAI accept
   *  this shape directly (Anthropic as `input_schema`, OpenAI inside
   *  `function.parameters`). */
  inputSchema: Record<string, unknown>;
}

/** Stream events the orchestrator consumes. Provider implementations
 *  yield these over an async iterator; tool calls are emitted only when
 *  the provider has accumulated the full input JSON for them. */
export type AIStreamEvent =
  | { kind: "text-delta"; text: string }
  | { kind: "tool-call"; id: string; name: string; input: unknown }
  | { kind: "stop"; reason: AIStopReason }
  | { kind: "error"; error: unknown };

export type AIStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "refusal"
  | "pause_turn"
  | "other";

export interface AIStreamOpts {
  model: string;
  systemPrompt: string;
  messages: AICoreMessage[];
  tools: AIToolDefinition[];
  signal?: AbortSignal;
}

export interface AIProviderClient {
  id: AIProviderId;
  stream(opts: AIStreamOpts): AsyncIterable<AIStreamEvent>;
}
