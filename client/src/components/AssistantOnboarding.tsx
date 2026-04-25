import { useState } from "react";
import { useTheme } from "../ink/theme";
import { Card, CardLabel, Pill, PageHeader } from "../ink/primitives";
import { AI_PROVIDERS, getProvider, type AIConfig, type AIProviderId } from "../lib/aiConfig";

export function AssistantOnboarding({ onSave }: { onSave: (cfg: AIConfig) => void }) {
  const T = useTheme();
  const [provider, setProvider] = useState<AIProviderId>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [revealed, setRevealed] = useState(false);

  const p = getProvider(provider);
  const validKey = apiKey.trim().startsWith(p.keyPrefix) && apiKey.trim().length >= 20;

  const handleSave = () => {
    if (!validKey) return;
    onSave({ provider, apiKey: apiKey.trim(), model: p.defaultModel });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap, height: "100%" }}>
      <PageHeader
        eyebrow="Agentic assistant · local · private"
        title="Meet Xarji AI"
        ranges={null}
        rightSlot={
          <Pill bg={T.accentSoft} color={T.accent}>
            setup needed
          </Pill>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          gap: T.density.gap,
          alignItems: "stretch",
          minHeight: 0,
        }}
      >
        <Card pad="36px 38px" glow style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div>
            <div
              style={{
                fontSize: 11,
                color: T.muted,
                fontFamily: T.mono,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              What it does
            </div>
            <div
              style={{
                fontSize: 38,
                fontFamily: T.serif,
                color: T.text,
                letterSpacing: -1.4,
                lineHeight: 1.05,
                marginTop: 10,
                fontWeight: 400,
              }}
            >
              Talk to your money.
              <br />
              <span style={{ fontStyle: "italic", color: T.accent }}>Xarji listens.</span>
            </div>
            <div
              style={{
                fontSize: 14.5,
                color: T.muted,
                lineHeight: 1.55,
                marginTop: 18,
                maxWidth: 480,
                fontFamily: T.sans,
              }}
            >
              An assistant that can actually{" "}
              <em style={{ color: T.text, fontStyle: "normal", fontWeight: 600 }}>do things</em> in
              your dashboard — not just chat. Create categories, set budgets, build filters, draft
              savings plans. It runs locally; your bank data never leaves this machine.
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { g: "◐", t: "Categorize", d: "Create, merge, or auto-assign categories from natural language." },
              { g: "◆", t: "Budget", d: "Set monthly limits per category with smart thresholds." },
              { g: "≡", t: "Filter & query", d: 'Find any transaction with a sentence — "transit over ₾20 last week".' },
              { g: "✦", t: "Plan & save", d: "Draft savings plans for goals: a Honda, a vacation, an emergency fund." },
            ].map((c) => (
              <div
                key={c.t}
                style={{
                  padding: "16px 18px",
                  background: T.panelAlt,
                  borderRadius: T.rMd,
                  border: `1px solid ${T.line}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 7,
                      background: T.accentSoft,
                      color: T.accent,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontFamily: T.mono,
                    }}
                  >
                    {c.g}
                  </span>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text, fontFamily: T.sans }}>
                    {c.t}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5, fontFamily: T.sans }}>
                  {c.d}
                </div>
              </div>
            ))}
          </div>

        </Card>

        <Card
          pad="32px 32px"
          style={{ display: "flex", flexDirection: "column", gap: 22, justifyContent: "space-between" }}
        >
          <div>
            <CardLabel>Step 1 · Pick your provider</CardLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              {AI_PROVIDERS.map((pp) => {
                const active = pp.id === provider;
                return (
                  <button
                    key={pp.id}
                    onClick={() => setProvider(pp.id)}
                    style={{
                      padding: "18px 16px",
                      borderRadius: T.rMd,
                      cursor: "pointer",
                      textAlign: "left",
                      background: active ? T.panelAlt : "transparent",
                      border: `1px solid ${active ? T.accent + "55" : T.line}`,
                      transition: "all .15s ease",
                      position: "relative",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: pp.color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 13,
                          fontWeight: 800,
                          color: "#fff",
                          fontFamily: T.sans,
                        }}
                      >
                        {pp.name.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text, fontFamily: T.sans }}>
                          {pp.name}
                        </div>
                        <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>by {pp.by}</div>
                      </div>
                      {active && (
                        <span
                          style={{
                            marginLeft: "auto",
                            width: 16,
                            height: 16,
                            borderRadius: 8,
                            background: T.accent,
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 9,
                            fontWeight: 800,
                          }}
                        >
                          ✓
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10.5, color: T.muted, fontFamily: T.mono }}>
                      default · {pp.defaultModel}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <CardLabel>Step 2 · Paste your API key</CardLabel>
            <div style={{ position: "relative", marginTop: 10 }}>
              <input
                type={revealed ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={p.keyPrefix + "••••••••••••••••••••"}
                autoComplete="off"
                style={{
                  width: "100%",
                  padding: "14px 64px 14px 16px",
                  borderRadius: T.rMd,
                  background: T.panelAlt,
                  border: `1px solid ${apiKey && !validKey ? T.accent + "55" : T.line}`,
                  color: T.text,
                  fontSize: 13,
                  fontFamily: T.mono,
                  letterSpacing: 0.4,
                  outline: "none",
                }}
              />
              <button
                onClick={() => setRevealed((r) => !r)}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  padding: "5px 10px",
                  fontSize: 10,
                  fontFamily: T.mono,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  background: "transparent",
                  border: `1px solid ${T.line}`,
                  borderRadius: 6,
                  cursor: "pointer",
                  color: T.muted,
                }}
              >
                {revealed ? "hide" : "show"}
              </button>
            </div>
            <div
              style={{
                fontSize: 11,
                color: T.muted,
                marginTop: 8,
                fontFamily: T.sans,
                lineHeight: 1.5,
              }}
            >
              {p.keyHint} · Generate one at{" "}
              <span style={{ color: T.accent, fontFamily: T.mono }}>{p.docs}</span>
            </div>
          </div>

          <div>
            <button
              onClick={handleSave}
              disabled={!validKey}
              style={{
                width: "100%",
                padding: "14px 18px",
                borderRadius: T.rMd,
                border: "none",
                cursor: validKey ? "pointer" : "not-allowed",
                background: validKey ? T.accent : T.panelAlt,
                color: validKey ? "#fff" : T.dim,
                fontSize: 14,
                fontWeight: 700,
                fontFamily: T.sans,
                letterSpacing: -0.1,
                transition: "all .15s ease",
              }}
            >
              {validKey ? `Connect ${p.name} →` : "Paste a valid key to continue"}
            </button>
            <div
              style={{
                fontSize: 10.5,
                color: T.dim,
                marginTop: 10,
                textAlign: "center",
                fontFamily: T.sans,
                lineHeight: 1.5,
              }}
            >
              You can change provider or revoke the key any time in{" "}
              <span style={{ color: T.muted, fontWeight: 600 }}>Manage → AI Assistant</span>.
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
