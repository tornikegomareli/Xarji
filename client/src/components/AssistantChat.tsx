import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme, type InkTheme } from "../ink/theme";
import { LiveDot } from "../ink/primitives";
import { deleteProviderKey, getProvider, type AIConfig } from "../lib/aiConfig";
import {
  createThread,
  deleteThread,
  deriveTitle,
  loadActiveThreadId,
  loadThreads,
  onThreadsChange,
  saveThreads,
  setActiveThreadId,
  timeAgo,
  updateThread,
  type AIBlock,
  type AIBudgetBlock,
  type AICategoryBlock,
  type AIMessage,
  type AIPlanBlock,
  type AIThread,
  type AIToolBlock,
} from "../lib/aiThreads";
import { useAgentRunner } from "../hooks/useAgentRunner";
import type { AssistantEvent } from "../lib/ai/orchestrator";

interface Suggestion {
  icon: string;
  label: string;
  prompt: string;
}

const SUGGESTIONS: Suggestion[] = [
  { icon: "◐", label: 'Create a "Coffee shops" category', prompt: 'Make a new category called "Coffee shops" and move all my Starbucks, Coffee LAB, and Skola transactions there.' },
  { icon: "◆", label: "Set a ₾800 food budget", prompt: "Set a monthly budget of ₾800 for Food & Drink and warn me at 80%." },
  { icon: "✦", label: "Plan to save for a Honda — $1,000", prompt: "I want to save $1,000 for a Honda by end of August. Make me a savings plan." },
  { icon: "≡", label: "Filter all transit > ₾20 last 30 days", prompt: "Show me every transit transaction over ₾20 in the last 30 days, grouped by merchant." },
  { icon: "◉", label: "Summarize my April spending", prompt: "Give me a one-paragraph summary of my April spending — what stood out vs. March?" },
  { icon: "⚠", label: "Find subscriptions I'm not using", prompt: "Look at recurring charges and flag any I might want to cancel." },
];

export function AssistantChat({ config, onClear }: { config: AIConfig; onClear: () => void }) {
  const T = useTheme();
  const provider = getProvider(config.provider);
  const [model, setModel] = useState(config.model || provider.defaultModel);
  const runAgent = useAgentRunner();

  const [threads, setThreads] = useState<AIThread[]>(loadThreads);
  const [activeId, setActiveIdState] = useState<string | null>(loadActiveThreadId);
  const [busy, setBusy] = useState(false);
  const [busyStatus, setBusyStatus] = useState<string>("Thinking…");
  // Which thread the in-flight run originated from. Drives whether the
  // typing indicator shows up at all when the user is viewing a
  // different thread — without this, switching to an idle conversation
  // shows a phantom "Thinking…" pill that belongs to a sibling thread.
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(
    () =>
      onThreadsChange(() => {
        setThreads(loadThreads());
        setActiveIdState(loadActiveThreadId());
      }),
    []
  );

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeId) ?? null,
    [threads, activeId]
  );

  // Auto-run prompt seeded by ⌘K spotlight.
  useEffect(() => {
    if (!activeThread) return;
    if (activeThread.autoRun && activeThread.pendingPrompt && !busy) {
      const prompt = activeThread.pendingPrompt;
      updateThread(activeThread.id, { autoRun: false, pendingPrompt: null });
      setThreads(loadThreads());
      runAgentForActive(prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.id, activeThread?.autoRun]);

  // Autoscroll-pinning rule: stick to the bottom only when the user is
  // already near it. The earlier `[messages?.length, busy]` deps missed
  // streaming token updates (length stayed the same as deltas appended);
  // switching to `[messages, busy]` fixed that but yanked the user back
  // every time they tried to scroll up to read prior context. This
  // version reads the current scroll position before deciding, so the
  // user can scroll up freely during a streaming response and only the
  // already-pinned-to-bottom case follows the latest token.
  const isAtBottomRef = useRef(true);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (isAtBottomRef.current) node.scrollTop = node.scrollHeight;
  }, [activeThread?.messages, busy]);

  const switchTo = (id: string) => {
    setActiveThreadId(id);
    setActiveIdState(id);
    setInput("");
  };

  const newThread = () => {
    const t = createThread({ title: "New conversation" });
    setThreads(loadThreads());
    setActiveIdState(t.id);
    setInput("");
  };

  const removeThread = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteThread(id);
    setThreads(loadThreads());
    setActiveIdState(loadActiveThreadId());
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    let thread = activeThread;
    if (!thread) {
      thread = createThread({ title: deriveTitle(trimmed), firstUserPrompt: trimmed });
      setThreads(loadThreads());
      setActiveIdState(thread.id);
    } else {
      const msg: AIMessage = {
        role: "user",
        id: "u" + Date.now(),
        blocks: [{ kind: "text", text: trimmed }],
      };
      const newMessages = [...thread.messages, msg];
      const newTitle = thread.messages.length === 0 ? deriveTitle(trimmed) : thread.title;
      updateThread(thread.id, { messages: newMessages, title: newTitle });
      setThreads(loadThreads());
    }
    setInput("");
    runAgentForActive(trimmed);
  };

  const runAgentForActive = (text: string) => {
    // Capture the originating thread id at send time so streamed
    // events route to that conversation even if the user switches
    // threads mid-response. Without this, every event handler called
    // `loadActiveThreadId()` and would have leaked the in-flight
    // response into whichever thread happened to be active when the
    // delta arrived. Same fix applies to the finalize step that
    // clears `streaming`.
    const originThreadId = loadActiveThreadId();
    setBusy(true);
    setBusyThreadId(originThreadId);
    setBusyStatus("Thinking…");

    const handle = (event: AssistantEvent) => {
      if (!originThreadId) return;
      const list = loadThreads();
      const idx = list.findIndex((t) => t.id === originThreadId);
      if (idx === -1) return;
      const t = list[idx];
      let assistant = t.messages[t.messages.length - 1];
      if (!assistant || assistant.role !== "assistant" || !assistant.streaming) {
        assistant = {
          role: "assistant",
          id: "a" + Date.now() + Math.random().toString(36).slice(2, 5),
          streaming: true,
          blocks: [],
        };
        t.messages.push(assistant);
      }

      if (event.type === "text-delta") {
        // Append into the trailing text block if there is one and the
        // most recent emit was also text. Closing a text block happens
        // implicitly when a non-text block arrives.
        const lastBlock = assistant.blocks[assistant.blocks.length - 1];
        if (lastBlock && lastBlock.kind === "text") {
          lastBlock.text += event.text;
        } else {
          assistant.blocks.push({ kind: "text", text: event.text });
        }
      } else if (event.type === "block") {
        assistant.blocks.push(event.block);
      } else if (event.type === "status") {
        // Status only updates the loading-indicator pill which only
        // shows when the *current* active thread is busy, so reading
        // setBusyStatus from any in-flight run is fine — but only if
        // the user is still looking at the thread that started it.
        if (loadActiveThreadId() === originThreadId) {
          setBusyStatus(event.text);
        }
        return;
      }

      saveThreads(list);
      setThreads(list.slice());
    };

    const finalConfig = { ...config, model };
    runAgent(finalConfig, text, handle)
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        handle({
          type: "block",
          block: { kind: "text", text: `_Agent error: ${message}_` },
        });
      })
      .finally(() => {
        if (originThreadId) {
          const list = loadThreads();
          const idx = list.findIndex((t) => t.id === originThreadId);
          if (idx !== -1) {
            const last = list[idx].messages[list[idx].messages.length - 1];
            if (last) delete last.streaming;
            saveThreads(list);
            setThreads(list.slice());
          }
        }
        setBusy(false);
        setBusyThreadId(null);
      });
  };

  // Header kebab menu
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "260px 1fr",
        gap: 0,
        flex: 1,
        height: "100%",
        minHeight: 0,
        background: T.panel,
        borderRadius: T.rXl,
        border: `1px solid ${T.line}`,
        overflow: "hidden",
      }}
    >
      <aside
        style={{
          borderRight: `1px solid ${T.line}`,
          display: "flex",
          flexDirection: "column",
          background: T.bg,
          minHeight: 0,
        }}
      >
        <div
          style={{
            padding: "14px 14px",
            borderBottom: `1px solid ${T.line}`,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <button
            onClick={newThread}
            style={{
              padding: "10px 12px",
              borderRadius: 9,
              background: T.accent,
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 700,
              fontFamily: T.sans,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>+</span> New conversation
            </span>
            <span
              style={{
                fontSize: 10,
                fontFamily: T.mono,
                fontWeight: 600,
                opacity: 0.85,
                padding: "2px 6px",
                background: "rgba(255,255,255,0.18)",
                borderRadius: 4,
              }}
            >
              ⌘K
            </span>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 16px" }}>
          {threads.length === 0 ? (
            <div style={{ padding: 18, fontSize: 12, color: T.muted, fontFamily: T.sans, lineHeight: 1.5 }}>
              No conversations yet. Start one with the button above or press{" "}
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 10.5,
                  padding: "2px 6px",
                  background: T.panelAlt,
                  borderRadius: 4,
                  color: T.text,
                }}
              >
                ⌘K
              </span>{" "}
              from anywhere in Xarji.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {threads.map((t) => {
                const active = t.id === activeId;
                const lastUser = [...t.messages].reverse().find((m) => m.role === "user");
                const firstBlock = lastUser?.blocks?.[0];
                const preview =
                  firstBlock && firstBlock.kind === "text" ? firstBlock.text : "No messages yet";
                return (
                  <div
                    key={t.id}
                    onClick={() => switchTo(t.id)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 9,
                      cursor: "pointer",
                      position: "relative",
                      background: active ? T.panel : "transparent",
                      border: active ? `1px solid ${T.line}` : "1px solid transparent",
                      transition: "background .15s ease",
                    }}
                    onMouseEnter={(e) => {
                      if (!active) (e.currentTarget as HTMLDivElement).style.background = T.panel;
                    }}
                    onMouseLeave={(e) => {
                      if (!active) (e.currentTarget as HTMLDivElement).style.background = "transparent";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span
                        style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: T.text,
                          fontFamily: T.sans,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          flex: 1,
                        }}
                      >
                        {t.title}
                      </span>
                      <button
                        onClick={(e) => removeThread(t.id, e)}
                        title="Delete"
                        style={{
                          background: "transparent",
                          border: "none",
                          color: T.dim,
                          cursor: "pointer",
                          padding: 2,
                          fontSize: 12,
                          opacity: 0.7,
                          fontFamily: T.sans,
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: T.muted,
                        fontFamily: T.sans,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        lineHeight: 1.3,
                      }}
                    >
                      {preview}
                    </div>
                    <div
                      style={{
                        fontSize: 9.5,
                        color: T.dim,
                        fontFamily: T.mono,
                        marginTop: 4,
                        letterSpacing: 0.3,
                      }}
                    >
                      {timeAgo(t.updatedAt)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <section style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: `1px solid ${T.line}`,
            gap: 12,
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                background: T.accent,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 12,
                flexShrink: 0,
              }}
            >
              X
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: T.text,
                  fontFamily: T.sans,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {activeThread ? activeThread.title : "Xarji AI"}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: T.dim,
                  fontFamily: T.mono,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <LiveDot color={T.green} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {provider.name} · {model}
                </span>
              </div>
            </div>
          </div>
          <div
            style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, position: "relative" }}
            ref={menuRef}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 8px",
                background: T.panelAlt,
                borderRadius: 999,
                border: `1px solid ${T.line}`,
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: provider.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 7,
                  color: "#fff",
                  fontWeight: 800,
                }}
              >
                {provider.name.charAt(0)}
              </span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: T.text,
                  fontSize: 11,
                  fontFamily: T.mono,
                  fontWeight: 600,
                  cursor: "pointer",
                  outline: "none",
                  maxWidth: 140,
                }}
              >
                {provider.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              title="More"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "transparent",
                border: `1px solid ${T.line}`,
                color: T.muted,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontFamily: T.sans,
                padding: 0,
                lineHeight: 1,
              }}
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: 36,
                  right: 0,
                  minWidth: 180,
                  background: T.panel,
                  borderRadius: 10,
                  border: `1px solid ${T.line}`,
                  boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
                  zIndex: 50,
                  padding: 4,
                }}
              >
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    if (!window.confirm(`Disconnect ${provider.name}? The key will be removed from this Mac.`)) return;
                    try {
                      await deleteProviderKey(config.provider);
                    } catch (err) {
                      window.alert(err instanceof Error ? err.message : String(err));
                      return;
                    }
                    onClear();
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    borderRadius: 6,
                    color: T.text,
                    fontSize: 12.5,
                    fontFamily: T.sans,
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = T.panelAlt;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  }}
                >
                  Disconnect AI…
                </button>
              </div>
            )}
          </div>
        </div>

        {!activeThread || activeThread.messages.length === 0 ? (
          <ChatLanding T={T} onPick={(prompt) => send(prompt)} />
        ) : (
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              // Within 60px of the bottom counts as "pinned" so a tiny
              // overshoot from a streaming token doesn't unstick it.
              const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
              isAtBottomRef.current = distanceFromBottom < 60;
            }}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "28px 36px",
              display: "flex",
              flexDirection: "column",
              gap: 22,
            }}
          >
            {activeThread.messages.map((m) => (
              <Message key={m.id} message={m} T={T} />
            ))}
            {busy && busyThreadId === activeId && <TypingDots T={T} status={busyStatus} />}
          </div>
        )}

        <div style={{ borderTop: `1px solid ${T.line}`, padding: "16px 24px", background: T.bg }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "5px 5px 5px 16px",
              background: T.panel,
              borderRadius: T.rLg,
              border: `1px solid ${T.line}`,
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" && !e.shiftKey) {
                  const userMessages = (activeThread?.messages ?? []).filter((m) => m.role === "user");
                  if (userMessages.length === 0) return;
                  const lastBlock = userMessages[userMessages.length - 1].blocks[0];
                  if (lastBlock?.kind === "text") {
                    e.preventDefault();
                    setInput(lastBlock.text);
                  }
                }
              }}
              placeholder={busy ? "Thinking…" : "Ask anything — set a budget, plan savings, find unused subscriptions…"}
              disabled={busy}
              style={{
                flex: 1,
                padding: "10px 0",
                background: "transparent",
                border: "none",
                color: T.text,
                fontSize: 13.5,
                fontFamily: T.sans,
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              style={{
                padding: "9px 16px",
                borderRadius: T.rMd,
                border: "none",
                cursor: input.trim() && !busy ? "pointer" : "not-allowed",
                background: input.trim() && !busy ? T.accent : T.panelAlt,
                color: input.trim() && !busy ? "#fff" : T.dim,
                fontSize: 12.5,
                fontWeight: 700,
                fontFamily: T.sans,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              Send <span style={{ fontFamily: T.mono, fontSize: 11 }}>↵</span>
            </button>
          </form>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 9,
              fontSize: 10.5,
              color: T.dim,
              fontFamily: T.mono,
              letterSpacing: 0.3,
            }}
          >
            <span>
              ↵ send · ⇧↵ newline · <span style={{ color: T.muted }}>⌘K</span> spotlight
            </span>
            <span>connected to {provider.name} · keys never leave this Mac</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function ChatLanding({ T, onPick }: { T: InkTheme; onPick: (prompt: string) => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 36px",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: T.accent,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
          fontWeight: 800,
          fontFamily: T.sans,
          marginBottom: 18,
        }}
      >
        X
      </div>
      <div
        style={{
          fontSize: 30,
          fontFamily: T.serif,
          color: T.text,
          letterSpacing: -1,
          marginBottom: 8,
          textAlign: "center",
          lineHeight: 1.1,
        }}
      >
        What can Xarji do for you?
      </div>
      <div
        style={{
          fontSize: 13.5,
          color: T.muted,
          fontFamily: T.sans,
          marginBottom: 30,
          textAlign: "center",
          maxWidth: 460,
          lineHeight: 1.55,
        }}
      >
        Pick a starter or type your own. Tip: press{" "}
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 11.5,
            padding: "2px 7px",
            background: T.panelAlt,
            borderRadius: 4,
            color: T.text,
          }}
        >
          ⌘K
        </span>{" "}
        from any screen to ask without leaving it.
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
          width: "100%",
          maxWidth: 720,
        }}
      >
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            onClick={() => onPick(s.prompt)}
            style={{
              textAlign: "left",
              padding: "14px 16px",
              borderRadius: T.rMd,
              background: T.panel,
              border: `1px solid ${T.line}`,
              color: T.text,
              cursor: "pointer",
              fontFamily: T.sans,
              transition: "all .15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = T.accent + "55";
              (e.currentTarget as HTMLButtonElement).style.background = T.panelAlt;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = T.line;
              (e.currentTarget as HTMLButtonElement).style.background = T.panel;
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 5 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: T.accentSoft,
                  color: T.accent,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontFamily: T.mono,
                }}
              >
                {s.icon}
              </span>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{s.label}</div>
            </div>
            <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.45 }}>{s.prompt}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Message({ message, T }: { message: AIMessage; T: InkTheme }) {
  if (message.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div
          style={{
            maxWidth: "72%",
            padding: "12px 18px",
            background: T.accent,
            color: "#fff",
            borderRadius: "18px 18px 4px 18px",
            fontSize: 14,
            lineHeight: 1.55,
            fontFamily: T.sans,
            fontWeight: 500,
          }}
        >
          {message.blocks.map((b, i) => (
            <div key={i}>{b.kind === "text" ? b.text : ""}</div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: T.accent,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 800,
          fontFamily: T.sans,
          flexShrink: 0,
        }}
      >
        X
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {message.blocks.map((b, i) => (
          <Block key={i} block={b} T={T} />
        ))}
      </div>
    </div>
  );
}

function renderInline(line: string, T: InkTheme) {
  return line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
    if (p.startsWith("**"))
      return (
        <strong key={i} style={{ fontWeight: 700, color: T.text }}>
          {p.slice(2, -2)}
        </strong>
      );
    if (p.startsWith("`"))
      return (
        <code
          key={i}
          style={{
            fontFamily: T.mono,
            fontSize: 12.5,
            padding: "2px 5px",
            background: T.panelAlt,
            borderRadius: 4,
            color: T.muted,
          }}
        >
          {p.slice(1, -1)}
        </code>
      );
    return <span key={i}>{p}</span>;
  });
}

function Block({ block, T }: { block: AIBlock; T: InkTheme }) {
  if (block.kind === "text") {
    const lines = block.text.split("\n");
    return (
      <div
        style={{ fontSize: 14, lineHeight: 1.6, color: T.text, fontFamily: T.sans, maxWidth: 720 }}
      >
        {lines.map((line, i) =>
          line.trim() === "" ? (
            <div key={i} style={{ height: "0.6em" }} />
          ) : (
            <div key={i}>{renderInline(line, T)}</div>
          )
        )}
      </div>
    );
  }
  if (block.kind === "tool") return <ToolCard tool={block} T={T} />;
  if (block.kind === "plan") return <SavingsPlanCard plan={block} T={T} />;
  if (block.kind === "budget") return <BudgetCard budget={block} T={T} />;
  if (block.kind === "category") return <CategoryCard cat={block} T={T} />;
  return null;
}

function ToolCard({ tool, T }: { tool: AIToolBlock; T: InkTheme }) {
  const hasBody = !!tool.body && tool.body.trim().length > 0;
  return (
    <div
      style={{
        padding: hasBody ? "14px 16px" : "10px 14px",
        background: T.panelAlt,
        borderRadius: T.rMd,
        border: `1px solid ${T.line}`,
        maxWidth: 720,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: hasBody ? 8 : 0,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: "rgba(75,217,162,0.15)",
            color: T.green,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 800,
            fontFamily: T.mono,
          }}
        >
          ✓
        </span>
        <span
          style={{
            fontSize: 11,
            color: T.dim,
            fontFamily: T.mono,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          tool call
        </span>
        <span style={{ fontSize: 12.5, color: T.text, fontFamily: T.mono, fontWeight: 700 }}>
          {tool.name}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: T.dim, fontFamily: T.mono }}>
          {tool.duration}
        </span>
      </div>
      {hasBody && (
        <div
          style={{
            fontSize: 12,
            color: T.muted,
            fontFamily: T.mono,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}
        >
          {tool.body}
        </div>
      )}
    </div>
  );
}

function CategoryCard({ cat, T }: { cat: AICategoryBlock; T: InkTheme }) {
  return (
    <div
      style={{
        padding: "18px 20px",
        background: T.panel,
        borderRadius: T.rMd,
        border: `1px solid ${T.accent}33`,
        maxWidth: 540,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: cat.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            color: "#fff",
          }}
        >
          {cat.glyph}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: T.sans }}>
            {cat.name}
          </div>
          <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>
            {cat.matched} transactions matched · ₾{cat.total} total
          </div>
        </div>
        <span
          style={{
            marginLeft: "auto",
            padding: "4px 10px",
            borderRadius: 999,
            background: "rgba(75,217,162,0.14)",
            color: T.green,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 0.5,
            textTransform: "uppercase",
            fontFamily: T.sans,
          }}
        >
          created
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {cat.merchants.map((m) => (
          <span
            key={m}
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              background: T.panelAlt,
              fontSize: 11,
              color: T.muted,
              fontFamily: T.mono,
            }}
          >
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

function BudgetCard({ budget, T }: { budget: AIBudgetBlock; T: InkTheme }) {
  const pct = Math.min(100, (budget.spent / budget.limit) * 100);
  return (
    <div
      style={{
        padding: "18px 20px",
        background: T.panel,
        borderRadius: T.rMd,
        border: `1px solid ${T.accent}33`,
        maxWidth: 540,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: T.sans }}>
            Budget · {budget.category}
          </div>
          <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, marginTop: 2 }}>
            monthly cap · warns at {budget.warnAt}%
          </div>
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: T.text,
            fontFamily: T.sans,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: -0.6,
          }}
        >
          ₾{budget.limit}
        </div>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: T.panelAlt,
          overflow: "hidden",
          marginBottom: 6,
        }}
      >
        <div
          style={{
            height: "100%",
            width: pct + "%",
            background: pct > budget.warnAt ? T.accent : T.green,
            borderRadius: 4,
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.muted, fontFamily: T.mono }}>
        <span>
          ₾{budget.spent} spent · {Math.round(pct)}%
        </span>
        <span>₾{budget.limit - budget.spent} remaining</span>
      </div>
    </div>
  );
}

function SavingsPlanCard({ plan, T }: { plan: AIPlanBlock; T: InkTheme }) {
  return (
    <div
      style={{
        padding: "20px 22px",
        background: T.panel,
        borderRadius: T.rMd,
        border: `1px solid ${T.accent}33`,
        maxWidth: 600,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: T.accentSoft,
            color: T.accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
          }}
        >
          ✦
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              color: T.dim,
              fontFamily: T.mono,
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            savings plan · drafted
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFamily: T.sans, marginTop: 2 }}>
            {plan.goal}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: T.accent,
              fontFamily: T.sans,
              letterSpacing: -0.6,
            }}
          >
            ${plan.target}
          </div>
          <div style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>by {plan.deadline}</div>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          marginBottom: 14,
        }}
      >
        {plan.steps.map((s, i) => (
          <div key={i} style={{ padding: 12, background: T.panelAlt, borderRadius: 10 }}>
            <div
              style={{
                fontSize: 10,
                color: T.dim,
                fontFamily: T.mono,
                letterSpacing: 0.4,
                textTransform: "uppercase",
              }}
            >
              {s.month}
            </div>
            <div
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: T.text,
                fontFamily: T.sans,
                marginTop: 4,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              ₾{s.amount}
            </div>
            <div style={{ fontSize: 11, color: T.muted, fontFamily: T.sans, marginTop: 4, lineHeight: 1.4 }}>
              {s.note}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          style={{
            padding: "9px 14px",
            borderRadius: 8,
            border: "none",
            background: T.accent,
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: T.sans,
            cursor: "pointer",
          }}
        >
          Accept plan
        </button>
        <button
          style={{
            padding: "9px 14px",
            borderRadius: 8,
            border: `1px solid ${T.line}`,
            background: "transparent",
            color: T.text,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: T.sans,
            cursor: "pointer",
          }}
        >
          Tweak amounts
        </button>
      </div>
    </div>
  );
}

// Generic verbs the indicator cycles through when nothing more specific
// is happening (i.e. the model is silently thinking with no tool call
// and no streaming text yet). Tool-specific text from the orchestrator
// pre-empts this list.
const IDLE_THINKING_VERBS = [
  "Thinking…",
  "Working through it…",
  "Connecting dots…",
  "Pondering…",
  "Crunching numbers…",
  "Looking it up…",
  "Reading between the lines…",
  "Following the thread…",
];

function TypingDots({ T, status }: { T: InkTheme; status: string }) {
  // When the orchestrator hasn't pushed a context-aware status in a
  // while, rotate through a few generic verbs so the indicator feels
  // alive (Claude-Code-style). The cycle resets every time the
  // orchestrator emits a fresh status — so a tool call instantly takes
  // priority over the rotation.
  const [displayed, setDisplayed] = useState(status);
  const idleStartRef = useRef<number>(Date.now());

  useEffect(() => {
    setDisplayed(status);
    idleStartRef.current = Date.now();
    const id = setInterval(() => {
      // Only rotate while the status is one of the generic "thinking"
      // strings — anything tool-specific stays put.
      const elapsed = Date.now() - idleStartRef.current;
      const idx = Math.floor(elapsed / 1800) % IDLE_THINKING_VERBS.length;
      const next = IDLE_THINKING_VERBS[idx];
      // Don't overwrite a tool-specific status that arrived after the
      // initial mount.
      setDisplayed((prev) =>
        IDLE_THINKING_VERBS.includes(prev) || prev === status ? next : prev
      );
    }, 1800);
    return () => clearInterval(id);
  }, [status]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: T.accent,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 800,
          fontFamily: T.sans,
          flexShrink: 0,
        }}
      >
        X
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          background: T.panel,
          borderRadius: T.rMd,
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: T.muted,
                opacity: 0.6,
                animation: `xj-bounce 1s ${i * 0.15}s infinite ease-in-out`,
              }}
            />
          ))}
        </div>
        <span
          style={{
            fontSize: 12.5,
            color: T.muted,
            fontFamily: T.sans,
            fontWeight: 500,
            letterSpacing: 0.1,
          }}
        >
          {displayed}
        </span>
        <style>{`@keyframes xj-bounce { 0%,100% { transform: translateY(0); opacity: 0.4 } 50% { transform: translateY(-3px); opacity: 1 } }`}</style>
      </div>
    </div>
  );
}
