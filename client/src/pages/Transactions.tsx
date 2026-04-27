import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTheme, useViewport, type InkTheme } from "../ink/theme";
import { Card, CardLabel, PageHeader } from "../ink/primitives";
import { TxRow, type InkTx } from "../ink/TxRow";
import { CategoryPicker } from "../components/CategoryPicker";
import { useConvertedPayments, useFailedPayments } from "../hooks/useTransactions";
import { useBankSenders } from "../hooks/useBankSenders";
import { useRangeState } from "../hooks/useRangeState";
import { isInRange, isValidIsoDateRange } from "../lib/dateRange";
import { useCategorizer } from "../hooks/useCategorizer";
import { currencySymbol, formatLocalDay, parseLocalDay } from "../ink/format";

type TxKind = "all" | "payment" | "failed";

export function Transactions() {
  const T = useTheme();
  const vp = useViewport();
  const { payments } = useConvertedPayments();
  const { failedPayments } = useFailedPayments();
  const { senders } = useBankSenders();
  const { categorize: categorizeId, allCategories } = useCategorizer();
  // Drill-down search params accepted on first paint. Anything that doesn't
  // match falls through to the unfiltered default — chart drill-downs can
  // freely add params without breaking the page if a future link mistypes
  // a key.
  //   ?category=<id>          — pre-select category filter
  //   ?merchant=<text>        — pre-fill the search box (substring match)
  //   ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
  //                           — switch range to "Custom" with these dates
  const [searchParams] = useSearchParams();
  const initialCat = (() => {
    const raw = searchParams.get("category");
    if (!raw) return "all";
    return allCategories.some((c) => c.id === raw) ? raw : "all";
  })();
  const initialMerchant = searchParams.get("merchant") || "";
  const initialCustom = (() => {
    const start = searchParams.get("dateFrom") || "";
    const end = searchParams.get("dateTo") || "";
    const candidate = { start, end };
    return isValidIsoDateRange(candidate) ? candidate : undefined;
  })();

  const { range, props: rangeProps } = useRangeState("Month", { customInitial: initialCustom });

  const [search, setSearch] = useState(initialMerchant);
  const [bank, setBank] = useState("all");
  const [cat, setCat] = useState(initialCat);
  const [kind, setKind] = useState<TxKind>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const allTx: InkTx[] = useMemo(() => {
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
        category: categorizeId(p.merchant, p.rawMessage),
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
        category: categorizeId(f.merchant, f.rawMessage),
        rawMessage: f.rawMessage,
        failureReason: f.failureReason,
      })),
    ];
    return combined.sort((a, b) => b.transactionDate - a.transactionDate);
  }, [payments, failedPayments, categorizeId]);

  const filtered = useMemo(() => {
    return allTx.filter((t) => {
      if (!isInRange(t.transactionDate, range)) return false;
      if (bank !== "all" && t.bankSenderId !== bank) return false;
      if (cat !== "all" && t.category !== cat) return false;
      if (kind !== "all" && t.kind !== kind) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.merchant.toLowerCase().includes(q) && !(t.rawMessage || "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allTx, bank, cat, kind, search, range]);

  const groups = useMemo(() => {
    const g: Record<string, InkTx[]> = {};
    for (const t of filtered.slice(0, 200)) {
      const key = formatLocalDay(t.transactionDate);
      if (!g[key]) g[key] = [];
      g[key].push(t);
    }
    return g;
  }, [filtered]);

  const dayKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  // Resolve the side panel from `filtered`, not `allTx`. If the active
  // filters no longer contain the selection, drop it so the panel doesn't
  // contradict the visible list.
  const selected = selectedId ? filtered.find((t) => t.id === selectedId) : null;
  useEffect(() => {
    if (selectedId && !filtered.some((t) => t.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

  const bankOptions = senders.length > 0
    ? senders.map((s) => ({ id: s.senderId, name: s.displayName }))
    : Array.from(new Set(allTx.map((t) => t.bankSenderId)).values()).map((id) => ({ id, name: id }));

  const FilterPill = ({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      style={{
        padding: "7px 13px",
        borderRadius: 999,
        border: `1px solid ${active ? T.accent : T.line}`,
        background: active ? T.accentSoft : "transparent",
        color: active ? T.accent : T.muted,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: T.sans,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap, height: "100%" }}>
      <PageHeader
        eyebrow="All transactions · read-only from SMS"
        title="Transactions"
        {...rangeProps}
        rightSlot={
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.dim }}>
            {filtered.length.toLocaleString("en-US")} results
          </span>
        }
      />

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
              placeholder="Search merchant or raw SMS…"
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
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ border: "none", background: "transparent", color: T.dim, cursor: "pointer", fontSize: 14 }}
              >
                ×
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <FilterPill active={kind === "all"} onClick={() => setKind("all")}>All</FilterPill>
            <FilterPill active={kind === "payment"} onClick={() => setKind("payment")}>Successful</FilterPill>
            <FilterPill active={kind === "failed"} onClick={() => setKind("failed")}>Declined</FilterPill>
          </div>
          <div style={{ width: 1, height: 20, background: T.line }} />
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
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
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
            <option value="all">All categories</option>
            {allCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
                No transactions match the filters.
              </div>
            ) : (
              dayKeys.map((key) => {
                const items = groups[key];
                const d = parseLocalDay(key);
                // Day-header total sums every successful payment as a GEL
                // equivalent (NBG rate for the row's date). Declines are
                // skipped — they have no amount. Rows still waiting on a
                // rate (gelAmount === null) are also skipped this render
                // and snap into the total once the fetch resolves.
                const successItems = items.filter((t) => t.kind === "payment");
                const total = successItems.reduce((s, t) => {
                  const p = payments.find((pp) => pp.id === t.id);
                  return s + (p?.gelAmount ?? 0);
                }, 0);
                const hasGelActivity = total > 0;
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
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0, flexShrink: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.sans, whiteSpace: "nowrap" }}>
                          {label}
                        </span>
                        <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, letterSpacing: 0.3, whiteSpace: "nowrap" }}>
                          {items.length} tx
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 12,
                          color: T.muted,
                          fontFamily: T.mono,
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {hasGelActivity ? `−₾${total.toFixed(2)} GEL` : "—"}
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
              <CardLabel>{selected.kind === "failed" ? "Declined payment" : "Payment"}</CardLabel>
              <button
                onClick={() => setSelectedId(null)}
                style={{ border: "none", background: "transparent", color: T.dim, cursor: "pointer", fontSize: 16 }}
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: T.text, fontFamily: T.sans, letterSpacing: -0.8 }}>
              {selected.merchant || "—"}
            </div>
            {selected.rawMerchant && (
              <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginTop: 4 }}>{selected.rawMerchant}</div>
            )}
            <div
              style={{
                marginTop: 18,
                fontSize: 44,
                fontWeight: 800,
                color: selected.kind === "failed" ? T.accent : T.text,
                fontFamily: T.sans,
                letterSpacing: -1.6,
                lineHeight: 1,
              }}
            >
              {selected.kind === "failed"
                ? "—"
                : `${currencySymbol(selected.currency)}${(selected.amount ?? 0).toFixed(2)}`}
            </div>
            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
              <DetailRow T={T} k="When" v={new Date(selected.transactionDate).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} />
              <DetailRow T={T} k="Card" v={selected.cardLastDigits ? `··${selected.cardLastDigits}` : "—"} />
              <DetailRow T={T} k="Bank" v={selected.bankSenderId} />
              <CategoryDetailRow T={T} merchant={selected.merchant} rawMerchant={selected.rawMerchant} />
              {selected.kind === "failed" ? (
                <DetailRow T={T} k="Reason" v={selected.failureReason || "—"} />
              ) : (
                <DetailRow T={T} k="Points" v={selected.plusEarned ? `+${selected.plusEarned}` : "—"} />
              )}
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

function DetailRow({ T, k, v }: { T: InkTheme; k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${T.line}` }}>
      <span style={{ fontSize: 12, color: T.muted, fontFamily: T.sans }}>{k}</span>
      <span style={{ fontSize: 12.5, color: T.text, fontFamily: T.sans, fontWeight: 600 }}>{v}</span>
    </div>
  );
}

/**
 * Special-cased detail-panel row for Category — clicking the value
 * opens the CategoryPicker anchored to this row, with a "+ Create new
 * category" inline option. Persists as a per-merchant override (same
 * model the inline picker uses on the row's category badge).
 */
function CategoryDetailRow({
  T,
  merchant,
  rawMerchant,
}: {
  T: InkTheme;
  merchant: string;
  rawMerchant?: string;
}) {
  const { getCategory } = useCategorizer();
  const [open, setOpen] = useState(false);
  const cat = getCategory(merchant, rawMerchant);
  const pickerMerchant = (merchant || rawMerchant || "").trim();
  const canEdit = pickerMerchant.length > 0;

  return (
    <div style={{ position: "relative", borderBottom: `1px solid ${T.line}`, paddingBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0 0" }}>
        <span style={{ fontSize: 12, color: T.muted, fontFamily: T.sans }}>Category</span>
        <button
          type="button"
          onClick={() => canEdit && setOpen((o) => !o)}
          disabled={!canEdit}
          title={canEdit ? "Change category for all transactions from this merchant" : "Merchant unknown"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 8px",
            border: `1px solid ${T.line}`,
            borderRadius: 8,
            background: open ? T.panelAlt : "transparent",
            color: T.text,
            fontFamily: T.sans,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: canEdit ? "pointer" : "not-allowed",
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 4, background: cat.color }} />
          {cat.name}
          {canEdit && (
            <span style={{ fontSize: 9, color: T.dim, marginLeft: 4 }}>{open ? "▴" : "▾"}</span>
          )}
        </button>
      </div>
      {open && canEdit && (
        <div style={{ position: "absolute", right: 0, top: "100%", zIndex: 50 }}>
          <CategoryPicker
            merchant={pickerMerchant}
            current={cat}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
