import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme, useViewport } from "../ink/theme";
import { Card, CardLabel, CardTitle, LinkBtn, PageHeader } from "../ink/primitives";
import { AreaChart, Donut, HBar } from "../ink/charts";
import { TxRow, type InkTx } from "../ink/TxRow";
import { usePayments } from "../hooks/useTransactions";
import { useMonthlyTrend } from "../hooks/useMonthlyTrend";
import { DEFAULT_CATEGORIES, categorizeId, getCategory, type InkCategory } from "../lib/utils";
import { formatCompact, monthKey } from "../ink/format";
import { isWithinInterval, startOfMonth, endOfMonth, format } from "date-fns";

interface CatAgg {
  cat: string;
  total: number;
  count: number;
  meta: InkCategory;
}

export function Categories() {
  const T = useTheme();
  const vp = useViewport();
  const navigate = useNavigate();
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const { payments } = usePayments();
  const trend = useMonthlyTrend(6);
  const [range, setRange] = useState("Month");

  const inMonth = (ts: number) => isWithinInterval(new Date(ts), { start: monthStart, end: monthEnd });

  const monthPayments = useMemo(
    () => payments.filter((p) => inMonth(p.transactionDate) && p.currency === "GEL"),
    [payments]
  );

  const cats: CatAgg[] = useMemo(() => {
    const map: Record<string, CatAgg> = {};
    for (const p of monthPayments) {
      const cat = getCategory(p.merchant, p.rawMessage);
      if (!map[cat.id]) map[cat.id] = { cat: cat.id, total: 0, count: 0, meta: cat };
      map[cat.id].total += p.amount;
      map[cat.id].count += 1;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [monthPayments]);

  const total = cats.reduce((s, c) => s + c.total, 0);
  const [selected, setSelected] = useState<string | null>(null);

  const selectedId = selected || cats[0]?.cat;
  const selCat = DEFAULT_CATEGORIES.find((c) => c.id === selectedId);
  const selData = cats.find((c) => c.cat === selectedId);

  const catTrend = useMemo(() => {
    const keys = trend.map((m) => m.key);
    const perCat: Record<string, { key: string; value: number }[]> = {};
    for (const c of DEFAULT_CATEGORIES) {
      perCat[c.id] = keys.map((k) => ({ key: k, value: 0 }));
    }
    for (const p of payments) {
      if (p.currency !== "GEL") continue;
      const k = monthKey(p.transactionDate);
      const idx = keys.indexOf(k);
      if (idx === -1) continue;
      const catId = categorizeId(p.merchant, p.rawMessage);
      if (perCat[catId]) perCat[catId][idx].value += p.amount;
    }
    return { keys, perCat, labels: trend.map((m) => m.label.slice(0, 3)) };
  }, [payments, trend]);

  const selMerchants = useMemo(() => {
    const map: Record<string, { merchant: string; total: number; count: number }> = {};
    for (const p of monthPayments) {
      const cid = categorizeId(p.merchant, p.rawMessage);
      if (cid !== selectedId) continue;
      const m = p.merchant || "Unknown";
      if (!map[m]) map[m] = { merchant: m, total: 0, count: 0 };
      map[m].total += p.amount;
      map[m].count += 1;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [monthPayments, selectedId]);

  const selTx: InkTx[] = useMemo(() => {
    return monthPayments
      .filter((p) => categorizeId(p.merchant, p.rawMessage) === selectedId)
      .slice(0, 20)
      .map((p) => ({
        id: p.id,
        kind: "payment" as const,
        merchant: p.merchant || "",
        rawMerchant: p.rawMessage,
        amount: p.amount,
        currency: p.currency,
        cardLastDigits: p.cardLastDigits,
        transactionDate: p.transactionDate,
        bankSenderId: p.bankSenderId,
        category: selectedId || "",
        rawMessage: p.rawMessage,
      }));
  }, [monthPayments, selectedId]);

  const eyebrow = `Where your money went · ${format(now, "MMMM")}`;

  if (cats.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap }}>
        <PageHeader eyebrow={eyebrow} title="Categories" active={range} onRange={setRange} />
        <Card>
          <div style={{ color: T.muted, fontSize: 13, padding: "40px 0", textAlign: "center", fontFamily: T.sans }}>
            No transactions in {format(now, "MMMM")} yet.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap, height: "100%" }}>
      <PageHeader eyebrow={eyebrow} title="Categories" active={range} onRange={setRange} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: vp.veryNarrow ? "1fr" : "320px 1fr",
          gap: T.density.gap,
          flex: 1,
          minHeight: 0,
        }}
      >
        <Card pad="24px 24px" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <Donut
              segments={cats.map((c) => ({ value: c.total, color: c.meta.color }))}
              size={220}
              thickness={30}
              gap={4}
              centerLabel={format(now, "MMM").toUpperCase()}
              centerValue={"₾" + formatCompact(total)}
              centerColor={T.text}
              labelFont={T.sans}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
            {cats.map((c) => {
              const pct = (c.total / total) * 100;
              const active = c.cat === selectedId;
              return (
                <button
                  key={c.cat}
                  onClick={() => setSelected(c.cat)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    border: "none",
                    cursor: "pointer",
                    borderRadius: 10,
                    background: active ? T.panelAlt : "transparent",
                    textAlign: "left",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: c.meta.color }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: active ? 700 : 500, color: T.text, fontFamily: T.sans }}>
                    {c.meta.name}
                  </span>
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, fontVariantNumeric: "tabular-nums" }}>
                    {pct.toFixed(0)}%
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: T.text,
                      fontFamily: T.sans,
                      minWidth: 62,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    ₾{Math.round(c.total)}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap, minHeight: 0 }}>
          <Card pad="24px 26px">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 20,
                flexWrap: vp.narrow ? "wrap" : "nowrap",
              }}
            >
              <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: selCat?.color }} />
                  <CardLabel>{selCat?.name}</CardLabel>
                </div>
                <div
                  style={{
                    fontSize: vp.narrow ? 38 : 48,
                    fontWeight: 700,
                    color: T.text,
                    fontFamily: T.sans,
                    letterSpacing: -2,
                    marginTop: 8,
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ color: selCat?.color }}>₾</span>
                  {Math.round(selData?.total || 0).toLocaleString("en-US")}
                  <span style={{ fontSize: "0.46em", color: T.muted }}>
                    .{(selData?.total || 0).toFixed(2).split(".")[1]}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: T.muted, marginTop: 4, fontFamily: T.sans }}>
                  {(((selData?.total || 0) / Math.max(1, total)) * 100).toFixed(1)}% of this month · {selMerchants.length} merchants · {selTx.length} transactions
                </div>
              </div>
              {T.chartsVisible && selectedId && catTrend.perCat[selectedId] && (
                <div style={{ flexShrink: 0, width: vp.narrow ? "100%" : "auto" }}>
                  <AreaChart
                    data={catTrend.perCat[selectedId].map((d, i) => ({ label: catTrend.labels[i], value: d.value }))}
                    width={vp.narrow ? 520 : 320}
                    height={96}
                    stroke={selCat?.color || T.accent}
                    fill={`${selCat?.color || T.accent}33`}
                    strokeWidth={2}
                    showGrid={false}
                    showAxes={false}
                    cornerRadius={10}
                    padding={{ top: 8, right: 4, bottom: 22, left: 4 }}
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
                    {catTrend.labels.map((l, i) => (
                      <span key={i}>{l.toUpperCase()}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: vp.narrow ? "1fr" : "1fr 1fr",
              gap: T.density.gap,
              flex: 1,
              minHeight: 0,
            }}
          >
            <Card pad="20px 22px" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <CardTitle>Merchants</CardTitle>
                <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>{selMerchants.length} total</span>
              </div>
              <div style={{ overflowY: "auto", flex: 1 }}>
                {selMerchants.slice(0, 10).map((m) => {
                  const maxT = selMerchants[0]?.total || 1;
                  return (
                    <div key={m.merchant} style={{ padding: "10px 0", borderBottom: `1px solid ${T.line}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 12, alignItems: "baseline" }}>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: T.text,
                            fontFamily: T.sans,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {m.merchant}
                        </span>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: T.text,
                            fontFamily: T.sans,
                            fontVariantNumeric: "tabular-nums",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          ₾{Math.round(m.total)}
                        </span>
                      </div>
                      <HBar fraction={m.total / maxT} color={selCat?.color || T.accent} bgColor={T.panelAlt} height={4} />
                      <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, marginTop: 4 }}>
                        ×{m.count} · avg ₾{Math.round(m.total / Math.max(1, m.count))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card pad="20px 22px" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <CardTitle>Recent in {selCat?.name}</CardTitle>
                <LinkBtn
                  onClick={() =>
                    selectedId &&
                    navigate(`/transactions?category=${encodeURIComponent(selectedId)}`)
                  }
                >
                  All →
                </LinkBtn>
              </div>
              <div style={{ overflowY: "auto", flex: 1 }}>
                {selTx.length === 0 ? (
                  <div style={{ color: T.muted, fontSize: 12, padding: "20px 0" }}>Nothing this month.</div>
                ) : (
                  selTx.map((t, i) => <TxRow key={t.id} t={t} isLast={i === selTx.length - 1} />)
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
