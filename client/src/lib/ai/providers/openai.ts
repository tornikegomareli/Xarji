// OpenAI provider — Chat Completions streaming. Tool calls arrive as
// indexed deltas; we accumulate by index and emit a single tool-call
// event per call once the stream completes for that index.

import OpenAI from "openai";
import type {
  AICoreMessage,
  AIProviderClient,
  AIStreamEvent,
  AIStreamOpts,
  AIStopReason,
} from "../types";

export function makeOpenAIProvider(apiKey: string): AIProviderClient {
  const client = new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true,
  });

  return {
    id: "openai",
    async *stream(opts: AIStreamOpts): AsyncIterable<AIStreamEvent> {
      const messages = toOpenAIMessages(opts.systemPrompt, opts.messages);
      const tools = opts.tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema as Record<string, unknown>,
        },
      }));

      const toolBuffers = new Map<
        number,
        { id: string; name: string; argsText: string }
      >();
      let stopReason: AIStopReason = "other";

      let stream;
      try {
        stream = await client.chat.completions.create({
          model: opts.model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          stream: true,
        });
      } catch (err) {
        yield { kind: "error", error: err };
        return;
      }

      try {
        for await (const chunk of stream) {
          if (opts.signal?.aborted) {
            stream.controller.abort();
            return;
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta;

          if (delta?.content) {
            yield { kind: "text-delta", text: delta.content };
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              let buf = toolBuffers.get(idx);
              if (!buf) {
                buf = {
                  id: tc.id ?? `call_${idx}`,
                  name: tc.function?.name ?? "",
                  argsText: "",
                };
                toolBuffers.set(idx, buf);
              }
              if (tc.id && !buf.id.startsWith("call_")) buf.id = tc.id;
              if (tc.function?.name) buf.name = tc.function.name;
              if (tc.function?.arguments) buf.argsText += tc.function.arguments;
            }
          }

          if (choice.finish_reason) {
            stopReason = mapStopReason(choice.finish_reason);
          }
        }
      } catch (err) {
        yield { kind: "error", error: err };
        return;
      }

      // Emit collected tool calls before the stop event so the
      // orchestrator can dispatch them in order.
      for (const buf of [...toolBuffers.values()]) {
        let input: unknown;
        try {
          input = buf.argsText ? JSON.parse(buf.argsText) : {};
        } catch {
          input = { __parseError: buf.argsText };
        }
        yield { kind: "tool-call", id: buf.id, name: buf.name, input };
      }

      yield { kind: "stop", reason: stopReason };
    },
  };
}

function toOpenAIMessages(
  systemPrompt: string,
  messages: AICoreMessage[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });

  for (const m of messages) {
    if (m.role === "user") {
      if (typeof m.content === "string") {
        out.push({ role: "user", content: m.content });
        continue;
      }
      // Tool results need to be split out into separate `tool` role messages
      // (Chat Completions doesn't allow them inline in a user turn).
      const userText: string[] = [];
      const toolMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
      for (const p of m.content) {
        if (p.type === "text") userText.push(p.text);
        else if (p.type === "tool_result") {
          toolMessages.push({
            role: "tool",
            tool_call_id: p.toolUseId,
            content: p.output,
          });
        }
      }
      if (userText.length > 0) out.push({ role: "user", content: userText.join("\n") });
      out.push(...toolMessages);
    } else {
      const text = m.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");
      const toolCalls = m.content
        .filter((p): p is { type: "tool_use"; id: string; name: string; input: unknown } => p.type === "tool_use")
        .map((p) => ({
          id: p.id,
          type: "function" as const,
          function: {
            name: p.name,
            arguments: JSON.stringify(p.input),
          },
        }));
      const msg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: text || null,
      };
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      out.push(msg);
    }
  }
  return out;
}

function mapStopReason(reason: string): AIStopReason {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "other";
  }
}
