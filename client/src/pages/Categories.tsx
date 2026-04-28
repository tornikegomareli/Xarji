import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme, useViewport, type InkTheme } from "../ink/theme";
import { Card, CardLabel, CardTitle, LinkBtn, PageHeader } from "../ink/primitives";
import { AreaChart, Donut, HBar } from "../ink/charts";
import { TxRow, type InkTx } from "../ink/TxRow";
import { useConvertedPayments } from "../hooks/useTransactions";
import { useMonthlyTrend } from "../hooks/useMonthlyTrend";
import { type InkCategory } from "../lib/utils";
import { useCategorizer } from "../hooks/useCategorizer";
import { useCategories, useCategoryActions } from "../hooks/useCategories";
import { useRangeState } from "../hooks/useRangeState";
import { isInRange, rangeToDateParams } from "../lib/dateRange";
import { formatCompact, formatLocalDay, monthKey } from "../ink/format";
import { pickCategoryDefaults } from "../lib/categoryDefaults";
import { endOfMonth, format } from "date-fns";

// Preset palettes the form lets the user pick from. Mirrors
// pickCategoryDefaults' palette so picker + AI tool + form
// converge on the same set.
const FORM_COLORS = [
  "#FF5A3A", "#4BD9A2", "#6AA3FF", "#E8A05A",
  "#B38DF7", "#FF7A9E", "#F1B84A", "#6b7280",
];
const FORM_ICONS = ["◐", "◆", "◉", "✦", "✧", "◇", "✶", "◈"];

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

  const { payments } = useConvertedPayments();
  const { getCategory, categorize: categorizeId, allCategories } = useCategorizer();
  const { categories: dbCategories } = useCategories();
  const { addCategory, updateCategory, deleteCategory } = useCategoryActions();
  const trend = useMonthlyTrend(6);
  const { range, props: rangeProps } = useRangeState("Month");

  // Form modes: only one form is open at a time. `creating` toggles
  // the bottom-of-list "+ New category" form; `editingId` carries the
  // id of the row currently in edit mode (null = no row is being
  // edited). Both close on Escape / Cancel / successful submit.
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // A category row is deletable when there's a DB row with isDefault: false.
  // Hard-coded DEFAULT_CATEGORIES that haven't been seeded into the DB
  // are never deletable (they'd just re-appear from the regex
  // categoriser's id list). Default-bucket categories (from
  // initializeDefaultCategories) are likewise not deletable to preserve
  // the spending mix invariant.
  const deletableIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of dbCategories) {
      if (!c.isDefault) set.add(c.id);
    }
    return set;
  }, [dbCategories]);

  const handleDelete = async (catId: string, catName: string) => {
    const txCount = payments.filter(
      (p) => p.gelAmount !== null && categorizeId(p.merchant, p.rawMessage) === catId
    ).length;
    const message = txCount === 0
      ? `Delete "${catName}"? This category has no transactions assigned to it.`
      : `Delete "${catName}"? ${txCount} transaction${txCount === 1 ? "" : "s"} currently categorise here and will fall back to the auto category. Any merchant-overrides pointing at this category will be removed.`;
    if (!window.confirm(message)) return;
    if (selected === catId) setSelected(null);
    await deleteCategory(catId);
  };

  const monthPayments = useMemo(
    () => payments.filter((p) => isInRange(p.transactionDate, range)),
    [payments, range]
  );

  const cats: CatAgg[] = useMemo(() => {
    const map: Record<string, CatAgg> = {};
    for (const p of monthPayments) {
      if (p.gelAmount === null) continue;
      const cat = getCategory(p.merchant, p.rawMessage);
      if (!map[cat.id]) map[cat.id] = { cat: cat.id, total: 0, count: 0, meta: cat };
      map[cat.id].total += p.gelAmount;
      map[cat.id].count += 1;
    }
    const aggregated = Object.values(map).sort((a, b) => b.total - a.total);

    // Render user-created (non-default) categories that have zero spend
    // in the active range AT THE BOTTOM of the list so they're still
    // editable / deletable. Without this, a freshly-created "Pet care"
    // disappears from the list immediately because the spend
    // aggregation skips it (no transactions assigned yet) — the user
    // would think the create silently failed. Codex flagged the
    // empty-category invisibility on PR #35.
    const visibleIds = new Set(aggregated.map((c) => c.cat));
    const empties: CatAgg[] = [];
    for (const c of dbCategories) {
      if (c.isDefault) continue;
      if (visibleIds.has(c.id)) continue;
      const meta: InkCategory = {
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
      };
      empties.push({ cat: c.id, total: 0, count: 0, meta });
    }
    return [...aggregated, ...empties];
  }, [monthPayments, getCategory, dbCategories]);

  const total = cats.reduce((s, c) => s + c.total, 0);
  const [selected, setSelected] = useState<string | null>(null);

  // Drop a stale selection when the active range no longer contains it,
  // so the right-hand pane never keeps rendering an empty category that
  // isn't even shown in the left list anymore.
  useEffect(() => {
    if (selected && !cats.some((c) => c.cat === selected)) {
      setSelected(null);
    }
  }, [cats, selected]);

  const selectedId = selected || cats[0]?.cat;
  const selCat = allCategories.find((c) => c.id === selectedId);
  const selData = cats.find((c) => c.cat === selectedId);

  const catTrend = useMemo(() => {
    const keys = trend.map((m) => m.key);
    const perCat: Record<string, { key: string; value: number }[]> = {};
    for (const c of allCategories) {
      perCat[c.id] = keys.map((k) => ({ key: k, value: 0 }));
    }
    for (const p of payments) {
      if (p.gelAmount === null) continue;
      const k = monthKey(p.transactionDate);
      const idx = keys.indexOf(k);
      if (idx === -1) continue;
      const catId = categorizeId(p.merchant, p.rawMessage);
      if (perCat[catId]) perCat[catId][idx].value += p.gelAmount;
    }
    return { keys, perCat, labels: trend.map((m) => m.label.slice(0, 3)) };
  }, [payments, trend, allCategories, categorizeId]);

  const selMerchants = useMemo(() => {
    const map: Record<string, { merchant: string; total: number; count: number }> = {};
    for (const p of monthPayments) {
      if (p.gelAmount === null) continue;
      const cid = categorizeId(p.merchant, p.rawMessage);
      if (cid !== selectedId) continue;
      const m = p.merchant || "Unknown";
      if (!map[m]) map[m] = { merchant: m, total: 0, count: 0 };
      map[m].total += p.gelAmount;
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
        <PageHeader eyebrow={eyebrow} title="Categories" {...rangeProps} />
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
      <PageHeader eyebrow={eyebrow} title="Categories" {...rangeProps} />

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
              segments={cats.map((c) => ({ value: c.total, color: c.meta.color, name: c.meta.name }))}
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
              const editable = deletableIds.has(c.cat);
              const isEditing = editingId === c.cat;
              if (isEditing) {
                return (
                  <CategoryForm
                    key={c.cat}
                    T={T}
                    initial={{ name: c.meta.name, color: c.meta.color, icon: c.meta.icon }}
                    onCancel={() => setEditingId(null)}
                    onSubmit={async ({ name, color, icon }) => {
                      // Reject duplicate names against the merged list (excluding self).
                      const nameLc = name.trim().toLowerCase();
                      const collide = allCategories.find(
                        (cat) =>
                          cat.id !== c.cat &&
                          cat.name.toLowerCase() === nameLc
                      );
                      if (collide) return `"${collide.name}" already exists.`;
                      await updateCategory(c.cat, { name: name.trim(), color, icon });
                      setEditingId(null);
                      return null;
                    }}
                    submitLabel="Save"
                  />
                );
              }
              return (
                <div
                  key={c.cat}
                  className="category-row"
                  onClick={() => setSelected(c.cat)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    cursor: "pointer",
                    borderRadius: 10,
                    background: active ? T.panelAlt : "transparent",
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
                  {editable && (
                    <>
                      <button
                        type="button"
                        title={`Edit "${c.meta.name}"`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(c.cat);
                          setCreating(false);
                        }}
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
                        title={`Delete "${c.meta.name}"`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(c.cat, c.meta.name);
                        }}
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
                    </>
                  )}
                </div>
              );
            })}
            {creating ? (
              <CategoryForm
                T={T}
                onCancel={() => setCreating(false)}
                onSubmit={async ({ name, color, icon }) => {
                  const nameLc = name.trim().toLowerCase();
                  const collide = allCategories.find(
                    (cat) => cat.name.toLowerCase() === nameLc
                  );
                  if (collide) return `"${collide.name}" already exists.`;
                  await addCategory({
                    name: name.trim(),
                    color,
                    icon,
                    isDefault: false,
                  });
                  setCreating(false);
                  return null;
                }}
                submitLabel="Create"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setEditingId(null);
                }}
                style={{
                  marginTop: 6,
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
                + New category…
              </button>
            )}
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
                    onBucketClick={(_d, i) => {
                      const key = catTrend.keys[i];
                      if (!key || !selectedId) return;
                      const [y, m] = key.split("-").map(Number);
                      const start = new Date(y, m - 1, 1);
                      const end = endOfMonth(start);
                      navigate(
                        `/transactions?category=${encodeURIComponent(selectedId)}&dateFrom=${formatLocalDay(
                          start.getTime()
                        )}&dateTo=${formatLocalDay(end.getTime())}`
                      );
                    }}
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
                    <button
                      key={m.merchant}
                      onClick={() => {
                        const params = new URLSearchParams();
                        if (selectedId) params.set("category", selectedId);
                        params.set("merchant", m.merchant);
                        const { dateFrom, dateTo } = rangeToDateParams(range);
                        params.set("dateFrom", dateFrom);
                        params.set("dateTo", dateTo);
                        navigate(`/transactions?${params.toString()}`);
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "10px 0",
                        borderTop: 0,
                        borderLeft: 0,
                        borderRight: 0,
                        borderBottom: `1px solid ${T.line}`,
                        background: "transparent",
                        textAlign: "left",
                        cursor: "pointer",
                        color: "inherit",
                        font: "inherit",
                      }}
                    >
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
                    </button>
                  );
                })}
              </div>
            </Card>

            <Card pad="20px 22px" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <CardTitle>Recent in {selCat?.name}</CardTitle>
                <LinkBtn
                  onClick={() => {
                    if (!selectedId) return;
                    const { dateFrom, dateTo } = rangeToDateParams(range);
                    navigate(
                      `/transactions?category=${encodeURIComponent(selectedId)}&dateFrom=${dateFrom}&dateTo=${dateTo}`
                    );
                  }}
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

/** Inline form used for both creating and editing a category. Renders
 *  inside the left-hand category list, replacing the row when in edit
 *  mode. Color/icon pickers are preset swatches matching
 *  pickCategoryDefaults so the form, the AI tool, and the inline
 *  CategoryPicker create-flow share the same visual vocabulary. */
function CategoryForm({
  T,
  initial,
  onCancel,
  onSubmit,
  submitLabel,
}: {
  T: InkTheme;
  initial?: { name: string; color: string; icon: string };
  onCancel: () => void;
  onSubmit: (values: { name: string; color: string; icon: string }) => Promise<string | null>;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  // For new categories, default to deterministic defaults from the
  // current name (regenerated as the user types) so creating with
  // "Coffee shops" gives the same look the AI tool would. Edit mode
  // keeps whatever the row already had.
  const initialDefaults = pickCategoryDefaults(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? initialDefaults.color);
  const [icon, setIcon] = useState(initial?.icon ?? initialDefaults.icon);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update the name-derived defaults as the user types in create mode
  // (initial undefined). Edit mode never re-derives — the user's
  // explicit color/icon stays unless they pick a new one.
  const isCreate = !initial;
  const handleNameChange = (next: string) => {
    setName(next);
    if (error) setError(null);
    if (isCreate) {
      const d = pickCategoryDefaults(next);
      setColor(d.color);
      setIcon(d.icon);
    }
  };

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const err = await onSubmit({ name, color, icon });
      if (err) setError(err);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        padding: "10px 12px",
        background: T.panelAlt,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => handleNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Category name"
        disabled={busy}
        style={{
          padding: "8px 12px",
          background: T.panel,
          border: `1px solid ${T.line}`,
          borderRadius: 8,
          color: T.text,
          fontSize: 13,
          fontFamily: T.sans,
          outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FORM_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              background: c,
              border: color === c ? `2px solid ${T.text}` : `2px solid transparent`,
              cursor: "pointer",
              padding: 0,
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FORM_ICONS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setIcon(g)}
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: icon === g ? T.panel : "transparent",
              border: icon === g ? `1px solid ${T.text}` : `1px solid ${T.line}`,
              color: T.text,
              fontSize: 14,
              cursor: "pointer",
              fontFamily: T.sans,
              padding: 0,
            }}
          >
            {g}
          </button>
        ))}
      </div>
      {error && (
        <div style={{ fontSize: 11, color: T.accent, fontFamily: T.sans }}>{error}</div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          style={{
            flex: 1,
            padding: "8px 12px",
            background: busy || !name.trim() ? T.panel : T.accent,
            color: busy || !name.trim() ? T.dim : "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: T.sans,
            cursor: busy || !name.trim() ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
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
  );
}
