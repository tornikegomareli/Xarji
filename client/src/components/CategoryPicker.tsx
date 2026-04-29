import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTheme, type InkTheme } from "../ink/theme";
import { type InkCategory } from "../lib/utils";
import { useMerchantOverrides } from "../hooks/useMerchantOverrides";
import { useTransactionOverrides } from "../hooks/useTransactionOverrides";
import { useCategorizer } from "../hooks/useCategorizer";
import { useCategoryActions } from "../hooks/useCategories";
import { pickCategoryDefaults } from "../lib/categoryDefaults";

export function CategoryPicker({
  merchant,
  current,
  onClose,
  anchor = "left",
  paymentId,
}: {
  merchant: string;
  current: InkCategory;
  onClose: () => void;
  /** Which side of the trigger the picker aligns to. "left" (default)
   *  matches the inline use on TxRow's category badge; "right" is for
   *  the Transactions detail panel where the trigger is on the right
   *  edge of a narrow column and a left-anchored picker would clip
   *  off-screen. */
  anchor?: "left" | "right";
  /** When provided, the picker offers a scope toggle: "This transaction"
   *  (per-transaction override) vs "All [merchant]" (per-merchant override).
   *  Defaults to transaction scope when set. Omit for merchant-only behaviour. */
  paymentId?: string;
}) {
  const T = useTheme();
  const ref = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number; maxHeight: number } | null>(null);
  const { byMerchant, setOverride: setMerchantOverride, clearOverride: clearMerchantOverride } = useMerchantOverrides();
  const { byPaymentId, setOverride: setTxOverride, clearOverride: clearTxOverride } = useTransactionOverrides();
  const { allCategories } = useCategorizer();
  const { addCategory } = useCategoryActions();
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"transaction" | "merchant">(
    paymentId ? "transaction" : "merchant"
  );
  // "creating mode" — user clicked "+ New category" and we render the
  // inline name input instead of the category list. Keeps the picker
  // self-contained: no modal, no separate component, no navigation
  // away from the row the user is editing.
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const draftInputRef = useRef<HTMLInputElement | null>(null);

  const hasOverride =
    scope === "transaction"
      ? !!paymentId && !!byPaymentId.get(paymentId)
      : !!byMerchant.get(merchant.trim().toLowerCase());

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    // Scroll-to-dismiss is for *page* scroll (the picker is positioned
    // against absolute viewport coords, so a scrolled background would
    // strand the dropdown). When the picker's own category list overflows
    // and the user scrolls that list, the event target is inside the
    // portal — keep the picker open in that case so lower options stay
    // reachable. (Codex P2 on PR #38.)
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && ref.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (creating) {
          // First Escape exits create mode; second Escape closes the picker.
          setCreating(false);
          setDraftName("");
          setError(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [onClose, creating]);

  // Auto-focus the draft input when entering creating mode so the user
  // can type the category name without an extra click.
  useEffect(() => {
    if (creating) draftInputRef.current?.focus();
  }, [creating]);

  // Compute fixed position from the trigger's bounding rect so the
  // portal dropdown renders below the badge regardless of scroll
  // containers or Card's overflow: hidden.
  useLayoutEffect(() => {
    const parent = anchorRef.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const margin = 12;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const flipUp = spaceBelow < 320 && spaceAbove > spaceBelow;
    const hPos = anchor === "right"
      ? { right: window.innerWidth - rect.right }
      : { left: rect.left };
    if (flipUp) {
      setDropdownPos({ ...hPos, bottom: window.innerHeight - rect.top + 6, maxHeight: spaceAbove });
    } else {
      setDropdownPos({ ...hPos, top: rect.bottom + 6, maxHeight: spaceBelow });
    }
  }, [anchor]);

  const pick = async (cat: InkCategory) => {
    if (busy) return;
    setBusy(true);
    try {
      if (scope === "transaction" && paymentId) {
        await setTxOverride(paymentId, cat.id);
      } else {
        await setMerchantOverride(merchant, cat.id);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (scope === "transaction" && paymentId) {
        await clearTxOverride(paymentId);
      } else {
        await clearMerchantOverride(merchant);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const submitNew = async () => {
    const name = draftName.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    // Case-insensitive duplicate check against the merged live category
    // list (DEFAULT_CATEGORIES + DB rows). Mirrors the AI tool's
    // duplicate handling so the user gets the same constraint
    // regardless of which channel they came from.
    const existing = allCategories.find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      setError(`"${existing.name}" already exists.`);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const defaults = pickCategoryDefaults(name);
      const newId = await addCategory({
        name,
        color: defaults.color,
        icon: defaults.icon,
        isDefault: false,
      });
      if (scope === "transaction" && paymentId) {
        await setTxOverride(paymentId, newId);
      } else {
        await setMerchantOverride(merchant, newId);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dropdown = dropdownPos && (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: dropdownPos.top,
        bottom: dropdownPos.bottom,
        left: dropdownPos.left,
        right: dropdownPos.right,
        zIndex: 1000,
        minWidth: 300,
        maxHeight: dropdownPos.maxHeight,
        background: T.panel,
        border: `1px solid ${T.lineStrong}`,
        borderRadius: 12,
        boxShadow: T.shadow,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        overflow: "hidden",
      }}
    >
      {creating ? (
        <div style={{ padding: 4, display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 10,
              color: T.dim,
              fontFamily: T.mono,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              padding: "0 6px",
            }}
          >
            New category for {merchant}
          </div>
          <input
            ref={draftInputRef}
            value={draftName}
            onChange={(e) => {
              setDraftName(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                submitNew();
              }
            }}
            placeholder="e.g. Coffee shops"
            disabled={busy}
            style={{
              padding: "8px 12px",
              background: T.panelAlt,
              border: `1px solid ${T.line}`,
              borderRadius: 8,
              color: T.text,
              fontSize: 13,
              fontFamily: T.sans,
              outline: "none",
            }}
          />
          {error && (
            <div
              style={{
                fontSize: 11,
                color: T.accent,
                fontFamily: T.sans,
                padding: "0 6px",
              }}
            >
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
            <button
              onClick={submitNew}
              disabled={busy || !draftName.trim()}
              style={{
                flex: 1,
                padding: "8px 12px",
                background: busy || !draftName.trim() ? T.panelAlt : T.accent,
                color: busy || !draftName.trim() ? T.dim : "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: T.sans,
                cursor: busy || !draftName.trim() ? "not-allowed" : "pointer",
              }}
            >
              {busy ? "Creating…" : "Create + apply"}
            </button>
            <button
              onClick={() => {
                setCreating(false);
                setDraftName("");
                setError(null);
              }}
              disabled={busy}
              style={{
                padding: "8px 12px",
                background: "transparent",
                color: T.muted,
                border: `1px solid ${T.line}`,
                borderRadius: 8,
                fontSize: 12,
                fontFamily: T.sans,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
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
          {paymentId && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                padding: "2px 4px 4px",
                background: T.panelAlt,
                borderRadius: 8,
                margin: "0 4px 2px",
              }}
            >
              <ScopeBtn T={T} label="Just this one" active={scope === "transaction"} onClick={() => setScope("transaction")} />
              <ScopeBtn T={T} label={`All ${merchant.slice(0, 10)}${merchant.length > 10 ? "…" : ""} transactions`} active={scope === "merchant"} onClick={() => setScope("merchant")} />
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflowY: "auto", minHeight: 0, overscrollBehavior: "contain" }}>
            {allCategories.map((cat) => (
              <CategoryRow
                key={cat.id}
                T={T}
                cat={cat}
                active={cat.id === current.id}
                onPick={pick}
              />
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            <button
              onClick={() => setCreating(true)}
              disabled={busy}
              style={{
                padding: "8px 10px",
                background: "transparent",
                border: `1px solid ${T.line}`,
                borderRadius: 8,
                color: T.text,
                fontSize: 11.5,
                fontFamily: T.sans,
                cursor: busy ? "not-allowed" : "pointer",
                textAlign: "left",
              }}
            >
              + New category…
            </button>
            {hasOverride && (
              <button
                onClick={reset}
                disabled={busy}
                style={{
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
        </>
      )}
    </div>
  );

  return (
    <>
      <span ref={anchorRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      {createPortal(dropdown, document.body)}
    </>
  );
}

function ScopeBtn({
  T,
  label,
  active,
  onClick,
}: {
  T: InkTheme;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "5px 8px",
        borderRadius: 6,
        border: "none",
        background: active ? T.panel : "transparent",
        color: active ? T.text : T.muted,
        fontSize: 11,
        fontFamily: T.sans,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        whiteSpace: "nowrap",
        minWidth: 0,
      }}
    >
      {label}
    </button>
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
