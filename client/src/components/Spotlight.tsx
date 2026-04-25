// ⌘K command palette. Opens from anywhere; types a prompt; on submit
// either jumps to a route or creates a new AI thread with autoRun and
// navigates to the assistant.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme, type InkTheme } from "../ink/theme";
import { LiveDot } from "../ink/primitives";
import {
  AI_PROVIDERS,
  loadAIConfig,
  onAIConfigChange,
  type AIConfig,
} from "../lib/aiConfig";
import { createThread, deriveTitle } from "../lib/aiThreads";

interface RouteEntry {
  id: string;
  to: string;
  name: string;
  glyph: string;
  sub: string;
}

const ROUTES: RouteEntry[] = [
  { id: "overview", to: "/", name: "Overview", glyph: "◉", sub: "Spending hero, cashflow, signals" },
  { id: "transactions", to: "/transactions", name: "Transactions", glyph: "≡", sub: "Full list, filters, declined" },
  { id: "categories", to: "/categories", name: "Categories", glyph: "◐", sub: "Breakdown by category" },
  { id: "merchants", to: "/merchants", name: "Merchants", glyph: "◆", sub: "Top merchants, leaderboard" },
  { id: "ai", to: "/assistant", name: "Assistant", glyph: "✧", sub: "Open AI chat" },
  { id: "signals", to: "/signals", name: "Signals", glyph: "✦", sub: "Anomalies and nudges" },
  { id: "manage", to: "/manage", name: "Manage", glyph: "⚙", sub: "Banks, rules, AI keys" },
];

interface AISuggestion {
  icon: string;
  label: string;
  prompt: string;
}

const AI_PROMPTS: AISuggestion[] = [
  { icon: "✦", label: "Plan to save for a Honda — $1,000", prompt: "I want to save $1,000 for a Honda by end of August. Make me a savings plan." },
  { icon: "◐", label: 'Create a "Coffee shops" category', prompt: 'Make a new category called "Coffee shops" and move all my Starbucks, Coffee LAB, and Skola transactions there.' },
  { icon: "◆", label: "Set a ₾800 food budget", prompt: "Set a monthly budget of ₾800 for Food & Drink and warn me at 80%." },
  { icon: "⚠", label: "Find unused subscriptions", prompt: "Look at recurring charges and flag any I might want to cancel." },
  { icon: "◉", label: "Summarize my April spending", prompt: "Give me a one-paragraph summary of my April spending — what stood out vs. March?" },
];

type SpotItem =
  | { kind: "ask"; label: string }
  | ({ kind: "ai-suggestion" } & AISuggestion)
  | ({ kind: "route" } & RouteEntry);

export function SpotlightHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const trigger = () => setOpen(true);
    window.addEventListener("xarji-spotlight-open", trigger);
    return () => window.removeEventListener("xarji-spotlight-open", trigger);
  }, []);

  return <Spotlight open={open} onClose={() => setOpen(false)} />;
}

function Spotlight({ open, onClose }: { open: boolean; onClose: () => void }) {
  const T = useTheme();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [config, setConfig] = useState<AIConfig | null>(loadAIConfig);

  useEffect(() => onAIConfigChange(() => setConfig(loadAIConfig())), []);

  useEffect(() => {
    if (open) {
      setConfig(loadAIConfig());
      setQ("");
      setSel(0);
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [open]);

  const trimmed = q.trim();
  const lower = trimmed.toLowerCase();

  const routeMatches = !trimmed
    ? ROUTES.slice(0, 4)
    : ROUTES.filter((r) => r.name.toLowerCase().includes(lower) || r.id.includes(lower)).slice(0, 4);

  const aiSuggestions = !trimmed
    ? AI_PROMPTS.slice(0, 3)
    : AI_PROMPTS.filter(
        (p) => p.label.toLowerCase().includes(lower) || p.prompt.toLowerCase().includes(lower)
      ).slice(0, 3);

  const askItem: SpotItem | null = trimmed ? { kind: "ask", label: trimmed } : null;

  const items: SpotItem[] = [];
  if (askItem) items.push(askItem);
  aiSuggestions.forEach((p) => items.push({ kind: "ai-suggestion", ...p }));
  routeMatches.forEach((r) => items.push({ kind: "route", ...r }));

  useEffect(() => {
    setSel(0);
  }, [q]);

  const run = (item: SpotItem | undefined) => {
    if (!item) return;
    if (item.kind === "route") {
      navigate(item.to);
      onClose();
      return;
    }
    if (item.kind === "ai-suggestion" || item.kind === "ask") {
      const prompt = item.kind === "ask" ? item.label : item.prompt;
      if (!config) {
        navigate("/assistant");
        onClose();
        return;
      }
      createThread({ firstUserPrompt: prompt, autoRun: true, title: deriveTitle(prompt) });
      navigate("/assistant");
      onClose();
    }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        run(items[sel]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, sel]);

  if (!open) return null;

  const providerName = config && AI_PROVIDERS.find((p) => p.id === config.provider)?.name;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(6,6,8,0.55)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "13vh",
        animation: "spot-fade .14s ease-out",
      }}
    >
      <style>{`
        @keyframes spot-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes spot-rise { from { transform: translateY(-8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(92vw, 680px)",
          background: T.panel,
          borderRadius: 16,
          border: `1px solid ${T.line}`,
          boxShadow: "0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02)",
          overflow: "hidden",
          animation: "spot-rise .18s ease-out",
        }}
      >
        <div
          style={{
            padding: "16px 22px",
            borderBottom: `1px solid ${T.line}`,
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <span style={{ fontSize: 18, color: T.accent, lineHeight: 1 }}>✦</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask Xarji or jump anywhere…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: T.text,
              fontSize: 17,
              fontFamily: T.sans,
              outline: "none",
            }}
          />
          <span
            style={{
              fontSize: 10,
              fontFamily: T.mono,
              color: T.dim,
              padding: "3px 8px",
              background: T.panelAlt,
              borderRadius: 5,
              border: `1px solid ${T.line}`,
            }}
          >
            esc
          </span>
        </div>

        <div style={{ maxHeight: "min(60vh, 460px)", overflowY: "auto", padding: "8px 8px 14px" }}>
          {!config && trimmed && (
            <div
              style={{
                padding: "10px 14px",
                margin: "6px 6px 4px",
                borderRadius: 9,
                background: T.accentSoft,
                border: `1px solid ${T.accent}33`,
                fontSize: 12,
                color: T.text,
                fontFamily: T.sans,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  background: T.accent,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 800,
                }}
              >
                !
              </span>
              <span style={{ flex: 1 }}>
                Connect an AI key first to ask the assistant.{" "}
                <span style={{ color: T.accent, fontWeight: 700 }}>↵ Open setup →</span>
              </span>
            </div>
          )}

          {askItem && (
            <SpotSection title="Ask Xarji" T={T}>
              <SpotItemRow
                item={askItem}
                idx={0}
                sel={sel}
                onHover={setSel}
                onRun={run}
                T={T}
                provider={providerName ?? undefined}
              />
            </SpotSection>
          )}

          {aiSuggestions.length > 0 && (
            <SpotSection title={trimmed ? "Suggested prompts" : "Quick prompts"} T={T}>
              {aiSuggestions.map((s, i) => {
                const idx = (askItem ? 1 : 0) + i;
                return (
                  <SpotItemRow
                    key={s.label}
                    item={{ kind: "ai-suggestion", ...s }}
                    idx={idx}
                    sel={sel}
                    onHover={setSel}
                    onRun={run}
                    T={T}
                  />
                );
              })}
            </SpotSection>
          )}

          {routeMatches.length > 0 && (
            <SpotSection title="Jump to" T={T}>
              {routeMatches.map((r, i) => {
                const idx = (askItem ? 1 : 0) + aiSuggestions.length + i;
                return (
                  <SpotItemRow
                    key={r.id}
                    item={{ kind: "route", ...r }}
                    idx={idx}
                    sel={sel}
                    onHover={setSel}
                    onRun={run}
                    T={T}
                  />
                );
              })}
            </SpotSection>
          )}

          {items.length === 0 && (
            <div
              style={{
                padding: "40px 20px",
                textAlign: "center",
                color: T.muted,
                fontSize: 12,
                fontFamily: T.sans,
              }}
            >
              No matches. Press ↵ to ask Xarji directly.
            </div>
          )}
        </div>

        <div
          style={{
            padding: "10px 18px",
            borderTop: `1px solid ${T.line}`,
            background: T.bg,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 10.5,
            color: T.dim,
            fontFamily: T.mono,
            letterSpacing: 0.3,
          }}
        >
          <span>↑↓ navigate · ↵ run · esc close</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <LiveDot color={config ? T.green : T.dim} />
            {config ? `${providerName} connected` : "no AI key"}
          </span>
        </div>
      </div>
    </div>
  );
}

function SpotSection({ title, children, T }: { title: string; children: React.ReactNode; T: InkTheme }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div
        style={{
          padding: "6px 14px 4px",
          fontSize: 10,
          fontFamily: T.mono,
          color: T.dim,
          textTransform: "uppercase",
          letterSpacing: 0.8,
        }}
      >
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SpotItemRow({
  item,
  idx,
  sel,
  onHover,
  onRun,
  T,
  provider,
}: {
  item: SpotItem;
  idx: number;
  sel: number;
  onHover: (idx: number) => void;
  onRun: (item: SpotItem) => void;
  T: InkTheme;
  provider?: string;
}) {
  const active = idx === sel;
  const isAsk = item.kind === "ask";
  const isAi = item.kind === "ai-suggestion" || isAsk;
  const isRoute = item.kind === "route";

  const icon = isAsk ? "✦" : item.kind === "ai-suggestion" ? item.icon : item.glyph;

  return (
    <div
      onMouseEnter={() => onHover(idx)}
      onClick={() => onRun(item)}
      style={{
        padding: "10px 14px",
        margin: "0 6px",
        borderRadius: 9,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: active ? T.panelAlt : "transparent",
        border: active ? `1px solid ${T.line}` : "1px solid transparent",
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: isAsk ? T.accent : isAi ? T.accentSoft : T.panelAlt,
          color: isAsk ? "#fff" : isAi ? T.accent : T.muted,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: T.mono,
          fontSize: 13,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: isAsk ? 700 : 600,
            color: isAsk ? T.accent : T.text,
            fontFamily: T.sans,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {isAsk ? (
            <>
              Ask Xarji: <span style={{ color: T.text, fontWeight: 600 }}>"{item.label}"</span>
            </>
          ) : item.kind === "ai-suggestion" ? (
            item.label
          ) : (
            item.name
          )}
        </div>
        {!isAsk && (
          <div
            style={{
              fontSize: 11,
              color: T.muted,
              fontFamily: T.sans,
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.kind === "ai-suggestion" ? item.prompt : item.sub}
          </div>
        )}
      </div>
      <span
        style={{
          fontSize: 10,
          fontFamily: T.mono,
          color: active ? T.muted : T.dim,
          padding: "3px 7px",
          background: active ? T.panel : "transparent",
          border: active ? `1px solid ${T.line}` : "1px solid transparent",
          borderRadius: 5,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        {isRoute ? "jump" : isAsk ? (provider || "AI") + " ↵" : "AI ↵"}
      </span>
    </div>
  );
}
