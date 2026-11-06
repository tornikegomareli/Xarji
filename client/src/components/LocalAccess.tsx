import { useEffect, useState } from "react";
import { localApi, setLocalCsrf } from "../lib/local-api";
import { clearLocalData } from "../lib/local-db";

export function LocalAccess({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void localApi<{ csrf: string }>("/api/session").then(result => {
      if (!cancelled) { setLocalCsrf(result.csrf); setReady(true); }
    }).catch(() => { /* locked until the local capability is supplied */ }).finally(() => { if (!cancelled) setChecking(false); });
    const lock = () => { setReady(false); setLocalCsrf(""); clearLocalData(); };
    window.addEventListener("xarji-locked", lock);
    return () => { cancelled = true; window.removeEventListener("xarji-locked", lock); };
  }, []);
  if (ready) return children;
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0C0C0E", color: "#eee", fontFamily: "system-ui", padding: 24 }}>
    <form style={{ maxWidth: 440, width: "100%", padding: 32, background: "#171719", borderRadius: 20, border: "1px solid #333" }} onSubmit={async event => {
      event.preventDefault(); setError("");
      try {
        const result = await localApi<{ csrf: string }>("/api/session", { method: "POST", headers: { Authorization: `Bearer ${token.trim()}` }, body: "{}" });
        setLocalCsrf(result.csrf); setToken(""); setReady(true);
      } catch { setError("Access refused. Check the local UI token and try again."); }
    }}>
      <div style={{ color: "#ff5a3a", fontSize: 12, letterSpacing: 2 }}>XARJI · LOCAL ONLY</div>
      <h1 style={{ fontSize: 28, letterSpacing: -1 }}>Your finances stay here.</h1>
      <p style={{ color: "#aaa", lineHeight: 1.6 }}>Unlock this Mac’s dashboard with the access token in the <code>ui.token</code> file shown by the local launcher. The token is never sent to a cloud service.</p>
      <label htmlFor="local-token">Local access token</label>
      <input id="local-token" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box", margin: "10px 0 16px", padding: 12, border: "1px solid #444", borderRadius: 8, background: "#0c0c0e", color: "#eee" }} />
      <button disabled={checking || !token.trim()} style={{ background: "#ff5a3a", color: "white", border: 0, borderRadius: 8, padding: "12px 20px", fontWeight: 700 }}>{checking ? "Checking local session…" : "Unlock dashboard"}</button>
      {error && <p role="alert" style={{ color: "#ff9276" }}>{error}</p>}
      <p style={{ marginTop: 24, fontSize: 12, color: "#888" }}>SMS records may be incomplete. This dashboard is not a bank statement or a verified account balance.</p>
    </form>
  </div>;
}
