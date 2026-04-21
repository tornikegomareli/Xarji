import { useTheme, useViewport } from "./theme";
import { Pill } from "./primitives";
import { getCategory } from "../lib/utils";
import { formatTime, currencySymbol } from "./format";

export interface InkTx {
  id: string;
  kind: "payment" | "failed" | "credit";
  merchant: string;
  rawMerchant?: string;
  amount: number | null;
  currency: string;
  cardLastDigits?: string;
  transactionDate: number;
  bankSenderId: string;
  category: string;
  failureReason?: string;
  rawMessage?: string;
  plusEarned?: number;
  counterparty?: string;
}

export function TxRow({
  t,
  isLast,
  compact,
  onClick,
}: {
  t: InkTx;
  isLast?: boolean;
  compact?: boolean;
  onClick?: () => void;
}) {
  const T = useTheme();
  const vp = useViewport();
  const cat = getCategory(t.merchant, t.rawMerchant);
  const failed = t.kind === "failed";
  const credit = t.kind === "credit";
  const pad = compact ? "10px 0" : T.density.rowPad;
  const isFx = (t.kind === "payment" || t.kind === "credit") && t.currency !== "GEL";
  const cols = vp.narrow ? "32px 1fr 90px" : "36px 1fr 110px 110px 90px";
  const symbol = currencySymbol(t.currency);

  return (
    <div
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: cols,
        gap: 14,
        padding: pad,
        borderBottom: isLast ? "none" : `1px solid ${T.line}`,
        alignItems: "center",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          background: credit
            ? "rgba(75,217,162,0.18)"
            : failed
            ? T.accentSoft
            : cat
            ? `${cat.color}22`
            : T.panelAlt,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: T.sans,
          fontSize: 12,
          fontWeight: 700,
          color: credit ? T.green : failed ? T.accent : cat?.color || T.text,
        }}
      >
        {credit ? "↓" : (t.merchant || "?").charAt(0)}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: T.sans,
            fontSize: 13.5,
            fontWeight: 600,
            color: failed ? T.accent : credit ? T.text : T.text,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: vp.narrow ? 180 : 240 }}>
            {t.merchant || t.counterparty || "—"}
          </span>
          {failed && <Pill>Declined</Pill>}
          {credit && <Pill bg="rgba(75,217,162,0.15)" color={T.green}>Income</Pill>}
          {isFx && <Pill bg={T.panelAlt} color={T.muted}>{t.currency}</Pill>}
        </div>
        <div
          style={{
            fontFamily: T.mono,
            fontSize: 10.5,
            color: T.dim,
            marginTop: 2,
            letterSpacing: 0.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formatTime(t.transactionDate)}
          {vp.narrow
            ? ` · ${cat?.name || "Other"}`
            : ` · ·${t.cardLastDigits || "—"} · ${t.bankSenderId}`}
          {failed && t.failureReason ? ` · ${t.failureReason}` : ""}
        </div>
      </div>
      {!vp.narrow && (
        <div style={{ fontFamily: T.sans, fontSize: 12, color: T.muted, fontWeight: 500 }}>
          {credit ? "Income" : cat?.name}
        </div>
      )}
      {!vp.narrow && (
        <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: 0.3 }}>
          {new Date(t.transactionDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </div>
      )}
      <div style={{ textAlign: "right" }}>
        {failed ? (
          <span style={{ fontFamily: T.sans, fontSize: 15, color: T.accent, fontWeight: 600 }}>—</span>
        ) : (
          <span
            style={{
              fontFamily: T.sans,
              fontSize: 15,
              color: credit ? T.green : T.text,
              fontWeight: 700,
              letterSpacing: -0.2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {credit ? "+" : "−"}
            {symbol}
            {(t.amount ?? 0).toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
