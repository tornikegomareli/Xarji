import { useMemo, useState } from "react";
import { useTheme, useViewport } from "../ink/theme";
import { Card, CardLabel, CardTitle, Pill, LiveDot, LinkBtn, PageHeader } from "../ink/primitives";
import { AreaChart, Donut, Sparkline } from "../ink/charts";
import { TxRow, type InkTx } from "../ink/TxRow";
import { usePayments, useFailedPayments } from "../hooks/useTransactions";
import { useMonthStats, useMonthSpendingByDay, useMonthTopMerchants } from "../hooks/useMonthlyAnalytics";
import { useMonthlyTrend } from "../hooks/useMonthlyTrend";
import { useCredits, useMonthCredits } from "../hooks/useCredits";
import { formatCompact } from "../ink/format";
import { getCategory, DEFAULT_CATEGORIES } from "../lib/utils";
import { isWithinInterval, startOfMonth, endOfMonth, format } from "date-fns";

export function Dashboard() {
  const T = useTheme();
  const vp = useViewport();
  const now = new Date();
  const my = { month: now.getMonth(), year: now.getFullYear() };

  const stats = useMonthStats(my);
  const daily = useMonthSpendingByDay(my);
  const topMerchants = useMonthTopMerchants(my, 5);
  const trend = useMonthlyTrend(9);
  const { payments } = usePayments();
  const { failedPayments } = useFailedPayments();
  const { credits } = useCredits();
  const monthCredits = useMonthCredits(my);

  const [range, setRange] = useState("Month");

  const trendData = useMemo(
    () => trend.map((m) => ({ label: m.label.slice(0, 3), value: m.total })),
    [trend]
  );

  // Category breakdown for this month
  const byCategory = useMemo(() => {
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);
    const map: Record<string, { total: number; count: number; meta: typeof DEFAULT_CATEGORIES[number] }> = {};
    for (const p of payments) {
      if (p.currency !== "GEL") continue;
      if (!isWithinInterval(new Date(p.transactionDate), { start: monthStart, end: monthEnd })) continue;
      const cat = getCategory(p.merchant, p.rawMessage);
      if (!map[cat.id]) map[cat.id] = { total: 0, count: 0, meta: cat };
      map[cat.id].total += p.amount;
      map[cat.id].count += 1;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [payments]);

  const topCats = byCategory.slice(0, 5);
  const totalCatSum = topCats.reduce((s, c) => s + c.total, 0) || 1;

  // Recent transactions (payments + failed + credits mixed, newest first)
  const recent: InkTx[] = useMemo(() => {
    const combined: InkTx[] = [
      ...payments.map((p) => ({
        id: p.id,
        kind: "payment" as const,
        merchant: p.merchant || "",
        rawMerchant: p.rawMessage,
        amount: p.amount,
        currency: p.currency,
        cardLastDigits: p.cardLastDigits,
        transactionDate: p.transactionDate,
        bankSenderId: p.bankSenderId,
        category: getCategory(p.merchant, p.rawMessage).id,
        rawMessage: p.rawMessage,
        plusEarned: p.plusEarned,
      })),
      ...failedPayments.map((f) => ({
        id: f.id,
        kind: "failed" as const,
        merchant: f.merchant || "",
        rawMerchant: f.rawMessage,
        amount: null,
        currency: f.currency,
        cardLastDigits: f.cardLastDigits,
        transactionDate: f.transactionDate,
        bankSenderId: f.bankSenderId,
        category: getCategory(f.merchant, f.rawMessage).id,
        rawMessage: f.rawMessage,
        failureReason: f.failureReason,
      })),
      ...credits.map((c) => ({
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
      })),
    ];
    return combined.sort((a, b) => b.transactionDate - a.transactionDate).slice(0, 7);
  }, [payments, failedPayments, credits]);

  const dailyValues = daily.map((d) => d.amount);
  const positive = stats.totalChange > 0;
  const dayNum = now.getDate();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const monthTitle = format(now, "MMMM, 'at a glance'");
  const lowDay = Math.min(...dailyValues.filter((v) => v > 0), Infinity);
  const highDay = Math.max(...dailyValues, 0);
  const median = (() => {
    const sorted = [...dailyValues].filter((v) => v > 0).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    return sorted[Math.floor(sorted.length / 2)];
  })();

  const monthShort = Math.round(stats.total).toLocaleString("en-US");
  const monthDecimals = stats.total.toFixed(2).split(".")[1];
  const momDeltaRound = Math.round(Math.abs(stats.total - stats.prevTotal));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap, height: "100%" }}>
      <PageHeader
        eyebrow={`${greeting}`}
        title={monthTitle}
        active={range}
        onRange={setRange}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: vp.veryNarrow ? "1fr" : "1.6fr 1fr",
          gap: T.density.gap,
        }}
      >
        <Card pad="30px 32px" glow>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <CardLabel>Spent this month · GEL</CardLabel>
            {stats.prevTotal > 0 && (
              <Pill bg={T.accent} color="#fff">
                {positive ? "↑" : "↓"} {Math.abs(stats.totalChange).toFixed(1)}%
              </Pill>
            )}
          </div>
          <div
            style={{
              marginTop: 12,
              fontSize: "clamp(52px, 8.2vw, 84px)",
              fontWeight: 700,
              letterSpacing: -4,
              lineHeight: 1,
              color: T.text,
              fontFamily: T.sans,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: T.accent, opacity: 0.9 }}>₾</span>
            {monthShort}
            <span style={{ fontSize: "0.43em", color: T.muted }}>.{monthDecimals}</span>
          </div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 4, fontFamily: T.sans }}>
            {stats.prevTotal > 0 ? `${positive ? "+" : "−"}₾${momDeltaRound.toLocaleString("en-US")} vs last month · ` : ""}
            {dayNum} days · {stats.count} transactions
          </div>
          {monthCredits.total > 0 && (
            <div
              style={{
                fontSize: 13,
                marginTop: 12,
                fontFamily: T.sans,
                display: "flex",
                gap: 16,
                alignItems: "baseline",
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: T.green, fontWeight: 700 }}>
                + ₾{Math.round(monthCredits.total).toLocaleString("en-US")}
              </span>
              <span style={{ color: T.muted }}>earned this month</span>
              <span style={{ color: T.dim, fontFamily: T.mono, fontSize: 11 }}>
                net {monthCredits.total - stats.total >= 0 ? "+" : "−"}₾
                {Math.abs(Math.round(monthCredits.total - stats.total)).toLocaleString("en-US")}
              </span>
            </div>
          )}
          {T.chartsVisible && trendData.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <AreaChart
                data={trendData}
                width={640}
                height={120}
                stroke={T.accent}
                fill={T.accentSoft}
                strokeWidth={2}
                showGrid={false}
                showAxes={false}
                cornerRadius={14}
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
                {trendData.map((d, i) => (
                  <span key={i}>{d.label.toUpperCase()}</span>
                ))}
              </div>
            </div>
          )}
        </Card>

        <div
          style={{
            display: "grid",
            gridTemplateRows: vp.veryNarrow ? "none" : "1fr 1fr",
            gridTemplateColumns: vp.veryNarrow ? "1fr 1fr" : "1fr",
            gap: T.density.gap,
          }}
        >
          <Card accent pad="22px 26px" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 12, color: T.accent, fontWeight: 700, fontFamily: T.sans, whiteSpace: "nowrap" }}>Daily avg</div>
              <Pill>{dayNum}d</Pill>
            </div>
            <div>
              <div style={{ fontSize: vp.narrow ? 32 : 40, fontWeight: 800, letterSpacing: -1.8, lineHeight: 1, color: T.text, fontFamily: T.sans }}>
                ₾{Math.round(stats.total / Math.max(1, dayNum))}
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 4, fontFamily: T.sans }}>
                low ₾{Number.isFinite(lowDay) ? Math.round(lowDay) : 0} · high ₾{Math.round(highDay)} · median ₾{Math.round(median)}
              </div>
            </div>
            {T.chartsVisible && dailyValues.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Sparkline values={dailyValues} width={280} height={28} stroke={T.accent} strokeWidth={1.5} />
              </div>
            )}
          </Card>

          <Card pad="22px 26px" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <CardLabel>Declined</CardLabel>
              {stats.failedCount > 0 && <Pill>Watch</Pill>}
            </div>
            <div>
              <div style={{ fontSize: vp.narrow ? 32 : 40, fontWeight: 800, letterSpacing: -1.8, lineHeight: 1, color: T.text, fontFamily: T.sans }}>
                {stats.failedCount}
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 4, fontFamily: T.sans }}>
                {stats.failedCount === 0 ? "No declined payments this month" : "Failed payments this month"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {Array.from({ length: Math.min(8, stats.failedCount) }).map((_, i) => (
                <span key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: T.accent, opacity: 0.4 + (i % 3) * 0.2 }} />
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Spending mix + recent */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: vp.veryNarrow ? "1fr" : "1fr 1.4fr",
          gap: T.density.gap,
          flex: 1,
          minHeight: 0,
        }}
      >
        <Card pad="22px 24px" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
            <CardTitle>Spending mix</CardTitle>
            <LinkBtn>By merchant →</LinkBtn>
          </div>
          {topCats.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 12, padding: "40px 0", textAlign: "center" }}>
              No spending data yet.
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 4 }}>
              <Donut
                segments={topCats.map((c) => ({ value: c.total, color: c.meta.color }))}
                size={200}
                thickness={28}
                gap={4}
                centerLabel={format(now, "MMM").toUpperCase()}
                centerValue={"₾" + formatCompact(stats.total)}
                centerColor={T.text}
                labelFont={T.sans}
              />
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 22 }}>
                {topCats.map((c) => {
                  const pct = (c.total / totalCatSum) * 100;
                  return (
                    <div key={c.meta.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: c.meta.color }} />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: T.text, fontFamily: T.sans }}>{c.meta.name}</span>
                      <span style={{ fontSize: 12, color: T.muted, fontVariantNumeric: "tabular-nums", fontFamily: T.mono }}>{pct.toFixed(0)}%</span>
                      <span style={{ fontSize: 13, fontWeight: 700, minWidth: 64, textAlign: "right", fontVariantNumeric: "tabular-nums", color: T.text, fontFamily: T.sans }}>
                        ₾{Math.round(c.total)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        <Card pad="22px 24px" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
            <CardTitle>Today & recent</CardTitle>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Pill bg="rgba(75,217,162,0.15)" color={T.green}>
                <LiveDot color={T.green} />
                Live
              </Pill>
              <LinkBtn>All →</LinkBtn>
            </div>
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginBottom: 8, fontFamily: T.sans }}>
            Updates arrive as SMS messages are parsed
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            {recent.length === 0 ? (
              <div style={{ color: T.muted, fontSize: 12, padding: "40px 0", textAlign: "center" }}>No transactions yet.</div>
            ) : (
              recent.map((t, i) => <TxRow key={t.id} t={t} isLast={i === recent.length - 1} />)
            )}
          </div>
        </Card>
      </div>

      {/* Top merchants */}
      <Card pad="20px 24px">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <CardTitle>Top merchants · {format(now, "MMMM")}</CardTitle>
          <LinkBtn>Explore →</LinkBtn>
        </div>
        {topMerchants.length === 0 ? (
          <div style={{ color: T.muted, fontSize: 12, padding: "20px 0" }}>No merchant data yet.</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: vp.narrow ? "repeat(3, 1fr)" : "repeat(5, 1fr)",
              gap: 14,
            }}
          >
            {topMerchants.map((m) => {
              const cat = getCategory(m.name);
              return (
                <div
                  key={m.name}
                  style={{
                    padding: "14px 14px",
                    background: T.panelAlt,
                    borderRadius: T.rMd,
                    border: `1px solid ${T.line}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: cat.color }} />
                    <span
                      style={{
                        fontSize: 10,
                        color: T.dim,
                        fontFamily: T.mono,
                        letterSpacing: 0.4,
                        textTransform: "uppercase",
                      }}
                    >
                      {cat.name}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: T.sans, letterSpacing: -0.2 }}>
                    {m.name}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 800,
                        color: T.text,
                        fontFamily: T.sans,
                        letterSpacing: -0.5,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      ₾{Math.round(m.total)}
                    </div>
                    <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>×{m.count}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
