import { useMemo, useState } from "react";
import { useTheme, useTweaks } from "../ink/theme";
import { Card, CardTitle, LiveDot, PageHeader, Row, Toggle } from "../ink/primitives";
import { useBankSenders } from "../hooks/useBankSenders";
import { useDeleteAllData } from "../hooks/useDeleteAllData";
import { usePayments, useFailedPayments } from "../hooks/useTransactions";
import { useCredits } from "../hooks/useCredits";
import { SettingsAISection } from "../components/SettingsAISection";

export function Settings() {
  const T = useTheme();
  const { tweaks, setTweaks } = useTweaks();
  const { senders, toggleSender, addSender } = useBankSenders();
  const { deleteAllData, isDeleting, totalCount } = useDeleteAllData();
  const { payments } = usePayments();
  const { failedPayments } = useFailedPayments();
  const { credits } = useCredits();

  const [confirm, setConfirm] = useState(false);
  const [newSenderId, setNewSenderId] = useState("");
  const [newSenderName, setNewSenderName] = useState("");

  const senderCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of [...payments, ...failedPayments, ...credits]) {
      m[p.bankSenderId] = (m[p.bankSenderId] || 0) + 1;
    }
    return m;
  }, [payments, failedPayments, credits]);

  const handleAddSender = async () => {
    if (!newSenderId.trim()) return;
    await addSender(newSenderId.trim().toUpperCase(), newSenderName.trim() || newSenderId.trim());
    setNewSenderId("");
    setNewSenderName("");
  };

  const handleExport = () => {
    // Include every dataset the dashboard reads so a re-import or external
    // analysis has a complete picture. Missing `credits` here silently drops
    // every incoming-money row from the backup.
    const payload = { exportedAt: Date.now(), payments, failedPayments, credits };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `xarji-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async () => {
    await deleteAllData();
    setConfirm(false);
  };

  const Section = ({
    title,
    subtitle,
    children,
  }: {
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <Card pad="24px 26px">
      <div style={{ marginBottom: 16 }}>
        <CardTitle>{title}</CardTitle>
        {subtitle && (
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4, fontFamily: T.sans, lineHeight: 1.5 }}>{subtitle}</div>
        )}
      </div>
      {children}
    </Card>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap, height: "100%", overflowY: "auto" }}>
      <PageHeader eyebrow="Settings · preferences · data" title="Manage" ranges={null} />

      <SettingsAISection />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: T.density.gap }}>
        <Section
          title="Bank senders"
          subtitle="Xarji reads SMS from these senders. Disable one to stop parsing its messages (existing data is kept)."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {senders.length === 0 && (
              <div style={{ color: T.muted, fontSize: 12, fontFamily: T.sans, padding: "8px 0" }}>
                No senders configured yet.
              </div>
            )}
            {senders.map((b) => {
              const count = senderCounts[b.senderId] || 0;
              return (
                <div
                  key={b.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 16px",
                    background: T.panelAlt,
                    borderRadius: T.rMd,
                    border: `1px solid ${T.line}`,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: T.accent,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 800,
                      color: "#fff",
                      fontFamily: T.sans,
                    }}
                  >
                    {b.senderId.charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: T.sans }}>
                      {b.senderId} · {b.displayName}
                    </div>
                    <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, marginTop: 2 }}>
                      {count.toLocaleString("en-US")} transactions parsed
                    </div>
                  </div>
                  <Toggle active={b.enabled} onChange={() => toggleSender(b.id, !b.enabled)} />
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <input
              value={newSenderId}
              onChange={(e) => setNewSenderId(e.target.value)}
              placeholder="Sender ID (e.g. SOLO)"
              style={{
                flex: 1,
                padding: "8px 12px",
                background: T.panelAlt,
                border: `1px solid ${T.line}`,
                color: T.text,
                borderRadius: 10,
                fontSize: 12,
                fontFamily: T.sans,
                outline: "none",
              }}
            />
            <input
              value={newSenderName}
              onChange={(e) => setNewSenderName(e.target.value)}
              placeholder="Display name"
              style={{
                flex: 1,
                padding: "8px 12px",
                background: T.panelAlt,
                border: `1px solid ${T.line}`,
                color: T.text,
                borderRadius: 10,
                fontSize: 12,
                fontFamily: T.sans,
                outline: "none",
              }}
            />
            <button
              onClick={handleAddSender}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: "none",
                background: T.accent,
                color: "#fff",
                fontSize: 12.5,
                fontWeight: 700,
                fontFamily: T.sans,
                cursor: "pointer",
              }}
            >
              Add
            </button>
          </div>
        </Section>

        <Section title="Appearance" subtitle="Visual preferences. Use the Tweaks panel (bottom-right) for quick live changes.">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Row label="Theme mode" hint="Dark or light canvas">
              <div style={{ display: "flex", gap: 6 }}>
                {(["dark", "light"] as const).map((v) => {
                  const active = tweaks.mode === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setTweaks({ ...tweaks, mode: v })}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 10,
                        background: active ? T.accentSoft : T.panelAlt,
                        color: active ? T.accent : T.muted,
                        fontSize: 12.5,
                        fontWeight: 600,
                        fontFamily: T.sans,
                        cursor: "pointer",
                        border: `1px solid ${active ? T.accent + "33" : T.line}`,
                        textTransform: "capitalize",
                      }}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </Row>
            <Row label="Density" hint="Affects row padding and gap">
              <div style={{ display: "flex", gap: 6 }}>
                {(["spacious", "balanced", "dense"] as const).map((v) => {
                  const active = tweaks.density === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setTweaks({ ...tweaks, density: v })}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 10,
                        background: active ? T.accentSoft : T.panelAlt,
                        color: active ? T.accent : T.muted,
                        fontSize: 12.5,
                        fontWeight: 600,
                        fontFamily: T.sans,
                        cursor: "pointer",
                        border: `1px solid ${active ? T.accent + "33" : T.line}`,
                        textTransform: "capitalize",
                      }}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </Row>
            <Row label="Charts" hint="Show or hide trend/donut visuals">
              <Toggle active={tweaks.chartsVisible} onChange={() => setTweaks({ ...tweaks, chartsVisible: !tweaks.chartsVisible })} />
            </Row>
          </div>
        </Section>

        <Section title="Data sources" subtitle="macOS Messages.app is the source of truth. Xarji reads the SQLite store read-only.">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { k: "Messages.app", v: "~/Library/Messages/chat.db", hint: "service reads on macOS", ok: true },
              {
                k: "InstantDB",
                v: "connected · live",
                hint: `${payments.length + failedPayments.length + credits.length} rows`,
                ok: true,
              },
              { k: "Local backup", v: "~/.xarji/transactions.json", hint: "written by the service", ok: true },
              { k: "Parser", v: "bun service", hint: "see service logs for details", ok: true },
            ].map((d) => (
              <div key={d.k} style={{ padding: 14, background: T.panelAlt, borderRadius: T.rMd, border: `1px solid ${T.line}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text, fontFamily: T.sans }}>{d.k}</span>
                  <LiveDot color={d.ok ? T.green : T.accent} />
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: T.muted,
                    marginTop: 6,
                    fontFamily: T.mono,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.v}
                </div>
                <div style={{ fontSize: 10, color: T.dim, marginTop: 4, fontFamily: T.sans }}>{d.hint}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Danger zone" subtitle="Delete parsed transactions, or export. Messages.app data is never modified.">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Row label="Export data" hint="Download a JSON backup of all transactions">
              <button
                onClick={handleExport}
                style={{
                  padding: "9px 16px",
                  borderRadius: 10,
                  border: `1px solid ${T.line}`,
                  background: T.panelAlt,
                  color: T.text,
                  fontSize: 12.5,
                  fontWeight: 600,
                  fontFamily: T.sans,
                  cursor: "pointer",
                }}
              >
                Download .json
              </button>
            </Row>
            <Row
              label="Delete all transactions"
              hint={`Removes ${totalCount.toLocaleString("en-US")} records · SMS remain in Messages.app`}
            >
              {confirm ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => setConfirm(false)}
                    disabled={isDeleting}
                    style={{
                      padding: "9px 14px",
                      borderRadius: 10,
                      border: `1px solid ${T.line}`,
                      background: "transparent",
                      color: T.muted,
                      fontSize: 12.5,
                      fontWeight: 600,
                      fontFamily: T.sans,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    style={{
                      padding: "9px 14px",
                      borderRadius: 10,
                      border: "none",
                      background: T.accent,
                      color: "#fff",
                      fontSize: 12.5,
                      fontWeight: 700,
                      fontFamily: T.sans,
                      cursor: isDeleting ? "progress" : "pointer",
                      opacity: isDeleting ? 0.7 : 1,
                    }}
                  >
                    {isDeleting ? "Deleting…" : "Confirm delete"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirm(true)}
                  style={{
                    padding: "9px 16px",
                    borderRadius: 10,
                    border: `1px solid ${T.accent}55`,
                    background: T.accentSoft,
                    color: T.accent,
                    fontSize: 12.5,
                    fontWeight: 700,
                    fontFamily: T.sans,
                    cursor: "pointer",
                  }}
                >
                  Delete…
                </button>
              )}
            </Row>
          </div>
        </Section>
      </div>
    </div>
  );
}
