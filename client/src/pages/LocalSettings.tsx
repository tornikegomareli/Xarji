import { useState } from "react";
import { useTheme } from "../ink/theme";
import { localApi, setLocalCsrf } from "../lib/local-api";
import { refreshLocalData, clearLocalData } from "../lib/local-db";
import { db } from "../lib/instant";
import { useBankSenders } from "../hooks/useBankSenders";

export function LocalSettings() {
  const T = useTheme();
  const { senders, toggleSender } = useBankSenders();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [rateDate, setRateDate] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState("");
  const action = async (fn: () => Promise<void>) => { setBusy(true); setNotice(""); try { await fn(); } catch { setNotice("The local operation could not be completed. No cloud fallback was attempted."); } finally { setBusy(false); } };
  const box: React.CSSProperties = { background: T.panel, border: `1px solid ${T.line}`, borderRadius: T.rLg, padding: 24, marginTop: 20 };
  const button: React.CSSProperties = { background: T.accent, border: 0, color: "white", padding: "10px 16px", borderRadius: 8, cursor: "pointer", marginRight: 12 };
  return <div style={{ color: T.text, fontFamily: T.sans, maxWidth: 900 }}>
    <h1>Manage your local ledger</h1>
    <p style={{ color: T.muted }}>SQLite on this Mac. No InstantDB, AI provider, webhook, online exchange rates or update checks in this mode.</p>
    <div style={box}><h2>Bank SMS import</h2>
      <p>Messages access is disabled unless the launcher is given an explicit database path after your approval. Manual import parses only enabled TBC senders; raw SMS and OTP are discarded.</p>
      {senders.map(sender => <label key={sender.id} style={{ display: "block", marginBottom: 12 }}><input type="checkbox" checked={sender.enabled} onChange={() => void action(() => toggleSender(sender.id, !sender.enabled))} /> {sender.displayName} · {sender.senderId}</label>)}
      <label style={{ display: "inline-block", ...button }}>Import SMS JSON<input aria-label="Import SMS JSON" type="file" accept="application/json,.json" disabled={busy} style={{ display: "none" }} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        void action(async () => {
          if (file.size > 1024 * 1024) throw new Error("File too large");
          const input = JSON.parse(await file.text());
          const result = await localApi<{ imported: number; securitySkipped: number; unsupported: number; duplicate: number }>("/api/import", { method: "POST", body: JSON.stringify(input) });
          await refreshLocalData();
          setNotice(`Imported ${result.imported}; OTP/security skipped ${result.securitySkipped}; unsupported ${result.unsupported}; duplicate ${result.duplicate}.`);
        });
      }} /></label>
      <button style={button} disabled={busy} onClick={() => void action(async () => { await localApi("/api/sync", { method: "POST", body: "{}" }); await refreshLocalData(); setNotice("Local Messages import complete."); })}>Sync approved Messages source</button>
      <p style={{ color: T.dim, fontSize: 12 }}>Import format: {`{ "messages": [{ "messageId": 1, "senderId": "TBC SMS", "timestamp": "2026-01-01T12:00:00Z", "text": "…" }] }`}</p>
    </div>
    <div style={box}><h2>Exchange rates, entered locally</h2><p>GEL totals omit foreign-currency transactions until an exact-date local rate is supplied. No rate is fetched from the internet.</p>
      <form onSubmit={event => { event.preventDefault(); void action(async () => {
        await localApi("/api/transact", { method: "POST", body: JSON.stringify({ operations: [{ collection: "exchangeRates", id: `${rateDate}-${currency}`, kind: "update", value: { date: rateDate, currency, rate: Number(rate) } }] }) });
        setNotice("Local rate saved. Reload the dashboard to apply it.");
      }); }}>
        <input aria-label="Rate date" type="date" value={rateDate} onChange={event => setRateDate(event.target.value)} required /> <select aria-label="Currency" value={currency} onChange={event => setCurrency(event.target.value)}><option>USD</option><option>EUR</option></select> <input aria-label="GEL per currency unit" type="number" step="0.0001" min="0.0001" value={rate} onChange={event => setRate(event.target.value)} required placeholder="GEL per 1 unit" /> <button style={button} disabled={busy}>Save local rate</button>
      </form>
    </div>
    <div style={box}><h2>Export and agent access</h2><p>The separate <code>agent-read.token</code> grants GET access only to bounded transaction and summary endpoints. It cannot unlock this UI, change records, import SMS or read names/card digits. Exported amounts remain financial data; sharing them with a cloud agent is a separate decision.</p>
      <button style={button} disabled={busy} onClick={() => void action(async () => {
        const data = await localApi("/api/export"); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "xarji-local-export.json"; link.click(); URL.revokeObjectURL(url);
      })}>Export local JSON</button>
      <button style={button} onClick={() => void action(async () => { await localApi("/api/session", { method: "DELETE" }); setLocalCsrf(""); clearLocalData(); window.dispatchEvent(new Event("xarji-locked")); })}>Lock dashboard</button>
    </div>
    <div style={box}><h2>Remove imported transactions</h2><p>Deletion keeps their fingerprints so the same SMS will not silently reappear. SMS in Messages are never modified.</p><button style={button} disabled={busy} onClick={() => {
      if (!confirm("Delete all imported transactions from this local ledger? Categories and budgets stay. Re-import of the same SMS stays blocked.")) return;
      void action(async () => {
        const snapshot = await localApi<{ data: Record<string, { id: string }[]> }>("/api/snapshot");
        const ops = [
          ...snapshot.data.payments.map(row => db.tx.payments[row.id].delete()),
          ...snapshot.data.failedPayments.map(row => db.tx.failedPayments[row.id].delete()),
          ...snapshot.data.credits.map(row => db.tx.credits[row.id].delete()),
        ];
        for (let i = 0; i < ops.length; i += 500) await db.transact(ops.slice(i, i + 500));
        setNotice("Imported transactions deleted locally.");
      });
    }}>Delete imported transactions</button></div>
    {notice && <p role="status" style={{ padding: 16, color: T.accent }}>{notice}</p>}
  </div>;
}
