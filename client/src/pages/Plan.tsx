import { useMemo, useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { useTheme, type InkTheme } from "../ink/theme";
import { Card, CardLabel, PageHeader, Pill } from "../ink/primitives";
import {
  useMustPayItems,
  useMustPayState,
  useMustPayActions,
  isItemPaidThisCycle,
  summarizeMustPay,
  computePotMath,
} from "../hooks/useMustPay";
import { useBudgetPlan } from "../hooks/useBudgets";
import type { MustPayItem } from "../lib/instant";

export function Plan() {
  const T = useTheme();
  const now = new Date();
  const { items, isLoading } = useMustPayItems();
  const { currentPotGEL } = useMustPayState();
  const { create, update, togglePaid, remove, setCurrentPot } = useMustPayActions();
  // useBudgetPlan already resolves the auto-derive fallback when no
  // stored row exists for the current month, so we get a single
  // canonical expectedIncome number to compare obligations against.
  const { expectedIncome: rawExpectedIncome } = useBudgetPlan();

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const summary = useMemo(() => summarizeMustPay(items, now), [items, now]);
  const { free, isOverdrawn } = computePotMath(currentPotGEL, summary.pendingTotal);

  // Sort: unpaid first (by dueDate asc if present, else createdAt desc),
  // paid below in createdAt desc order. Single sort with a composite key.
  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const aPaid = isItemPaidThisCycle(a, now);
      const bPaid = isItemPaidThisCycle(b, now);
      if (aPaid !== bPaid) return aPaid ? 1 : -1;
      if (!aPaid) {
        // Both pending — due date asc wins, otherwise newest first.
        if (a.dueDate != null && b.dueDate != null) return a.dueDate - b.dueDate;
        if (a.dueDate != null) return -1;
        if (b.dueDate != null) return 1;
      }
      return b.createdAt - a.createdAt;
    });
    return copy;
  }, [items, now]);

  // Hide the comparison line entirely when no number is available
  // (fresh install with no prior income history) so we don't render
  // "vs ₾0".
  const expectedIncome = rawExpectedIncome > 0 ? rawExpectedIncome : null;

  const eyebrow = `Plan what you owe · ${format(now, "MMMM")}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap }}>
      <PageHeader
        eyebrow={eyebrow}
        title="Must Pay"
        ranges={null}
        rightSlot={
          summary.pendingCount > 0 ? (
            <Pill bg={T.accentSoft} color={T.accent}>
              {summary.pendingCount} pending
            </Pill>
          ) : (
            <Pill bg={T.panelAlt} color={T.dim}>
              All clear
            </Pill>
          )
        }
      />

      <HeadlineCard
        T={T}
        currentPotGEL={currentPotGEL}
        pendingTotal={summary.pendingTotal}
        free={free}
        isOverdrawn={isOverdrawn}
        expectedIncome={expectedIncome}
        onPotChange={setCurrentPot}
      />

      <Card pad="20px 22px" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {isLoading ? (
          <div style={{ color: T.muted, fontSize: 13, padding: "20px 0", fontFamily: T.sans }}>Loading…</div>
        ) : items.length === 0 && !creating ? (
          <div style={{ color: T.muted, fontSize: 13, padding: "20px 0", fontFamily: T.sans }}>
            Nothing to pay yet. Click below to add your first obligation.
          </div>
        ) : (
          sorted.map((it) => {
            const isEditing = editingId === it.id;
            if (isEditing) {
              return (
                <ItemForm
                  key={it.id}
                  T={T}
                  initial={it}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (input) => {
                    await update(it.id, input);
                    setEditingId(null);
                  }}
                  submitLabel="Save"
                />
              );
            }
            return (
              <ItemRow
                key={it.id}
                T={T}
                item={it}
                now={now}
                onToggle={() => togglePaid(it)}
                onEdit={() => {
                  setEditingId(it.id);
                  setCreating(false);
                }}
                onDelete={() => {
                  if (window.confirm(`Delete "${it.title}"? This cannot be undone.`)) {
                    void remove(it.id);
                  }
                }}
              />
            );
          })
        )}

        {creating ? (
          <ItemForm
            T={T}
            onCancel={() => setCreating(false)}
            onSubmit={async (input) => {
              await create(input);
              setCreating(false);
            }}
            submitLabel="Add"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
            style={{
              marginTop: 8,
              padding: "10px 12px",
              background: "transparent",
              border: `1px dashed ${T.line}`,
              borderRadius: 10,
              color: T.muted,
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: T.sans,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            + Add obligation…
          </button>
        )}
      </Card>
    </div>
  );
}

// ── Headline card: Pot / Pending / Free with optional income compare ──────

function HeadlineCard({
  T,
  currentPotGEL,
  pendingTotal,
  free,
  isOverdrawn,
  expectedIncome,
  onPotChange,
}: {
  T: InkTheme;
  currentPotGEL: number;
  pendingTotal: number;
  free: number;
  isOverdrawn: boolean;
  expectedIncome: number | null;
  onPotChange: (amount: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string>(String(currentPotGEL));
  const [focused, setFocused] = useState(false);

  // Keep the input in sync when an external write updates the pot
  // (e.g. demo seed loads, or another tab updates the singleton). The
  // user's in-flight edit takes priority — we only re-sync when they're
  // not focused so we don't yank the value out from under them.
  useEffect(() => {
    if (!focused) setDraft(String(currentPotGEL));
  }, [currentPotGEL, focused]);

  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed !== currentPotGEL) {
      void onPotChange(parsed);
    } else {
      // Invalid / unchanged — revert the input to the persisted value.
      setDraft(String(currentPotGEL));
    }
  };

  const leftoverAfterObligations =
    expectedIncome != null ? expectedIncome - pendingTotal : null;

  return (
    <Card pad="24px 28px" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 24,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <CardLabel>Current pot</CardLabel>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ fontSize: 32, fontWeight: 800, color: T.text, fontFamily: T.sans }}>₾</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                commit();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.currentTarget as HTMLInputElement).blur();
                } else if (e.key === "Escape") {
                  setDraft(String(currentPotGEL));
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              style={{
                fontSize: 32,
                fontWeight: 800,
                letterSpacing: -1.2,
                color: T.text,
                fontFamily: T.sans,
                background: "transparent",
                border: "none",
                outline: "none",
                padding: 0,
                width: "100%",
                minWidth: 0,
                fontVariantNumeric: "tabular-nums",
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.sans }}>
            What's in your wallet right now
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <CardLabel>Pending</CardLabel>
          <div
            style={{
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: -1.2,
              color: T.text,
              fontFamily: T.sans,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            ₾{Math.round(pendingTotal).toLocaleString("en-US")}
          </div>
          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.sans }}>
            Things still to pay
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <CardLabel>Free</CardLabel>
          <div
            style={{
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: -1.2,
              color: isOverdrawn ? T.accent : T.green,
              fontFamily: T.sans,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {isOverdrawn ? "−" : ""}₾{Math.abs(Math.round(free)).toLocaleString("en-US")}
          </div>
          <div style={{ fontSize: 11, color: isOverdrawn ? T.accent : T.dim, fontFamily: T.sans }}>
            {isOverdrawn
              ? `Over by ₾${Math.abs(Math.round(free)).toLocaleString("en-US")}`
              : "Pot minus obligations"}
          </div>
        </div>
      </div>

      {expectedIncome != null && leftoverAfterObligations != null && (
        <div
          style={{
            fontSize: 12,
            color: T.muted,
            fontFamily: T.sans,
            paddingTop: 10,
            borderTop: `1px solid ${T.line}`,
          }}
        >
          vs ₾{Math.round(expectedIncome).toLocaleString("en-US")} typical income ·{" "}
          <span style={{ color: leftoverAfterObligations < 0 ? T.accent : T.text, fontWeight: 700 }}>
            ₾{Math.abs(Math.round(leftoverAfterObligations)).toLocaleString("en-US")}
            {leftoverAfterObligations < 0 ? " short" : " leftover"}
          </span>{" "}
          after obligations
        </div>
      )}
    </Card>
  );
}

// ── Single row ─────────────────────────────────────────────────────────────

function ItemRow({
  T,
  item,
  now,
  onToggle,
  onEdit,
  onDelete,
}: {
  T: InkTheme;
  item: MustPayItem;
  now: Date;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const paid = isItemPaidThisCycle(item, now);
  const overdue = !paid && item.dueDate != null && item.dueDate < now.getTime();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 12px",
        borderRadius: 10,
        opacity: paid ? 0.45 : 1,
        transition: "opacity 120ms ease-out",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        title={paid ? "Mark unpaid" : "Mark paid"}
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          border: `1.5px solid ${paid ? T.green : T.line}`,
          background: paid ? T.green : "transparent",
          color: "#fff",
          fontSize: 13,
          lineHeight: 1,
          cursor: "pointer",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {paid ? "✓" : ""}
      </button>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: T.text,
            fontFamily: T.sans,
            textDecoration: paid ? "line-through" : "none",
          }}
        >
          {item.title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {item.isRecurring && (
            <span style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>↻ monthly</span>
          )}
          {item.dueDate != null && (
            <span style={{ fontSize: 10, color: overdue ? T.accent : T.dim, fontFamily: T.mono, fontWeight: overdue ? 700 : 400 }}>
              {overdue ? "OVERDUE · " : "due "}
              {format(new Date(item.dueDate), "MMM d")}
            </span>
          )}
          {item.notes && (
            <span style={{ fontSize: 11, color: T.muted, fontFamily: T.sans }}>{item.notes}</span>
          )}
        </div>
      </div>

      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: T.text,
          fontFamily: T.sans,
          minWidth: 70,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          textDecoration: paid ? "line-through" : "none",
        }}
      >
        ₾{Math.round(item.amountGEL).toLocaleString("en-US")}
      </span>

      <button
        type="button"
        title="Edit"
        onClick={onEdit}
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          border: `1px solid ${T.line}`,
          background: "transparent",
          color: T.dim,
          fontSize: 11,
          lineHeight: 1,
          cursor: "pointer",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ✎
      </button>
      <button
        type="button"
        title="Delete"
        onClick={onDelete}
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          border: `1px solid ${T.line}`,
          background: "transparent",
          color: T.dim,
          fontSize: 12,
          lineHeight: 1,
          cursor: "pointer",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ×
      </button>
    </div>
  );
}

// ── Inline create/edit form ───────────────────────────────────────────────

function ItemForm({
  T,
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  T: InkTheme;
  initial?: Partial<MustPayItem>;
  onSubmit: (input: {
    title: string;
    amountGEL: number;
    isRecurring: boolean;
    notes?: string;
    dueDate?: number;
  }) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [amount, setAmount] = useState(initial?.amountGEL != null ? String(initial.amountGEL) : "");
  const [isRecurring, setIsRecurring] = useState(initial?.isRecurring ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [dueDate, setDueDate] = useState(
    initial?.dueDate != null ? format(new Date(initial.dueDate), "yyyy-MM-dd") : ""
  );
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const submit = async () => {
    const trimmed = title.trim();
    const parsedAmount = Number(amount);
    if (!trimmed || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: trimmed,
        amountGEL: parsedAmount,
        isRecurring,
        notes: notes.trim() || undefined,
        dueDate: dueDate ? new Date(dueDate).getTime() : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    background: T.panelAlt,
    border: `1px solid ${T.line}`,
    borderRadius: 8,
    color: T.text,
    fontSize: 13,
    fontFamily: T.sans,
    outline: "none",
  };

  return (
    <div
      style={{
        padding: "12px",
        background: T.panelAlt,
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        marginTop: 4,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10 }}>
        <input
          ref={titleRef}
          type="text"
          placeholder="What needs paying? (e.g. Rent)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
        />
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          placeholder="Amount ₾"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ ...inputStyle, fontVariantNumeric: "tabular-nums" }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
        <input
          type="text"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={inputStyle}
        />
        <input
          type="date"
          placeholder="Due date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          style={inputStyle}
        />
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: T.muted,
          fontSize: 12.5,
          fontFamily: T.sans,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={isRecurring}
          onChange={(e) => setIsRecurring(e.target.checked)}
          style={{ cursor: "pointer" }}
        />
        Repeats monthly — auto-resets on the 1st
      </label>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "7px 14px",
            background: "transparent",
            border: `1px solid ${T.line}`,
            borderRadius: 8,
            color: T.muted,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: T.sans,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !title.trim() || !amount}
          style={{
            padding: "7px 14px",
            background: T.accent,
            border: `1px solid ${T.accent}`,
            borderRadius: 8,
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: T.sans,
            cursor: submitting || !title.trim() || !amount ? "not-allowed" : "pointer",
            opacity: submitting || !title.trim() || !amount ? 0.5 : 1,
          }}
        >
          {submitting ? "…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
