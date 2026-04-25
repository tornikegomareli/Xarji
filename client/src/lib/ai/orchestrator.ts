// Provider-agnostic agent loop. Streams events from the provider,
// dispatches tool calls against the local tool registry, feeds the
// results back, and repeats until the model returns end_turn (or hits
// the safety cap). Emits a single event stream the chat UI consumes —
// text deltas, tool diagnostics, and structured cards from tools that
// expose a `toBlock` mapping.

import type {
  AICoreMessage,
  AIContentPart,
  AIProviderClient,
  AIStreamEvent,
} from "./types";
import type { AIBlock } from "../aiThreads";
import type { AITool, AIToolContext } from "./tools/types";

/** Cap on provider→tool→provider loops to prevent runaway agentic
 *  behaviour. Most user prompts complete in 1-3 iterations. */
const MAX_ITERATIONS = 8;

export type AssistantEvent =
  | { type: "text-delta"; text: string }
  | { type: "block"; block: AIBlock }
  /** Updates the chat's loading indicator label. The orchestrator
   *  emits these around provider calls and tool executions; the chat
   *  shows the latest one until the next text-delta arrives. */
  | { type: "status"; text: string };

export interface RunAgentOpts {
  provider: AIProviderClient;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  tools: AITool[];
  toolContext: AIToolContext;
  emit: (event: AssistantEvent) => void;
  signal?: AbortSignal;
}

export async function runAgent(opts: RunAgentOpts): Promise<void> {
  const messages: AICoreMessage[] = [
    { role: "user", content: opts.userPrompt },
  ];
  const toolDefs = opts.tools.map((t) => t.definition);
  const toolByName = new Map(opts.tools.map((t) => [t.definition.name, t]));

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (opts.signal?.aborted) return;

    opts.emit({ type: "status", text: iter === 0 ? "Thinking…" : "Working through it…" });

    let assistantText = "";
    const pendingTools: Array<{ id: string; name: string; input: unknown }> = [];
    let stopReason: AIStreamEvent["kind"] = "stop";
    let streamError: unknown = null;

    for await (const ev of opts.provider.stream({
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      messages,
      tools: toolDefs,
      signal: opts.signal,
    })) {
      if (opts.signal?.aborted) return;

      if (ev.kind === "text-delta") {
        assistantText += ev.text;
        opts.emit({ type: "text-delta", text: ev.text });
      } else if (ev.kind === "tool-call") {
        pendingTools.push({ id: ev.id, name: ev.name, input: ev.input });
      } else if (ev.kind === "stop") {
        stopReason = "stop";
        if (ev.reason === "refusal") {
          opts.emit({
            type: "block",
            block: {
              kind: "text",
              text: "_The model declined to answer this request._",
            },
          });
          return;
        }
        if (ev.reason === "max_tokens") {
          opts.emit({
            type: "block",
            block: {
              kind: "text",
              text: "_Response truncated — hit the token cap._",
            },
          });
        }
      } else if (ev.kind === "error") {
        streamError = ev.error;
      }
    }

    if (streamError) {
      const message = streamError instanceof Error ? streamError.message : String(streamError);
      opts.emit({
        type: "block",
        block: {
          kind: "text",
          text: `_Provider error: ${message}_`,
        },
      });
      return;
    }

    // No tool calls — assistant turn is done.
    if (pendingTools.length === 0) {
      void stopReason;
      return;
    }

    // Build the assistant content (text + tool_use blocks) so the next
    // provider call sees the full context.
    const assistantContent: AIContentPart[] = [];
    if (assistantText) assistantContent.push({ type: "text", text: assistantText });
    for (const t of pendingTools) {
      assistantContent.push({
        type: "tool_use",
        id: t.id,
        name: t.name,
        input: t.input,
      });
    }
    messages.push({ role: "assistant", content: assistantContent });

    // Execute each tool, emit a compact ToolCard pill (no JSON body —
    // raw input/output is noise to the user; the friendly status text
    // already tells them what we're doing), plus any structured block
    // the tool produces via toBlock(). Collect results to feed back to
    // the model.
    const toolResults: AIContentPart[] = [];
    for (const tc of pendingTools) {
      if (opts.signal?.aborted) return;
      const tool = toolByName.get(tc.name);
      opts.emit({
        type: "status",
        text: tool?.statusText ?? `Running ${tc.name}…`,
      });
      const startedAt = performance.now();
      let output: unknown;
      let isError = false;
      try {
        if (!tool) throw new Error(`Unknown tool: ${tc.name}`);
        output = await tool.executor(tc.input as Record<string, unknown>, opts.toolContext);
      } catch (err) {
        output = { error: err instanceof Error ? err.message : String(err) };
        isError = true;
      }
      const durationMs = Math.round(performance.now() - startedAt);

      opts.emit({
        type: "block",
        block: {
          kind: "tool",
          name: tc.name,
          duration: durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`,
          body: "",
        },
      });

      if (tool?.toBlock) {
        const block = tool.toBlock(output);
        if (block) opts.emit({ type: "block", block });
      }

      const outputJson = (() => {
        try {
          return JSON.stringify(output);
        } catch {
          return String(output);
        }
      })();
      toolResults.push({
        type: "tool_result",
        toolUseId: tc.id,
        output: outputJson,
        isError,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  opts.emit({
    type: "block",
    block: {
      kind: "text",
      text: "_Reached the iteration cap — stopping here. Try a more specific prompt._",
    },
  });
}
