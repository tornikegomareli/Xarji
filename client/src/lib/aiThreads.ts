// Conversation threads — localStorage-backed. The chat UI subscribes to
// the `xarji-ai-threads-changed` event so the ⌘K palette can mutate the
// list from anywhere and the active conversation updates in place.

export type AIBlockKind = "text" | "tool" | "plan" | "budget" | "category";

export interface AITextBlock { kind: "text"; text: string }
export interface AIToolBlock { kind: "tool"; name: string; duration: string; body: string }
export interface AIPlanStep { month: string; amount: number; note: string }
export interface AIPlanBlock {
  kind: "plan";
  goal: string;
  target: string;
  deadline: string;
  steps: AIPlanStep[];
}
export interface AIBudgetBlock {
  kind: "budget";
  category: string;
  limit: number;
  spent: number;
  warnAt: number;
}
export interface AICategoryBlock {
  kind: "category";
  name: string;
  color: string;
  glyph: string;
  matched: number;
  total: string;
  merchants: string[];
}

export type AIBlock =
  | AITextBlock
  | AIToolBlock
  | AIPlanBlock
  | AIBudgetBlock
  | AICategoryBlock;

export interface AIMessage {
  role: "user" | "assistant";
  id: string;
  blocks: AIBlock[];
  streaming?: boolean;
}

export interface AIThread {
  id: string;
  title: string;
  messages: AIMessage[];
  createdAt: number;
  updatedAt: number;
  autoRun: boolean;
  pendingPrompt: string | null;
}

const THREADS_KEY = "xarji-ai-threads";
const ACTIVE_KEY = "xarji-ai-active";
const CHANGE_EVENT = "xarji-ai-threads-changed";

function notify() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function loadThreads(): AIThread[] {
  try {
    const raw = window.localStorage.getItem(THREADS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AIThread[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveThreads(list: AIThread[]) {
  window.localStorage.setItem(THREADS_KEY, JSON.stringify(list));
  notify();
}

export function loadActiveThreadId(): string | null {
  return window.localStorage.getItem(ACTIVE_KEY);
}

export function setActiveThreadId(id: string | null) {
  if (id) window.localStorage.setItem(ACTIVE_KEY, id);
  else window.localStorage.removeItem(ACTIVE_KEY);
  notify();
}

interface CreateThreadOpts {
  title?: string;
  firstUserPrompt?: string;
  autoRun?: boolean;
}

export function createThread(opts: CreateThreadOpts = {}): AIThread {
  const id = `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  const messages: AIMessage[] = [];
  if (opts.firstUserPrompt) {
    messages.push({
      role: "user",
      id: `u${now}`,
      blocks: [{ kind: "text", text: opts.firstUserPrompt }],
    });
  }
  const t: AIThread = {
    id,
    title: opts.title || (opts.firstUserPrompt ? deriveTitle(opts.firstUserPrompt) : "New conversation"),
    messages,
    createdAt: now,
    updatedAt: now,
    autoRun: !!opts.autoRun,
    pendingPrompt: opts.autoRun && opts.firstUserPrompt ? opts.firstUserPrompt : null,
  };
  const list = [t, ...loadThreads()];
  saveThreads(list);
  setActiveThreadId(id);
  return t;
}

export function updateThread(id: string, patch: Partial<AIThread>) {
  const list = loadThreads();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() };
  saveThreads(list);
}

export function deleteThread(id: string) {
  const list = loadThreads().filter((t) => t.id !== id);
  saveThreads(list);
  if (loadActiveThreadId() === id) {
    setActiveThreadId(list[0]?.id ?? null);
  }
}

export function onThreadsChange(handler: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function deriveTitle(prompt: string): string {
  const s = prompt.trim().replace(/\s+/g, " ");
  if (s.length <= 42) return s.replace(/[.?!]+$/, "");
  return s.slice(0, 40).replace(/[.?!]+$/, "") + "…";
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
