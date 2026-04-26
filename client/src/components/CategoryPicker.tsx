// Inline dropdown that lets the user move a transaction's merchant
// into a different category. Persists the choice via the
// useMerchantOverrides hook (writes a row to InstantDB's
// merchantCategoryOverrides table). The choice applies to *every*
// transaction from that merchant — past and future — because the
// override is per-merchant, not per-transaction.

import { useEffect, useRef, useState } from "react";
import { useTheme, type InkTheme } from "../ink/theme";
import { DEFAULT_CATEGORIES, type InkCategory } from "../lib/utils";
import { useMerchantOverrides } from "../hooks/useMerchantOverrides";

export function CategoryPicker({
  merchant,
  current,
  onClose,
}: {
  merchant: string;
  current: InkCategory;
  onClose: () => void;
}) {
  const T = useTheme();
  const ref = useRef<HTMLDivElement | null>(null);
  const { byMerchant, setOverride, clearOverride } = useMerchantOverrides();
  const [busy, setBusy] = useState(false);
  const hasOverride = !!byMerchant.get(merchant.trim().toLowerCase());

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const pick = async (cat: InkCategory) => {
    if (busy) return;
    setBusy(true);
    try {
      await setOverride(merchant, cat.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearOverride(merchant);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 100,
        minWidth: 240,
        background: T.panel,
        border: `1px solid ${T.lineStrong}`,
        borderRadius: 12,
        boxShadow: T.shadow,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <div
        style={{
          padding: "6px 10px 4px",
          fontSize: 10,
          color: T.dim,
          fontFamily: T.mono,
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        Move {merchant} to
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxHeight: 280, overflowY: "auto" }}>
        {DEFAULT_CATEGORIES.map((cat) => (
          <CategoryRow
            key={cat.id}
            T={T}
            cat={cat}
            active={cat.id === current.id}
            onPick={pick}
          />
        ))}
      </div>
      {hasOverride && (
        <button
          onClick={reset}
          disabled={busy}
          style={{
            marginTop: 6,
            padding: "8px 10px",
            background: "transparent",
            border: `1px solid ${T.line}`,
            borderRadius: 8,
            color: T.muted,
            fontSize: 11.5,
            fontFamily: T.sans,
            cursor: busy ? "not-allowed" : "pointer",
            textAlign: "left",
          }}
        >
          Clear override · use the auto category
        </button>
      )}
    </div>
  );
}

function CategoryRow({
  T,
  cat,
  active,
  onPick,
}: {
  T: InkTheme;
  cat: InkCategory;
  active: boolean;
  onPick: (cat: InkCategory) => void;
}) {
  return (
    <button
      onClick={() => onPick(cat)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        background: active ? T.panelAlt : "transparent",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "left",
        color: T.text,
        fontFamily: T.sans,
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = T.panelAlt;
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          background: cat.color,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, fontSize: 13, fontWeight: active ? 700 : 500 }}>{cat.name}</span>
      {active && (
        <span
          style={{
            fontSize: 10,
            color: T.muted,
            fontFamily: T.mono,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          current
        </span>
      )}
    </button>
  );
}
