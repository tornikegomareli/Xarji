// "Webhook" card for the Manage screen. Xarji POSTs each new
// transaction to the user's own bot. The secret stays in
// ~/.xarji/config.json; /api/webhook only reports whether one is saved.

import { useEffect, useState } from "react";
import { useTheme } from "../ink/theme";
import { Card, CardTitle } from "../ink/primitives";

interface WebhookView {
  enabled: boolean;
  url: string;
  hasSecret: boolean;
}

type Notice = { kind: "ok" | "error"; text: string } | null;

const OFF: WebhookView = { enabled: false, url: "", hasSecret: false };

async function post<R>(path: string, body?: unknown): Promise<R> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as R;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function SettingsWebhookSection() {
  const T = useTheme();
  const [saved, setSaved] = useState<WebhookView>(OFF);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    fetch("/api/webhook")
      .then((r) => r.json())
      .then((v: WebhookView) => {
        setSaved(v);
        setUrl(v.url);
      })
      .catch(() => {});
  }, []);

  const dirty = url.trim() !== saved.url || secret.trim() !== "";
  const canSave = !busy && dirty && url.trim() !== "";
  const canTest = !busy && saved.enabled && !dirty;

  const save = async (nextUrl: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const v = await post<WebhookView>("/api/webhook", { url: nextUrl, secret });
      setSaved(v);
      setUrl(v.url);
      setSecret("");
      setNotice({ kind: "ok", text: v.enabled ? "Saved. New transactions go to this URL." : "Webhook is off." });
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await post<{ ok: boolean; status?: number; error?: string }>("/api/webhook/test");
      if (r.ok) setNotice({ kind: "ok", text: `Test event sent. Your bot answered HTTP ${r.status}.` });
      else if (r.status) setNotice({ kind: "error", text: `Your bot answered HTTP ${r.status}.` });
      else setNotice({ kind: "error", text: `Test failed: ${r.error}` });
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const label = {
    fontSize: 10,
    color: T.dim,
    fontFamily: T.mono,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
    marginBottom: 6,
  };
  const input = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: T.rMd,
    background: T.panel,
    border: `1px solid ${T.line}`,
    color: T.text,
    fontSize: 13,
    fontFamily: T.mono,
    outline: "none",
  };
  const button = (primary: boolean, enabled: boolean) => ({
    padding: "8px 14px",
    borderRadius: 8,
    border: primary ? "none" : `1px solid ${T.line}`,
    background: primary ? (enabled ? T.accent : T.panelAlt) : "transparent",
    color: primary ? (enabled ? "#fff" : T.dim) : enabled ? T.text : T.dim,
    fontSize: 12,
    fontWeight: 700,
    fontFamily: T.sans,
    cursor: enabled ? "pointer" : "not-allowed",
  });

  return (
    <Card pad="24px 26px">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <div>
          <CardTitle>Webhook</CardTitle>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4, fontFamily: T.sans, lineHeight: 1.5 }}>
            Send each new transaction to your own bot as JSON (<code style={{ fontFamily: T.mono }}>xarji.payment/v1</code>).
            Transactions from before you turn it on are not sent.
          </div>
        </div>
        <span
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            background: saved.enabled ? "rgba(75,217,162,0.14)" : T.panelAlt,
            color: saved.enabled ? T.green : T.muted,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 0.5,
            textTransform: "uppercase",
            fontFamily: T.sans,
            whiteSpace: "nowrap",
          }}
        >
          {saved.enabled ? "On" : "Off"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div style={label}>URL</div>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-bot.example/xarji"
            autoComplete="off"
            spellCheck={false}
            style={input}
          />
        </div>
        <div>
          <div style={label}>Secret · sent as Authorization: Bearer</div>
          <input
            type="text"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={saved.hasSecret ? "Saved. Leave empty to keep it." : "Optional"}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            style={{ ...input, WebkitTextSecurity: "disc" } as React.CSSProperties}
          />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
        <div
          style={{
            flex: 1,
            fontSize: 11.5,
            fontFamily: T.sans,
            lineHeight: 1.4,
            color: notice?.kind === "error" ? T.accent : T.muted,
          }}
        >
          {notice?.text}
        </div>
        {saved.enabled && (
          <button onClick={() => save("")} disabled={busy} style={button(false, !busy)}>
            Turn off
          </button>
        )}
        <button onClick={sendTest} disabled={!canTest} style={button(false, canTest)}>
          Send test
        </button>
        <button onClick={() => save(url)} disabled={!canSave} style={button(true, canSave)}>
          Save
        </button>
      </div>
    </Card>
  );
}
