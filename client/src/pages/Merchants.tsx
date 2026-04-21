import { useMemo, useState } from "react";
import { useTheme, useViewport } from "../ink/theme";
import { Card, PageHeader } from "../ink/primitives";
import { usePayments } from "../hooks/useTransactions";
import { getCategory } from "../lib/utils";
import { isWithinInterval, startOfMonth, endOfMonth, format } from "date-fns";

export function Merchants() {
  const T = useTheme();
  const vp = useViewport();
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const { payments } = usePayments();
  const [search, setSearch] = useState("");

  const merchants = useMemo(() => {
    // One merchant name can have many raw SMS variants (different POS
    // descriptors, different currencies, different cities). Store the
    // first raw message for display, and a union of all raw messages as
    // a lowercased `searchBlob` so a search query that only appears in a
    // later variant still matches.
    type MerchantAgg = {
      merchant: string;
      rawMerchant: string;
      searchBlob: string;
      total: number;
      count: number;
    };
    const map: Record<string, MerchantAgg> = {};
    for (const p of payments) {
      if (p.currency !== "GEL") continue;
      if (!isWithinInterval(new Date(p.transactionDate), { start: monthStart, end: monthEnd })) continue;
      const key = p.merchant || "Unknown";
      const raw = p.rawMessage || "";
      if (!map[key]) {
        map[key] = {
          merchant: key,
          rawMerchant: raw,
          searchBlob: `${key}\n${raw}`.toLowerCase(),
          total: 0,
          count: 0,
        };
      } else if (raw) {
        map[key].searchBlob += `\n${raw.toLowerCase()}`;
      }
      map[key].total += p.amount;
      map[key].count += 1;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [payments, monthStart, monthEnd]);

  const total = merchants.reduce((s, m) => s + m.total, 0);
  const filtered = merchants.filter(
    (m) => !search || m.searchBlob.includes(search.toLowerCase())
  );

  const cols = vp.narrow ? "1fr 80px 120px" : "1fr 140px 120px 100px 100px 120px";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap, height: "100%" }}>
      <PageHeader
        eyebrow={`Who you paid · ${format(now, "MMMM")}`}
        title="Merchants"
        active="Month"
        rightSlot={<span style={{ fontFamily: T.mono, fontSize: 11, color: T.dim }}>{merchants.length} unique</span>}
      />

      <Card pad="16px 18px">
        <div
          style={{
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
            placeholder="Search merchants…"
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
      </Card>

      <Card pad="0" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: cols,
            padding: "14px 24px",
            borderBottom: `1px solid ${T.line}`,
            fontSize: 10,
            color: T.dim,
            fontFamily: T.mono,
            letterSpacing: 0.6,
            textTransform: "uppercase",
          }}
        >
          <span>Merchant</span>
          {!vp.narrow && <span>Category</span>}
          <span style={{ textAlign: "right" }}>Tx</span>
          {!vp.narrow && <span style={{ textAlign: "right" }}>Avg</span>}
          {!vp.narrow && <span style={{ textAlign: "right" }}>Share</span>}
          <span style={{ textAlign: "right" }}>Total</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 12, padding: "40px 0", textAlign: "center" }}>No merchants match.</div>
          ) : (
            filtered.map((m) => {
              const cat = getCategory(m.merchant, m.rawMerchant);
              const pct = (m.total / Math.max(1, total)) * 100;
              return (
                <div
                  key={m.merchant}
                  style={{
                    display: "grid",
                    gridTemplateColumns: cols,
                    padding: "13px 24px",
                    borderBottom: `1px solid ${T.line}`,
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 15,
                        background: `${cat.color}22`,
                        color: cat.color,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: T.sans,
                        fontSize: 12,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {m.merchant.charAt(0)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, fontFamily: T.sans }}>{m.merchant}</div>
                      <div
                        style={{
                          fontSize: 10,
                          color: T.dim,
                          fontFamily: T.mono,
                          letterSpacing: 0.2,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {m.rawMerchant}
                      </div>
                    </div>
                  </div>
                  {!vp.narrow && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 3, background: cat.color }} />
                      <span style={{ fontSize: 12, color: T.muted, fontFamily: T.sans }}>{cat.name}</span>
                    </div>
                  )}
                  <div style={{ textAlign: "right", fontSize: 12, color: T.text, fontFamily: T.mono, fontVariantNumeric: "tabular-nums" }}>
                    ×{m.count}
                  </div>
                  {!vp.narrow && (
                    <div style={{ textAlign: "right", fontSize: 12, color: T.muted, fontFamily: T.mono, fontVariantNumeric: "tabular-nums" }}>
                      ₾{Math.round(m.total / Math.max(1, m.count))}
                    </div>
                  )}
                  {!vp.narrow && (
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          display: "inline-block",
                          width: 56,
                          height: 4,
                          borderRadius: 2,
                          background: T.panelAlt,
                          overflow: "hidden",
                          verticalAlign: "middle",
                          marginRight: 6,
                        }}
                      >
                        <div style={{ width: `${Math.min(100, pct * 4)}%`, height: "100%", background: cat.color }} />
                      </div>
                      <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>{pct.toFixed(1)}%</span>
                    </div>
                  )}
                  <div
                    style={{
                      textAlign: "right",
                      fontSize: 14,
                      color: T.text,
                      fontFamily: T.sans,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    ₾{Math.round(m.total)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
