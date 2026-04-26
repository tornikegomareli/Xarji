import { useMemo } from "react";
import { useTheme, useViewport, type InkTheme } from "../ink/theme";
import { Card, CardLabel, CardTitle, Pill, LiveDot, LinkBtn, PageHeader } from "../ink/primitives";
import { AreaChart, Donut } from "../ink/charts";
import { TxRow, type InkTx } from "../ink/TxRow";
import { useConvertedPayments, useFailedPayments } from "../hooks/useTransactions";
import { useRangeStats, useRangeTopMerchants } from "../hooks/useMonthlyAnalytics";
import { useMonthlyTrend } from "../hooks/useMonthlyTrend";
import { useCredits, useRangeCredits } from "../hooks/useCredits";
import { useRangeState } from "../hooks/useRangeState";
import { previousRange } from "../lib/dateRange";
import { formatCompact } from "../ink/format";
import { DEFAULT_CATEGORIES } from "../lib/utils";
import { useCategorizer } from "../hooks/useCategorizer";
import { isWithinInterval, format } from "date-fns";

export function Dashboard() {
  const T = useTheme();
  const vp = useViewport();
  const now = new Date();
  const { range, props: rangeProps } = useRangeState("Month");
  const prevPeriod = useMemo(() => previousRange(range), [range]);

  const stats = useRangeStats(range);
  const topMerchants = useRangeTopMerchants(range, 5);
  const trend = useMonthlyTrend(9);
  const { payments } = useConvertedPayments();
  const { failedPayments } = useFailedPayments();
  const { credits } = useCredits();
  const monthCredits = useRangeCredits(range);
  const prevMonthCredits = useRangeCredits(prevPeriod);
  const { getCategory } = useCategorizer();

  const prevMonthName = prevPeriod.label;
  const prevMonthShort = prevPeriod.label.split(" ")[0]; // "Mar 2026" → "Mar", "Mar 1 – 31" → "Mar"
  const monthYearLabel = range.label;
  const monthShortName = range.label.split(" ")[0].toUpperCase();
  const income = monthCredits.total;
  const net = income - stats.total;
  const savingsRate = income > 0 ? (net / income) * 100 : 0;
  const incomeChange =
    prevMonthCredits.total > 0
      ? ((income - prevMonthCredits.total) / prevMonthCredits.total) * 100
      : null;

  const trendData = useMemo(
    () => trend.map((m) => ({ label: m.label.slice(0, 3), value: m.total })),
    [trend]
  );

  // Category breakdown for the active range. Uses the same date-fns
  // isWithinInterval the aggregator hooks use so the donut total
  // always reconciles with stats.total.
  const byCategory = useMemo(() => {
    const map: Record<string, { total: number; count: number; meta: typeof DEFAULT_CATEGORIES[number] }> = {};
    for (const p of payments) {
      if (p.gelAmount === null) continue;
      if (!isWithinInterval(new Date(p.transactionDate), { start: range.start, end: range.end })) continue;
      const cat = getCategory(p.merchant, p.rawMessage);
      if (!map[cat.id]) map[cat.id] = { total: 0, count: 0, meta: cat };
      map[cat.id].total += p.gelAmount;
      map[cat.id].count += 1;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [payments, getCategory, range]);

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
  }, [payments, failedPayments, credits, getCategory]);

  const positive = stats.totalChange > 0;
  const dayNum = now.getDate();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const monthTitle = format(now, "MMMM, 'at a glance'");

  const monthShort = Math.round(stats.total).toLocaleString("en-US");
  const monthDecimals = stats.total.toFixed(2).split(".")[1];
  const momDeltaRound = Math.round(Math.abs(stats.total - stats.prevTotal));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap, height: "100%" }}>
      <PageHeader
        eyebrow={`${greeting}`}
        title={monthTitle}
        {...rangeProps}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: vp.veryNarrow ? "1fr" : "1.6fr 1fr",
          gap: T.density.gap,
        }}
      >
        <Card pad="28px 32px" glow>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  background: T.accentSoft,
                  color: T.accent,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 800,
                  fontFamily: T.sans,
                }}
              >
                ↓
              </span>
              <div
                style={{
                  fontSize: 10.5,
                  color: T.muted,
                  fontFamily: T.mono,
                  fontWeight: 700,
                  letterSpacing: 1.2,
                  textTransform: "uppercase",
                }}
              >
                Outgoing · {monthYearLabel}
              </div>
            </div>
            {stats.prevTotal > 0 && (
              <Pill bg={positive ? T.accentSoft : "rgba(75,217,162,0.15)"} color={positive ? T.accent : T.green}>
                {positive ? "↑" : "↓"} {Math.abs(stats.totalChange).toFixed(1)}% vs {prevMonthShort}
              </Pill>
            )}
          </div>
          <div
            style={{
              marginTop: 18,
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                fontSize: "clamp(12px, 1vw, 13px)",
                color: T.muted,
                fontFamily: T.sans,
                fontWeight: 600,
                letterSpacing: 0.3,
                textTransform: "uppercase",
                alignSelf: "flex-start",
                marginTop: 10,
              }}
            >
              You spent
            </div>
            <div
              style={{
                fontSize: "clamp(48px, 7.6vw, 78px)",
                fontWeight: 700,
                letterSpacing: -3.8,
                lineHeight: 1,
                color: T.text,
                fontFamily: T.sans,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ color: T.accent, opacity: 0.9 }}>−₾</span>
              {monthShort}
              <span style={{ fontSize: "0.42em", color: T.muted }}>.{monthDecimals}</span>
            </div>
          </div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 6, fontFamily: T.sans }}>
            {stats.prevTotal > 0
              ? `${positive ? "+" : "−"}₾${momDeltaRound.toLocaleString("en-US")} ${positive ? "more" : "less"} than ${prevMonthName} · `
              : ""}
            {dayNum} days · {stats.count} transactions
          </div>

          <CashflowBar T={T} income={income} spent={stats.total} />
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
          <IncomeCard
            T={T}
            vpNarrow={vp.narrow}
            income={income}
            credits={monthCredits.credits}
            incomeChange={incomeChange}
            prevMonthShort={prevMonthShort}
          />

          <NetCashflowCard
            T={T}
            vpNarrow={vp.narrow}
            net={net}
            income={income}
            savingsRate={savingsRate}
            monthShortName={monthShortName}
          />
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
                segments={topCats.map((c) => ({ value: c.total, color: c.meta.color, name: c.meta.name }))}
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

// Horizontal cashflow bar: visualises income → spent → net under the
// hero number so "you spent" can't be mistaken for a balance.
function CashflowBar({ T, income, spent }: { T: InkTheme; income: number; spent: number }) {
  const net = Math.max(0, income - spent);
  const scale = Math.max(income, spent, 1);
  const spentPct = (spent / scale) * 100;
  const netPct = (net / scale) * 100;
  const overspent = income > 0 && spent > income;

  return (
    <div
      style={{
        marginTop: 22,
        padding: "16px 18px",
        background: T.panelAlt,
        border: `1px solid ${T.line}`,
        borderRadius: T.rMd,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <CashflowLegend T={T} dot={T.accent} label="Spent" value={"₾" + Math.round(spent).toLocaleString("en-US")} />
          <CashflowLegend
            T={T}
            dot={T.green}
            label="Net"
            value={(net >= 0 ? "+₾" : "−₾") + Math.abs(Math.round(net)).toLocaleString("en-US")}
            muted={income === 0}
          />
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: T.dim,
            fontFamily: T.mono,
            letterSpacing: 0.6,
            textTransform: "uppercase",
          }}
        >
          {income > 0 ? `of ₾${Math.round(income).toLocaleString("en-US")} income` : "no income recorded"}
        </div>
      </div>

      <div
        style={{
          position: "relative",
          height: 12,
          borderRadius: 6,
          background: T.panel,
          border: `1px solid ${T.line}`,
          overflow: "hidden",
          display: "flex",
        }}
      >
        <div
          style={{
            width: `${spentPct}%`,
            background: `linear-gradient(90deg, ${T.accent}, ${T.accent}cc)`,
            transition: "width .6s cubic-bezier(0.2, 0.8, 0.2, 1)",
          }}
        />
        <div
          style={{
            width: `${netPct}%`,
            background: `repeating-linear-gradient(45deg, ${T.green}55 0 6px, ${T.green}22 6px 12px)`,
            transition: "width .6s cubic-bezier(0.2, 0.8, 0.2, 1)",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 8,
          fontSize: 10,
          color: T.dim,
          fontFamily: T.mono,
        }}
      >
        <span>₾0</span>
        <span style={{ color: overspent ? T.accent : T.muted }}>
          {overspent
            ? `⚠ Over income by ₾${Math.abs(Math.round(income - spent)).toLocaleString("en-US")}`
            : income > 0
              ? `${Math.round((spent / income) * 100)}% of income used`
              : "spending only"}
        </span>
        <span>₾{Math.round(Math.max(income, spent)).toLocaleString("en-US")}</span>
      </div>
    </div>
  );
}

function CashflowLegend({
  T,
  dot,
  label,
  value,
  muted,
}: {
  T: InkTheme;
  dot: string;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: dot }} />
      <div
        style={{
          fontSize: 10.5,
          color: T.dim,
          fontFamily: T.mono,
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: muted ? T.muted : T.text,
          fontFamily: T.sans,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

interface CreditRow {
  id: string;
  amount: number;
  currency: string;
  counterparty?: string;
  transactionDate: number;
  gelAmount: number | null;
}

function IncomeCard({
  T,
  vpNarrow,
  income,
  credits,
  incomeChange,
  prevMonthShort,
}: {
  T: InkTheme;
  vpNarrow: boolean;
  income: number;
  credits: CreditRow[];
  incomeChange: number | null;
  prevMonthShort: string;
}) {
  // Show up to 5 most-recent deposits in the timeline (oldest → newest in
  // the design; we keep that order so the vertical green-bar opacity ramp
  // reads as "history fills toward today").
  const timeline = [...credits]
    .sort((a, b) => a.transactionDate - b.transactionDate)
    .slice(-5);

  return (
    <Card
      pad="18px 22px"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        borderColor: "rgba(75,217,162,0.25)",
        background: `linear-gradient(180deg, rgba(75,217,162,0.06), ${T.panel})`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              background: "rgba(75,217,162,0.15)",
              color: T.green,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 800,
              fontFamily: T.sans,
            }}
          >
            ↑
          </span>
          <div style={{ fontSize: 12, color: T.green, fontWeight: 700, fontFamily: T.sans }}>Income</div>
        </div>
        {incomeChange !== null && (
          <Pill bg="rgba(75,217,162,0.12)" color={T.green}>
            {incomeChange >= 0 ? "+" : "−"}
            {Math.abs(incomeChange).toFixed(0)}% vs {prevMonthShort}
          </Pill>
        )}
      </div>

      <div
        style={{
          fontSize: vpNarrow ? 26 : 32,
          fontWeight: 800,
          letterSpacing: -1.2,
          lineHeight: 1,
          color: T.text,
          fontFamily: T.sans,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: T.green, opacity: 0.9 }}>+₾</span>
        {Math.round(income).toLocaleString("en-US")}
      </div>

      {timeline.length === 0 ? (
        <div style={{ fontSize: 11, color: T.muted, fontFamily: T.sans, marginTop: 2 }}>
          No incoming transactions this month yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }}>
          {timeline.map((c, i) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: T.sans }}>
              <span
                style={{
                  width: 3,
                  height: 14,
                  borderRadius: 2,
                  background: T.green,
                  opacity: 0.5 + (i / Math.max(1, timeline.length - 1)) * 0.45,
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  color: T.dim,
                  fontFamily: T.mono,
                  minWidth: 46,
                  whiteSpace: "nowrap",
                }}
              >
                {new Date(c.transactionDate)
                  .toLocaleString("en-US", { month: "short", day: "numeric" })
                  .toUpperCase()}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 11,
                  color: T.text,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.counterparty || "Income"}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: T.text,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                ₾{Math.round(c.gelAmount ?? c.amount).toLocaleString("en-US")}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function NetCashflowCard({
  T,
  vpNarrow,
  net,
  income,
  savingsRate,
  monthShortName,
}: {
  T: InkTheme;
  vpNarrow: boolean;
  net: number;
  income: number;
  savingsRate: number;
  monthShortName: string;
}) {
  const positiveNet = net >= 0;
  return (
    <Card pad="18px 22px" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ whiteSpace: "nowrap" }}>
          <CardLabel>Net cashflow · {monthShortName}</CardLabel>
        </span>
        {income > 0 && (
          <Pill
            bg={positiveNet ? "rgba(75,217,162,0.12)" : T.accentSoft}
            color={positiveNet ? T.green : T.accent}
          >
            {savingsRate >= 0 ? "+" : ""}
            {savingsRate.toFixed(0)}% saved
          </Pill>
        )}
      </div>

      <div
        style={{
          fontSize: vpNarrow ? 32 : 40,
          fontWeight: 800,
          letterSpacing: -1.6,
          lineHeight: 1,
          color: T.text,
          fontFamily: T.sans,
          whiteSpace: "nowrap",
        }}
      >
        {positiveNet ? "+₾" : "−₾"}
        {Math.abs(Math.round(net)).toLocaleString("en-US")}
      </div>

      <div style={{ fontSize: 12, color: T.muted, fontFamily: T.sans, lineHeight: 1.5 }}>
        {income === 0
          ? "No income recorded this month."
          : positiveNet
            ? "Unspent income this month."
            : "Spending exceeded income this month."}
      </div>
    </Card>
  );
}
