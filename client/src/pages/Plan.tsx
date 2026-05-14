import { useMemo, useState, useEffect, useRef } from "react";
import { useTheme, type InkTheme } from "../ink/theme";
import { Card, CardTitle, PageHeader, Pill } from "../ink/primitives";
import {
  useMustPayItems,
  useMustPayState,
  useMustPayActions,
  isItemPaid,
  summarizeMustPay,
  computePotMath,
} from "../hooks/useMustPay";
import type { MustPayItem } from "../lib/instant";

const POT_PRESETS = [1500, 2000, 3000, 5000];

export function Plan() {
  const T = useTheme();
  const { items, isLoading } = useMustPayItems();
  const { currentPotGEL } = useMustPayState();
  const { create, update, togglePaid, remove, setCurrentPot } = useMustPayActions();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const summary = useMemo(() => summarizeMustPay(items), [items]);
  const { free, isOverdrawn } = computePotMath(currentPotGEL, summary.pendingTotal, summary.paidTotal);
  // Three percentages for the stacked progress bar. Paid (green) and
  // pending (accent) consume the obligation portion of the pot; the
  // remainder is free.
  const paidPct = currentPotGEL > 0 ? Math.min(100, (summary.paidTotal / currentPotGEL) * 100) : 0;
  const pendingPct = currentPotGEL > 0 ? Math.min(100 - paidPct, (summary.pendingTotal / currentPotGEL) * 100) : 0;
  const freePct = currentPotGEL > 0 ? Math.max(0, (free / currentPotGEL) * 100) : 0;

  // Sort: unpaid first (newest first), paid below (in createdAt desc order).
  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const aPaid = isItemPaid(a);
      const bPaid = isItemPaid(b);
      if (aPaid !== bPaid) return aPaid ? 1 : -1;
      return b.createdAt - a.createdAt;
    });
    return copy;
  }, [items]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap, minHeight: 0 }}>
      <PageHeader
        eyebrow="What's already promised · before you spend"
        title="Must pay"
        ranges={null}
        rightSlot={
          <Pill bg={T.accentSoft} color={T.accent}>
            {summary.pendingCount} unpaid
          </Pill>
        }
      />

      {/* Headline — Free dominates. Three columns split by vertical
          dividers, Free in the middle takes 1.4fr so it visually
          claims the page. */}
      <HeadlineCard
        T={T}
        pot={currentPotGEL}
        pending={summary.pendingTotal}
        paid={summary.paidTotal}
        free={free}
        isOverdrawn={isOverdrawn}
        paidPct={paidPct}
        pendingPct={pendingPct}
        freePct={freePct}
        itemCount={items.length}
        pendingCount={summary.pendingCount}
        paidCount={summary.paidCount}
        onPotChange={setCurrentPot}
      />

      {/* Obligations list */}
      <Card pad="0">
        <div
          style={{
            padding: "14px 20px",
            borderBottom: `1px solid ${T.line}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <CardTitle>Obligations</CardTitle>
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
            style={{
              padding: "7px 13px",
              borderRadius: 9,
              border: "none",
              background: T.accent,
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: T.sans,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Add item
          </button>
        </div>

        {adding && (
          <RowEditor
            T={T}
            initial={{ title: "", amountGEL: NaN }}
            onCancel={() => setAdding(false)}
            onSave={async (v) => {
              await create({ title: v.title, amountGEL: v.amountGEL });
              setAdding(false);
            }}
          />
        )}

        {isLoading ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: T.muted, fontSize: 13, fontFamily: T.sans }}>
            Loading…
          </div>
        ) : items.length === 0 && !adding ? (
          <EmptyState T={T} onAdd={() => setAdding(true)} />
        ) : (
          <div>
            {sorted.map((it, i) =>
              editingId === it.id ? (
                <RowEditor
                  key={it.id}
                  T={T}
                  initial={it}
                  onCancel={() => setEditingId(null)}
                  onSave={async (v) => {
                    await update(it.id, { title: v.title, amountGEL: v.amountGEL });
                    setEditingId(null);
                  }}
                />
              ) : (
                <Row
                  key={it.id}
                  T={T}
                  item={it}
                  isLast={i === sorted.length - 1}
                  onToggle={() => togglePaid(it)}
                  onEdit={() => {
                    setEditingId(it.id);
                    setAdding(false);
                  }}
                  onDelete={() => {
                    if (window.confirm(`Delete "${it.title}"? This cannot be undone.`)) {
                      void remove(it.id);
                    }
                  }}
                />
              )
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Headline card: Pot / Free / Pending in 3 columns ───────────────────────

function HeadlineCard({
  T,
  pot,
  pending,
  paid,
  free,
  isOverdrawn,
  paidPct,
  pendingPct,
  freePct,
  itemCount,
  pendingCount,
  paidCount,
  onPotChange,
}: {
  T: InkTheme;
  pot: number;
  pending: number;
  paid: number;
  free: number;
  isOverdrawn: boolean;
  paidPct: number;
  pendingPct: number;
  freePct: number;
  itemCount: number;
  pendingCount: number;
  paidCount: number;
  onPotChange: (amount: number) => Promise<void>;
}) {
  // The draft string only matters while editing. Initialising it from
  // `pot` at click-time (rather than mirroring pot via useEffect+setState)
  // avoids the react-hooks/set-state-in-effect lint rule and removes a
  // class of stale-closure bugs where an external pot update mid-edit
  // would yank the value out from under the user.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(String(pot));
    setEditing(true);
  };

  const commit = () => {
    const v = parseFloat(draft.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(v) && v >= 0 && v !== pot) {
      void onPotChange(v);
    }
    setEditing(false);
  };

  // Stack on narrow viewports — three columns become a 3-row stack so
  // the headline stays readable on phones and split-pane Macs.
  const isNarrow = typeof window !== "undefined" && window.innerWidth < 760;

  return (
    <Card pad="0" style={{ overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          // Four columns on desktop with Free still 1.4fr so it stays
          // dominant. Narrow viewports stack everything vertically.
          gridTemplateColumns: isNarrow ? "1fr" : "0.95fr 1.4fr 0.85fr 0.85fr",
          alignItems: "stretch",
        }}
      >
        {/* POT — left, editable */}
        <div
          style={{
            padding: "32px 32px",
            borderRight: isNarrow ? "none" : `1px solid ${T.line}`,
            borderBottom: isNarrow ? `1px solid ${T.line}` : "none",
          }}
        >
          <SectionEyebrow T={T}>Pot</SectionEyebrow>
          <SectionSubtitle T={T}>What you have right now</SectionSubtitle>
          <div style={{ marginTop: 20 }}>
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") {
                    setDraft(String(pot));
                    setEditing(false);
                  }
                }}
                inputMode="decimal"
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: T.text,
                  fontFamily: T.sans,
                  fontSize: 44,
                  fontWeight: 700,
                  letterSpacing: -1.6,
                  padding: 0,
                  lineHeight: 1.1,
                }}
              />
            ) : (
              <button
                type="button"
                onClick={startEdit}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "text",
                  fontFamily: T.sans,
                  color: T.text,
                  fontSize: 44,
                  fontWeight: 700,
                  letterSpacing: -1.6,
                  lineHeight: 1.1,
                  textAlign: "left",
                }}
              >
                ₾{pot.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                <span
                  style={{
                    marginLeft: 10,
                    fontSize: 11,
                    color: T.dim,
                    fontFamily: T.mono,
                    fontWeight: 500,
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                    verticalAlign: "middle",
                  }}
                >
                  edit ✎
                </span>
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 16, flexWrap: "wrap" }}>
            {POT_PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => void onPotChange(v)}
                style={{
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: `1px solid ${T.line}`,
                  background: T.panelAlt,
                  color: T.muted,
                  fontSize: 10.5,
                  fontFamily: T.mono,
                  cursor: "pointer",
                }}
              >
                ₾{v.toLocaleString("en-US")}
              </button>
            ))}
          </div>
        </div>

        {/* FREE — middle, dominant. Tinted background plus a blurred
            orb in the corner that picks up the success/warning color
            and gives the cell its visual weight. */}
        <div
          style={{
            padding: "32px 36px",
            background: free >= 0 ? "rgba(75,217,162,0.06)" : T.accentSoft,
            borderRight: isNarrow ? "none" : `1px solid ${T.line}`,
            borderBottom: isNarrow ? `1px solid ${T.line}` : "none",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: -80,
              right: -50,
              width: 220,
              height: 220,
              borderRadius: "50%",
              background: free >= 0 ? T.green : T.accent,
              opacity: 0.18,
              filter: "blur(70px)",
            }}
          />
          <div style={{ position: "relative" }}>
            <div
              style={{
                fontSize: 11,
                color: free >= 0 ? T.green : T.accent,
                fontFamily: T.mono,
                letterSpacing: 1.4,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              {free >= 0 ? "Free to spend" : "Over by"}
            </div>
            <div style={{ fontSize: 11.5, color: T.muted, marginTop: 4, fontFamily: T.sans }}>
              {free >= 0
                ? "Yours after everything promised"
                : `Pending exceeds your pot by ₾${Math.abs(free).toLocaleString("en-US")}`}
            </div>
            <div
              style={{
                marginTop: 16,
                fontFamily: T.sans,
                fontWeight: 700,
                fontSize: "clamp(56px, 7.5vw, 84px)",
                letterSpacing: -3.6,
                lineHeight: 1,
                color: free >= 0 ? T.green : T.accent,
                whiteSpace: "nowrap",
              }}
            >
              {isOverdrawn ? "−" : ""}₾
              {Math.abs(free).toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </div>
            <div style={{ marginTop: 22 }}>
              {/* Stacked bar: green (paid) + accent (pending) + empty
                  (free). Reads left-to-right as a quick breakdown of
                  where the pot is committed. */}
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: T.panelAlt,
                  overflow: "hidden",
                  display: "flex",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${paidPct}%`,
                    background: T.green,
                    transition: "width .3s ease",
                  }}
                />
                <div
                  style={{
                    height: "100%",
                    width: `${pendingPct}%`,
                    background: T.accent,
                    transition: "width .3s ease",
                  }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 7,
                  fontSize: 10.5,
                  color: T.dim,
                  fontFamily: T.mono,
                  letterSpacing: 0.3,
                }}
              >
                <span>{Math.round(paidPct)}% paid · {Math.round(pendingPct)}% pending</span>
                <span>{Math.round(freePct)}% free</span>
              </div>
            </div>
          </div>
        </div>

        {/* PENDING */}
        <div
          style={{
            padding: "32px 28px",
            borderRight: isNarrow ? "none" : `1px solid ${T.line}`,
            borderBottom: isNarrow ? `1px solid ${T.line}` : "none",
          }}
        >
          <SectionEyebrow T={T}>Pending</SectionEyebrow>
          <SectionSubtitle T={T}>Sum of unpaid</SectionSubtitle>
          <div
            style={{
              marginTop: 20,
              fontSize: 38,
              fontWeight: 700,
              color: T.text,
              fontFamily: T.sans,
              letterSpacing: -1.4,
              lineHeight: 1.1,
            }}
          >
            ₾{pending.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </div>
          <div
            style={{
              marginTop: 16,
              fontSize: 11.5,
              color: T.muted,
              fontFamily: T.sans,
              lineHeight: 1.5,
            }}
          >
            {pendingCount} of {itemCount} item{itemCount === 1 ? "" : "s"} still to pay
          </div>
        </div>

        {/* PAID — far right. Tinted faint-green background so the
            green-vs-accent paid/pending split reads at a glance and
            mirrors the green segment in the progress bar above. */}
        <div
          style={{
            padding: "32px 28px",
            background: "rgba(75,217,162,0.04)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: T.green,
              fontFamily: T.mono,
              letterSpacing: 1.2,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Paid
          </div>
          <SectionSubtitle T={T}>Already settled</SectionSubtitle>
          <div
            style={{
              marginTop: 20,
              fontSize: 38,
              fontWeight: 700,
              color: T.green,
              fontFamily: T.sans,
              letterSpacing: -1.4,
              lineHeight: 1.1,
            }}
          >
            ₾{paid.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </div>
          <div
            style={{
              marginTop: 16,
              fontSize: 11.5,
              color: T.muted,
              fontFamily: T.sans,
              lineHeight: 1.5,
            }}
          >
            {paidCount} of {itemCount} item{itemCount === 1 ? "" : "s"} settled
          </div>
        </div>
      </div>
    </Card>
  );
}

function SectionEyebrow({ T, children }: { T: InkTheme; children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: T.dim,
        fontFamily: T.mono,
        letterSpacing: 1.2,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

function SectionSubtitle({ T, children }: { T: InkTheme; children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11.5, color: T.muted, marginTop: 4, fontFamily: T.sans }}>
      {children}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────

function Row({
  T,
  item,
  isLast,
  onToggle,
  onEdit,
  onDelete,
}: {
  T: InkTheme;
  item: MustPayItem;
  isLast: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const paid = isItemPaid(item);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr auto auto",
        gap: 14,
        alignItems: "center",
        padding: "16px 20px",
        borderBottom: isLast ? "none" : `1px solid ${T.line}`,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={paid ? "Mark unpaid" : "Mark paid"}
        style={{
          width: 24,
          height: 24,
          borderRadius: 7,
          background: paid ? T.accent : "transparent",
          border: paid ? `1.5px solid ${T.accent}` : `1.5px solid ${T.lineStrong || T.line}`,
          cursor: "pointer",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background .12s, border-color .12s",
        }}
      >
        {paid && <span style={{ color: "#fff", fontSize: 14, fontWeight: 800, lineHeight: 1 }}>✓</span>}
      </button>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: paid ? T.muted : T.text,
            fontFamily: T.sans,
            textDecoration: paid ? "line-through" : "none",
            textDecorationColor: T.muted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.title}
        </div>
      </div>

      <div
        style={{
          fontSize: 17,
          fontFamily: T.sans,
          fontWeight: 700,
          color: paid ? T.muted : T.text,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: -0.4,
          textDecoration: paid ? "line-through" : "none",
          textDecorationColor: T.muted,
          minWidth: 92,
          textAlign: "right",
        }}
      >
        ₾{item.amountGEL.toLocaleString("en-US", { maximumFractionDigits: 2 })}
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        <button
          type="button"
          onClick={onEdit}
          title="Edit"
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: "transparent",
            border: `1px solid ${T.line}`,
            color: T.muted,
            cursor: "pointer",
            fontSize: 12,
            fontFamily: T.sans,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          ✎
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete"
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: "transparent",
            border: `1px solid ${T.line}`,
            color: T.muted,
            cursor: "pointer",
            fontSize: 14,
            fontFamily: T.sans,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ── Inline editor: name + amount only ─────────────────────────────────────

function RowEditor({
  T,
  initial,
  onSave,
  onCancel,
}: {
  T: InkTheme;
  initial: { title: string; amountGEL: number };
  onSave: (v: { title: string; amountGEL: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [amount, setAmount] = useState(
    Number.isFinite(initial.amountGEL) ? String(initial.amountGEL) : ""
  );
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const parsedAmount = parseFloat(amount);
  const valid = title.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount > 0;

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await onSave({ title: title.trim(), amountGEL: parsedAmount });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr 150px auto",
        gap: 12,
        alignItems: "center",
        padding: "14px 20px",
        background: T.panelAlt,
        borderBottom: `1px solid ${T.line}`,
      }}
    >
      <div style={{ width: 24, height: 24, borderRadius: 7, border: `1.5px dashed ${T.line}` }} />

      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What's owed? — Rent, Loan, Pay back Luka…"
        style={{
          background: T.bg,
          border: `1px solid ${T.line}`,
          color: T.text,
          padding: "10px 12px",
          borderRadius: 8,
          fontSize: 14,
          fontFamily: T.sans,
          outline: "none",
        }}
      />

      <div style={{ position: "relative" }}>
        <span
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: T.muted,
            fontSize: 13,
            fontFamily: T.sans,
            pointerEvents: "none",
          }}
        >
          ₾
        </span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          inputMode="decimal"
          placeholder="0"
          style={{
            width: "100%",
            background: T.bg,
            border: `1px solid ${T.line}`,
            color: T.text,
            padding: "10px 12px 10px 24px",
            borderRadius: 8,
            fontSize: 14,
            fontFamily: T.sans,
            outline: "none",
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "9px 12px",
            borderRadius: 8,
            background: "transparent",
            border: `1px solid ${T.line}`,
            color: T.muted,
            fontSize: 12,
            fontFamily: T.sans,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || submitting}
          style={{
            padding: "9px 14px",
            borderRadius: 8,
            border: "none",
            background: valid && !submitting ? T.accent : T.panelAlt,
            color: valid && !submitting ? "#fff" : T.dim,
            fontSize: 12,
            fontFamily: T.sans,
            fontWeight: 700,
            cursor: valid && !submitting ? "pointer" : "not-allowed",
          }}
        >
          Save ↵
        </button>
      </div>
    </form>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ T, onAdd }: { T: InkTheme; onAdd: () => void }) {
  return (
    <div style={{ padding: "60px 32px", textAlign: "center" }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: T.panelAlt,
          color: T.accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          margin: "0 auto 16px",
          fontFamily: T.sans,
        }}
      >
        ✓
      </div>
      <div style={{ fontSize: 18, fontFamily: T.serif, color: T.text, letterSpacing: -0.5, marginBottom: 8 }}>
        Nothing promised yet.
      </div>
      <div
        style={{
          fontSize: 13,
          color: T.muted,
          fontFamily: T.sans,
          lineHeight: 1.55,
          maxWidth: 320,
          margin: "0 auto",
        }}
      >
        Add what you owe — rent, loans, money to friends — and you'll know at a glance what's really yours to spend.
      </div>
      <button
        type="button"
        onClick={onAdd}
        style={{
          marginTop: 18,
          padding: "10px 18px",
          borderRadius: 10,
          border: "none",
          background: T.accent,
          color: "#fff",
          fontSize: 12.5,
          fontWeight: 700,
          fontFamily: T.sans,
          cursor: "pointer",
        }}
      >
        Add your first item
      </button>
    </div>
  );
}
