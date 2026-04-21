import { useTheme } from "../ink/theme";
import { Card, CardTitle, Pill, PageHeader } from "../ink/primitives";
import { useSignals } from "../hooks/useSignals";
import { getCategory } from "../lib/utils";

function SignalCard({
  icon,
  title,
  count,
  level,
  children,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  count: React.ReactNode;
  level: "high" | "mid" | "low";
  children: React.ReactNode;
}) {
  const T = useTheme();
  const color = level === "high" ? T.accent : level === "mid" ? T.amber : T.blue;
  const bg = level === "high" ? T.accentSoft : level === "mid" ? "rgba(241,184,74,0.12)" : "rgba(106,163,255,0.12)";
  return (
    <Card pad="22px 24px" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: bg,
              color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontFamily: T.sans,
              fontWeight: 700,
            }}
          >
            {icon}
          </div>
          <div>
            <CardTitle size={14}>{title}</CardTitle>
            <div style={{ fontSize: 11, color: T.muted, fontFamily: T.sans, marginTop: 2 }}>{count}</div>
          </div>
        </div>
        <Pill bg={bg} color={color}>{level}</Pill>
      </div>
      <div>{children}</div>
    </Card>
  );
}

export function Analytics() {
  const T = useTheme();
  const { monthFailed, repeatedDeclines, largeTx, newMerchants, cards, activeCount } = useSignals();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap, height: "100%" }}>
      <PageHeader
        eyebrow="Automatic anomaly detection · this month"
        title="Signals"
        ranges={null}
        rightSlot={<Pill bg={T.accentSoft} color={T.accent}>{activeCount} active</Pill>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: T.density.gap }}>
        <SignalCard
          icon="⚠"
          title="Repeated declines"
          count={`${repeatedDeclines.length} merchant${
            repeatedDeclines.length === 1 ? "" : "s"
          } 2+ times · ${monthFailed.length} decline${monthFailed.length === 1 ? "" : "s"} overall`}
          level="high"
        >
          {repeatedDeclines.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 12 }}>
              {monthFailed.length === 0
                ? "No declined payments this month."
                : "No merchant was declined twice or more this month."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {repeatedDeclines.slice(0, 4).map((r) => {
                // Use the most recent failing SMS for this merchant as the
                // supporting detail (reason + card + bank + date).
                const recent = monthFailed.find((f) => (f.merchant || "Unknown") === r.merchant);
                return (
                  <div
                    key={r.merchant}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      background: T.panelAlt,
                      borderRadius: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        background: T.accentSoft,
                        color: T.accent,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        fontFamily: T.sans,
                      }}
                    >
                      {(r.merchant || "?").charAt(0)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: T.sans }}>
                        {r.merchant || "Unknown"} · ×{r.count}
                      </div>
                      <div style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>
                        {recent?.failureReason || "—"} · ·{recent?.cardLastDigits || "—"} ·{" "}
                        {recent
                          ? new Date(recent.transactionDate).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })
                          : "—"}
                      </div>
                    </div>
                    {recent && <Pill>{recent.bankSenderId}</Pill>}
                  </div>
                );
              })}
            </div>
          )}
        </SignalCard>

        <SignalCard icon="⬆" title="Unusually large" count="Top transactions this month" level="mid">
          {largeTx.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 12 }}>Nothing yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {largeTx.map((t) => {
                const cat = getCategory(t.merchant, t.rawMessage);
                return (
                  <div
                    key={t.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      background: T.panelAlt,
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: T.sans }}>{t.merchant || "—"}</div>
                      <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>
                        {cat.name} · {new Date(t.transactionDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.text, fontFamily: T.sans, fontVariantNumeric: "tabular-nums" }}>
                      ₾{Math.round(t.amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SignalCard>

        <SignalCard
          icon="✦"
          title="New merchants"
          count={`${newMerchants.length} first-time merchants this month`}
          level="low"
        >
          {newMerchants.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 12 }}>No new merchants vs the previous 90 days.</div>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {newMerchants.slice(0, 8).map((n) => (
                  <div
                    key={n}
                    style={{
                      padding: "8px 12px",
                      background: T.panelAlt,
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                      color: T.text,
                      fontFamily: T.sans,
                    }}
                  >
                    {n}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 10, fontFamily: T.sans }}>
                These merchants haven't appeared in the previous 90 days.
              </div>
            </>
          )}
        </SignalCard>

        <SignalCard
          icon="⟳"
          title="Card usage"
          count={`${cards.length} card${cards.length === 1 ? "" : "s"} used this month`}
          level="low"
        >
          {cards.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 12 }}>No cards detected.</div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {cards.slice(0, 4).map((c, i) => (
                <div
                  key={c.card}
                  style={{
                    flex: "1 1 120px",
                    padding: "10px 12px",
                    background: T.panelAlt,
                    borderRadius: 10,
                    border: i === cards.length - 1 && cards.length > 1 ? `1px solid ${T.accent}55` : `1px solid ${T.line}`,
                  }}
                >
                  <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, letterSpacing: 0.4 }}>··{c.card}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginTop: 6, fontFamily: T.sans }}>
                    ₾{Math.round(c.total)}
                  </div>
                  <div style={{ fontSize: 10, color: T.muted, marginTop: 2, fontFamily: T.sans }}>{c.count} tx</div>
                </div>
              ))}
            </div>
          )}
        </SignalCard>
      </div>

      <Card pad="18px 22px" style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: T.panelAlt,
            color: T.muted,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: T.sans,
            fontSize: 14,
          }}
        >
          ⓘ
        </div>
        <div style={{ fontSize: 12, color: T.muted, fontFamily: T.sans, lineHeight: 1.5 }}>
          Signals are computed from the current month's transactions and the previous 90 days. They update automatically as new SMS are
          parsed.
        </div>
      </Card>
    </div>
  );
}
