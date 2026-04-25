// AI Assistant config — provider list + localStorage-backed key/model.
// The key never leaves the browser; whichever provider the user picks
// is what the chat will (eventually) call directly. UI-only for now;
// the scripted runAgent in lib/aiAgent.ts produces the demo responses.

export type AIProviderId = "anthropic" | "openai";

export interface AIProvider {
  id: AIProviderId;
  name: string;
  by: string;
  models: string[];
  defaultModel: string;
  keyHint: string;
  keyPrefix: string;
  docs: string;
  color: string;
}

export interface AIConfig {
  provider: AIProviderId;
  apiKey: string;
  model: string;
}

export const AI_PROVIDERS: AIProvider[] = [
  {
    id: "anthropic",
    name: "Claude",
    by: "Anthropic",
    models: ["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
    defaultModel: "claude-opus-4-7",
    keyHint: "Begins with sk-ant-",
    keyPrefix: "sk-ant-",
    docs: "console.anthropic.com",
    color: "#cc785c",
  },
  {
    id: "openai",
    name: "OpenAI",
    by: "OpenAI",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
    defaultModel: "gpt-5",
    keyHint: "Begins with sk-",
    keyPrefix: "sk-",
    docs: "platform.openai.com",
    color: "#10a37f",
  },
];

export function getProvider(id: AIProviderId): AIProvider {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
}

const STORE_KEY = "xarji-ai";
const CHANGE_EVENT = "xarji-ai-changed";

export function loadAIConfig(): AIConfig | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AIConfig>;
    if (!parsed.provider || !parsed.apiKey || !parsed.model) return null;
    if (parsed.provider !== "anthropic" && parsed.provider !== "openai") return null;
    return { provider: parsed.provider, apiKey: parsed.apiKey, model: parsed.model };
  } catch {
    return null;
  }
}

export function saveAIConfig(cfg: AIConfig) {
  window.localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function clearAIConfig() {
  window.localStorage.removeItem(STORE_KEY);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function onAIConfigChange(handler: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return "•".repeat(Math.max(0, trimmed.length));
  const prefix = trimmed.slice(0, 7);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••${suffix}`;
}
