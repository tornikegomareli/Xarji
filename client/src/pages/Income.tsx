import { useMemo, useState } from "react";
import { useTheme, useViewport } from "../ink/theme";
import { Card, CardLabel, CardTitle, Pill, PageHeader } from "../ink/primitives";
import { TxRow, type InkTx } from "../ink/TxRow";
import { useCredits, useMonthCredits } from "../hooks/useCredits";
import { useBankSenders } from "../hooks/useBankSenders";
import { useMonthlyTrend } from "../hooks/useMonthlyTrend";
import { AreaChart } from "../ink/charts";
import { currencySymbol, monthKey, formatLocalDay, parseLocalDay } from "../ink/format";
import { isWithinInterval, startOfMonth, endOfMonth, format } from "date-fns";

export function Income() {
  const T = useTheme();
  const vp = useViewport();
  const now = new Date();
  const my = { month: now.getMonth(), year: now.getFullYear() };
  const { credits } = useCredits();
  const monthly = useMonthCredits(my);
  const { senders } = useBankSenders();
  const monthlyTrend = useMonthlyTrend(9);

  const [search, setSearch] = useState("");
  const [bank, setBank] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const credits6mTrend = useMemo(() => {
    // credits-only monthly totals (GEL)
    const keys = monthlyTrend.map((m) => m.key);
    const totals: Record<string, number> = {};
    for (const c of credits) {
      if (c.currency !== "GEL") continue;
      const k = monthKey(c.transactionDate);
      if (!keys.includes(k)) continue;
      totals[k] = (totals[k] || 0) + c.amount;
    }
    return monthlyTrend.map((m) => ({ label: m.label.slice(0, 3), value: totals[m.key] || 0 }));
  }, [credits, monthlyTrend]);

  const allTx: InkTx[] = useMemo(() => {
    return credits.map((c) => ({
      id: c.id,
      kind: "credit" as const,
      merchant: c.counterparty || "Income",
      rawMerchant: c.rawMessage,
      amount: c.amount,
      currency: c.currency,
      cardLastDigits: c.cardLastDigits,
      transactionDate: c.transactionDate,
      bankSenderId: c.bankSenderId,
      category: "other",
      rawMessage: c.rawMessage,
      counterparty: c.counterparty,
    }));
  }, [credits]);

  const filtered = useMemo(() => {
    return allTx.filter((t) => {
      if (bank !== "all" && t.bankSenderId !== bank) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(t.merchant || "").toLowerCase().includes(q) && !(t.rawMessage || "").toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [allTx, bank, search]);

  const groups = useMemo(() => {
    const g: Record<string, InkTx[]> = {};
    for (const t of filtered.slice(0, 300)) {
      const key = formatLocalDay(t.transactionDate);
      if (!g[key]) g[key] = [];
      g[key].push(t);
    }
    return g;
  }, [filtered]);

  const dayKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  const selected = selectedId ? allTx.find((t) => t.id === selectedId) : null;

  const bankOptions =
    senders.length > 0
      ? senders.map((s) => ({ id: s.senderId, name: s.displayName }))
      : Array.from(new Set(allTx.map((t) => t.bankSenderId))).map((id) => ({ id, name: id }));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const topSources = useMemo(() => {
    const map: Record<string, { name: string; total: number; count: number }> = {};
    for (const c of credits) {
      if (c.currency !== "GEL") continue;
      if (!isWithinInterval(new Date(c.transactionDate), { start: monthStart, end: monthEnd })) continue;
      const name = c.counterparty || "—";
      if (!map[name]) map[name] = { name, total: 0, count: 0 };
      map[name].total += c.amount;
      map[name].count += 1;
    }
    return Object.values(map)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [credits, monthStart, monthEnd]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap, height: "100%" }}>
      <PageHeader
        eyebrow="Money coming in · parsed from SMS"
        title="Income"
        active="Month"
        rightSlot={
          <Pill bg="rgba(75,217,162,0.15)" color={T.green}>
            {credits.length} total
          </Pill>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: vp.veryNarrow ? "1fr" : "1.4fr 1fr",
          gap: T.density.gap,
        }}
      >
        <Card pad="26px 30px" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <CardLabel>Earned this month · GEL</CardLabel>
          <div
            style={{
              fontSize: "clamp(44px, 6vw, 72px)",
              fontWeight: 700,
              letterSpacing: -3,
              lineHeight: 1,
              color: T.text,
              fontFamily: T.sans,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: T.green, opacity: 0.9 }}>+₾</span>
            {Math.round(monthly.total).toLocaleString("en-US")}
            <span style={{ fontSize: "0.42em", color: T.muted }}>
              .{monthly.total.toFixed(2).split(".")[1] || "00"}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: T.muted, fontFamily: T.sans }}>
            {monthly.count} incoming transactions · {format(now, "MMMM yyyy")}
          </div>
          {T.chartsVisible && credits6mTrend.some((d) => d.value > 0) && (
            <div style={{ marginTop: 14 }}>
              <AreaChart
                data={credits6mTrend}
                width={560}
                height={110}
                stroke={T.green}
                fill="rgba(75,217,162,0.18)"
                strokeWidth={2}
                showGrid={false}
                showAxes={false}
                cornerRadius={12}
                padding={{ top: 6, right: 2, bottom: 22, left: 2 }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontFamily: T.mono,
                  fontSize: 10,
                  color: T.dim,
                  marginTop: 2,
                }}
              >
                {credits6mTrend.map((d, i) => (
                  <span key={i}>{d.label.toUpperCase()}</span>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card pad="22px 24px" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <CardTitle>Top sources · {format(now, "MMM")}</CardTitle>
            <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>{topSources.length}</span>
          </div>
          {topSources.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 12, padding: "20px 0" }}>No income this month.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {topSources.map((s) => (
                <div
                  key={s.name}
                  style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${T.line}`, gap: 10 }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: T.text,
                        fontFamily: T.sans,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.name}
                    </div>
                    <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>×{s.count}</div>
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: T.green,
                      fontFamily: T.sans,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    +₾{Math.round(s.total)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card pad="16px 18px">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div
            style={{
              flex: "1 1 260px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              background: T.panelAlt,
              borderRadius: 10,
              border: `1px solid ${T.line}`,
            }}
          >
            <span style={{ fontFamily: T.mono, color: T.dim }}>⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sender or raw SMS…"
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                color: T.text,
                fontSize: 13,
                outline: "none",
                fontFamily: T.sans,
              }}
            />
          </div>
          <select
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            style={{
              padding: "7px 12px",
              background: T.panelAlt,
              border: `1px solid ${T.line}`,
              color: T.text,
              borderRadius: 10,
              fontSize: 12,
              fontFamily: T.sans,
              cursor: "pointer",
            }}
          >
            <option value="all">All banks</option>
            {bankOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.id} · {b.name}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: selected ? (vp.narrow ? "1fr" : "1fr 340px") : "1fr",
          gap: T.density.gap,
          flex: 1,
          minHeight: 0,
        }}
      >
        <Card pad="8px 24px 16px" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: 1, overflowY: "auto", paddingTop: 8 }}>
            {dayKeys.length === 0 ? (
              <div style={{ color: T.muted, fontSize: 12, padding: "40px 0", textAlign: "center" }}>
                No incoming transactions yet.
              </div>
            ) : (
              dayKeys.map((key) => {
                const items = groups[key];
                const d = parseLocalDay(key);
                const dayTotal = items
                  .filter((t) => t.currency === "GEL")
                  .reduce((s, t) => s + (t.amount || 0), 0);
                const diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
                const label =
                  diff === 0
                    ? "Today"
                    : diff === 1
                    ? "Yesterday"
                    : d.toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric" });
                return (
                  <div key={key}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        padding: "14px 0 8px",
                        borderBottom: `1px solid ${T.line}`,
                        position: "sticky",
                        top: 0,
                        background: T.panel,
                        zIndex: 1,
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.sans, whiteSpace: "nowrap" }}>
                          {label}
                        </span>
                        <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, letterSpacing: 0.3, whiteSpace: "nowrap" }}>
                          {items.length} in
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 12,
                          color: T.green,
                          fontFamily: T.mono,
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                        }}
                      >
                        +₾{dayTotal.toFixed(2)}
                      </span>
                    </div>
                    {items.map((t, i) => (
                      <TxRow key={t.id} t={t} isLast={i === items.length - 1} onClick={() => setSelectedId(t.id)} />
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {selected && (
          <Card pad="22px 24px" style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <CardLabel>Incoming</CardLabel>
              <button
                onClick={() => setSelectedId(null)}
                style={{ border: "none", background: "transparent", color: T.dim, cursor: "pointer", fontSize: 16 }}
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: T.text, fontFamily: T.sans, letterSpacing: -0.8 }}>
              {selected.counterparty || selected.merchant || "—"}
            </div>
            <div
              style={{
                marginTop: 18,
                fontSize: 44,
                fontWeight: 800,
                color: T.green,
                fontFamily: T.sans,
                letterSpacing: -1.6,
                lineHeight: 1,
              }}
            >
              +{currencySymbol(selected.currency)}
              {(selected.amount ?? 0).toFixed(2)}
            </div>
            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                ["When", new Date(selected.transactionDate).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })],
                ["Bank", selected.bankSenderId],
                ["From", selected.counterparty || "—"],
              ].map(([k, v], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${T.line}` }}>
                  <span style={{ fontSize: 12, color: T.muted, fontFamily: T.sans }}>{k}</span>
                  <span style={{ fontSize: 12.5, color: T.text, fontFamily: T.sans, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 18 }}>
              <CardLabel>Raw SMS</CardLabel>
              <div
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: T.panelAlt,
                  borderRadius: T.rMd,
                  fontFamily: T.mono,
                  fontSize: 11,
                  color: T.muted,
                  lineHeight: 1.5,
                  border: `1px solid ${T.line}`,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {selected.rawMessage || "—"}
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
