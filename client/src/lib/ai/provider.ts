// Loads the provider implementation lazily so the inactive SDK never
// reaches the user's bundle. Each provider is its own dynamic-import
// chunk; switching providers in Settings doesn't require a reload to
// download the new SDK — just the next `getProviderClient()` call.

import type { AIProviderClient } from "./types";
import type { AIProviderId } from "../aiConfig";

const cache = new Map<string, AIProviderClient>();

function cacheKey(id: AIProviderId, apiKey: string): string {
  return `${id}::${apiKey}`;
}

export async function getProviderClient(id: AIProviderId, apiKey: string): Promise<AIProviderClient> {
  const key = cacheKey(id, apiKey);
  const hit = cache.get(key);
  if (hit) return hit;

  let client: AIProviderClient;
  if (id === "anthropic") {
    const mod = await import("./providers/anthropic");
    client = mod.makeAnthropicProvider(apiKey);
  } else if (id === "openai") {
    const mod = await import("./providers/openai");
    client = mod.makeOpenAIProvider(apiKey);
  } else {
    throw new Error(`Unknown AI provider: ${id}`);
  }
  cache.set(key, client);
  return client;
}
