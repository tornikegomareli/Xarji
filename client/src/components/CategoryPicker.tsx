// Inline dropdown that lets the user move a transaction's merchant
// into a different category. Persists the choice via the
// useMerchantOverrides hook (writes a row to InstantDB's
// merchantCategoryOverrides table). The choice applies to *every*
// transaction from that merchant — past and future — because the
// override is per-merchant, not per-transaction.

import { useEffect, useRef, useState } from "react";
import { useTheme, type InkTheme } from "../ink/theme";
import { type InkCategory } from "../lib/utils";
import { useMerchantOverrides } from "../hooks/useMerchantOverrides";
import { useCategorizer } from "../hooks/useCategorizer";
import { useCategoryActions } from "../hooks/useCategories";
import { pickCategoryDefaults } from "../lib/categoryDefaults";

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
  const { allCategories } = useCategorizer();
  const { addCategory } = useCategoryActions();
  const [busy, setBusy] = useState(false);
  // "creating mode" — user clicked "+ New category" and we render the
  // inline name input instead of the category list. Keeps the picker
  // self-contained: no modal, no separate component, no navigation
  // away from the row the user is editing.
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const draftInputRef = useRef<HTMLInputElement | null>(null);

  const hasOverride = !!byMerchant.get(merchant.trim().toLowerCase());

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
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
    };
  }, [onClose, creating]);

  // Auto-focus the draft input when entering creating mode so the user
  // can type the category name without an extra click.
  useEffect(() => {
    if (creating) draftInputRef.current?.focus();
  }, [creating]);

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
      // Apply the new category as the merchant's override immediately
      // — that's what the user clicked in for, otherwise they'd have
      // to do a second pick after creating.
      await setOverride(merchant, newId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
        minWidth: 260,
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
          <div style={{ display: "flex", flexDirection: "column", maxHeight: 280, overflowY: "auto" }}>
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
