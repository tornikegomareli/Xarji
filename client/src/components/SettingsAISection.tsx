// "AI Assistant" card for the Manage screen. When no key is connected
// it shows a primary "Set up assistant →" CTA that navigates to the
// Assistant onboarding. When connected it shows the provider, model
// picker, masked key, and a Replace / Disconnect path.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../ink/theme";
import { Card, CardTitle } from "../ink/primitives";
import {
  AI_PROVIDERS,
  clearAIConfig,
  getProvider,
  loadAIConfig,
  maskApiKey,
  onAIConfigChange,
  saveAIConfig,
  type AIConfig,
  type AIProviderId,
} from "../lib/aiConfig";

type Mode = "view" | "replace";

export function SettingsAISection() {
  const T = useTheme();
  const navigate = useNavigate();
  const [config, setConfig] = useState<AIConfig | null>(loadAIConfig);
  const [mode, setMode] = useState<Mode>("view");
  const [editProvider, setEditProvider] = useState<AIProviderId>("anthropic");
  const [editKey, setEditKey] = useState("");
  const [revealed, setRevealed] = useState(false);

  useEffect(() => onAIConfigChange(() => setConfig(loadAIConfig())), []);

  const provider = useMemo(() => (config ? getProvider(config.provider) : null), [config]);
  const editProviderObj = getProvider(editProvider);
  const validKey =
    editKey.trim().startsWith(editProviderObj.keyPrefix) && editKey.trim().length >= 20;

  const startReplace = () => {
    setMode("replace");
    setEditProvider(config?.provider ?? "anthropic");
    setEditKey("");
    setRevealed(false);
  };

  const cancelReplace = () => {
    setMode("view");
    setEditKey("");
  };

  const saveReplace = () => {
    if (!validKey) return;
    saveAIConfig({
      provider: editProvider,
      apiKey: editKey.trim(),
      model: editProviderObj.defaultModel,
    });
    setMode("view");
  };

  const updateModel = (model: string) => {
    if (!config) return;
    saveAIConfig({ ...config, model });
  };

  const disconnect = () => {
    if (window.confirm("Disconnect AI? Your key will be removed from this device.")) {
      clearAIConfig();
      setMode("view");
    }
  };

  return (
    <Card pad="24px 26px">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: T.accent,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              fontWeight: 800,
              fontFamily: T.sans,
            }}
          >
            ✧
          </div>
          <div>
            <CardTitle>AI Assistant</CardTitle>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2, fontFamily: T.sans }}>
              Provider, model, and API key. The key never leaves this device.
            </div>
          </div>
        </div>
        {config && (
          <span
            style={{
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
            connected
          </span>
        )}
      </div>

      {!config && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 18px",
            background: T.accentSoft,
            border: `1px solid ${T.accent}33`,
            borderRadius: T.rMd,
          }}
        >
          <div
            style={{
              fontSize: 12.5,
              color: T.text,
              fontFamily: T.sans,
              flex: 1,
              lineHeight: 1.5,
            }}
          >
            Connect Claude or OpenAI to unlock the agentic chat. Plans, budgets, filters, and
            categories — created from natural-language prompts.
          </div>
          <button
            onClick={() => navigate("/assistant")}
            style={{
              padding: "10px 16px",
              borderRadius: T.rMd,
              border: "none",
              background: T.accent,
              color: "#fff",
              fontSize: 12.5,
              fontWeight: 700,
              fontFamily: T.sans,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Set up assistant →
          </button>
        </div>
      )}

      {config && provider && mode === "view" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <ProviderTile provider={provider} active />
            <div
              style={{
                padding: "16px 18px",
                background: T.panelAlt,
                borderRadius: T.rMd,
                border: `1px solid ${T.line}`,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: T.dim,
                  fontFamily: T.mono,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                }}
              >
                Model
              </div>
              <select
                value={config.model}
                onChange={(e) => updateModel(e.target.value)}
                style={{
                  background: T.panel,
                  border: `1px solid ${T.line}`,
                  color: T.text,
                  fontSize: 13,
                  fontFamily: T.mono,
                  padding: "9px 12px",
                  borderRadius: 8,
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                {provider.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: T.muted, fontFamily: T.sans, lineHeight: 1.4 }}>
                Used for new conversations. Active threads keep their model.
              </div>
            </div>
          </div>

          <div
            style={{
              padding: "16px 18px",
              background: T.panelAlt,
              borderRadius: T.rMd,
              border: `1px solid ${T.line}`,
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10,
                  color: T.dim,
                  fontFamily: T.mono,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                }}
              >
                API key
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: T.text,
                  fontFamily: T.mono,
                  fontWeight: 600,
                  marginTop: 4,
                  letterSpacing: 0.4,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {maskApiKey(config.apiKey)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={startReplace}
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
                Replace
              </button>
              <button
                onClick={disconnect}
                style={{
                  padding: "9px 14px",
                  borderRadius: 8,
                  border: `1px solid ${T.accent}55`,
                  background: T.accentSoft,
                  color: T.accent,
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: T.sans,
                  cursor: "pointer",
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {config && mode === "replace" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              fontSize: 11,
              color: T.dim,
              fontFamily: T.mono,
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            Replace credentials
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {AI_PROVIDERS.map((pp) => (
              <ProviderTile
                key={pp.id}
                provider={pp}
                active={pp.id === editProvider}
                onSelect={() => setEditProvider(pp.id)}
              />
            ))}
          </div>
          <div style={{ position: "relative" }}>
            <input
              type={revealed ? "text" : "password"}
              value={editKey}
              onChange={(e) => setEditKey(e.target.value)}
              placeholder={editProviderObj.keyPrefix + "••••••••••••••••••••"}
              autoComplete="off"
              style={{
                width: "100%",
                padding: "12px 64px 12px 16px",
                borderRadius: T.rMd,
                background: T.panelAlt,
                border: `1px solid ${editKey && !validKey ? T.accent + "55" : T.line}`,
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
          <div style={{ fontSize: 11, color: T.muted, fontFamily: T.sans, lineHeight: 1.5 }}>
            {editProviderObj.keyHint} · Generate one at{" "}
            <span style={{ color: T.accent, fontFamily: T.mono }}>{editProviderObj.docs}</span>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={cancelReplace}
              style={{
                padding: "9px 16px",
                borderRadius: 8,
                border: `1px solid ${T.line}`,
                background: "transparent",
                color: T.muted,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: T.sans,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={saveReplace}
              disabled={!validKey}
              style={{
                padding: "9px 16px",
                borderRadius: 8,
                border: "none",
                background: validKey ? T.accent : T.panelAlt,
                color: validKey ? "#fff" : T.dim,
                fontSize: 12,
                fontWeight: 700,
                fontFamily: T.sans,
                cursor: validKey ? "pointer" : "not-allowed",
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ProviderTile({
  provider,
  active,
  onSelect,
}: {
  provider: (typeof AI_PROVIDERS)[number];
  active: boolean;
  onSelect?: () => void;
}) {
  const T = useTheme();
  const interactive = !!onSelect;
  return (
    <button
      onClick={onSelect}
      disabled={!interactive}
      style={{
        padding: "16px 18px",
        borderRadius: T.rMd,
        cursor: interactive ? "pointer" : "default",
        textAlign: "left",
        background: active ? T.panelAlt : "transparent",
        border: `1px solid ${active ? T.accent + "55" : T.line}`,
        transition: "all .15s ease",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: provider.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 800,
            color: "#fff",
            fontFamily: T.sans,
          }}
        >
          {provider.name.charAt(0)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text, fontFamily: T.sans }}>
            {provider.name}
          </div>
          <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>by {provider.by}</div>
        </div>
        {active && interactive && (
          <span
            style={{
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
        default · {provider.defaultModel}
      </div>
    </button>
  );
}
