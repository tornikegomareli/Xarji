import { useMemo, useRef, useState } from "react";
import { useTheme, useViewport } from "../ink/theme";
import { Card, CardLabel, CardTitle, Pill, PageHeader } from "../ink/primitives";
import {
  useBudgetMutations,
  useBudgetPlan,
  useBudgetSummary,
  useCategoryMedianSpend,
} from "../hooks/useBudgets";
import { BUCKETS, BUCKET_DESCRIPTIONS, BUCKET_LABELS, type Bucket, planMonthKey } from "../lib/budgets";
import { useCategories } from "../hooks/useCategories";
import type { Category } from "../lib/instant";
import { format } from "date-fns";

export function Budgets() {
  const T = useTheme();
  const planMonth = planMonthKey();
  const plan = useBudgetPlan(planMonth);
  const summary = useBudgetSummary(planMonth);
  const {
    setCategoryBucket,
    setCategoryTarget,
    setCategoryRollover,
    setExpectedIncome,
    setFlexPool,
    setSavingsTarget,
  } = useBudgetMutations();

  const flexUsedPct = plan.flexPool > 0 ? Math.min(100, (summary.flexActual / plan.flexPool) * 100) : 0;
  const flexRemaining = Math.max(0, plan.flexPool - summary.flexActual);
  const daysLeft = useMemo(() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Math.max(1, lastDay - now.getDate() + 1);
  }, []);

  const showWizard = summary.byBucket.fixed.length === 0 &&
    summary.byBucket.flex.length === 0 &&
    summary.byBucket.non_monthly.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.density.gap, height: "100%" }}>
      <PageHeader
        eyebrow={`Plan for ${format(new Date(), "MMMM yyyy")}`}
        title="Budgets"
        rightSlot={
          <Pill bg={T.accentSoft} color={T.accent}>
            {summary.byBucket.unclassified.length} unclassified
          </Pill>
        }
      />

      {/* Headline: flex remaining */}
      <Card pad="26px 30px" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <CardLabel>Flex remaining · GEL</CardLabel>
        <div
          style={{
            fontSize: "clamp(44px, 6vw, 72px)",
            fontWeight: 700,
            letterSpacing: -3,
            lineHeight: 1,
            color: T.text,
            fontFamily: T.sans,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: T.accent, opacity: 0.9 }}>₾</span>
          {Math.round(flexRemaining).toLocaleString("en-US")}
          <span style={{ fontSize: "0.42em", color: T.muted }}>
            .{flexRemaining.toFixed(2).split(".")[1] || "00"}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: T.muted, fontFamily: T.sans }}>
          ₾{Math.round(flexRemaining / daysLeft).toLocaleString("en-US")}/day for the next {daysLeft} day
          {daysLeft === 1 ? "" : "s"} · ₾{Math.round(plan.flexPool).toLocaleString("en-US")} pool
          {plan.flexPoolIsAuto ? " (auto)" : " (manual)"}
        </div>
        {/* Flex usage bar */}
        <div
          style={{
            marginTop: 8,
            height: 8,
            background: T.panelAlt,
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${flexUsedPct}%`,
              height: "100%",
              background: T.accent,
              transition: "width 200ms ease-out",
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, fontVariantNumeric: "tabular-nums" }}>
          ₾{Math.round(summary.flexActual).toLocaleString("en-US")} spent · {flexUsedPct.toFixed(0)}% of pool
        </div>
      </Card>

      {showWizard ? (
        <SetupWizard onClassify={setCategoryBucket} />
      ) : (
        <>
          {/* Bucket strip */}
          <BucketStrip summary={summary} flexPool={plan.flexPool} />

          {/* Income / savings / flex pool inputs */}
          <PlanInputs
            plan={plan}
            onSetIncome={(v) => setExpectedIncome(planMonth, v)}
            onSetFlexPool={(v) => setFlexPool(planMonth, v)}
            onSetSavingsTarget={(v) => setSavingsTarget(planMonth, v)}
          />

          {/* Bucket sections */}
          {BUCKETS.map((bucket) => (
            <BucketSection
              key={bucket}
              bucket={bucket}
              rows={summary.byBucket[bucket]}
              sinkingFund={bucket === "non_monthly" ? summary.nonMonthlySinkingFund : 0}
              onSetTarget={setCategoryTarget}
              onSetBucket={setCategoryBucket}
              onSetRollover={setCategoryRollover}
            />
          ))}

          {/* Unclassified */}
          {summary.byBucket.unclassified.length > 0 && (
            <UnclassifiedSection
              rows={summary.byBucket.unclassified}
              onSetBucket={setCategoryBucket}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Setup wizard ──────────────────────────────────────────────────

function SetupWizard({ onClassify }: { onClassify: (catId: string, b: Bucket) => Promise<void> }) {
  const T = useTheme();
  const { categories } = useCategories();
  const seedable = categories.length > 0;

  if (!seedable) {
    return (
      <Card pad="40px 30px" style={{ textAlign: "center" }}>
        <CardLabel>No categories yet</CardLabel>
        <div style={{ fontSize: 14, color: T.muted, fontFamily: T.sans, marginTop: 12, lineHeight: 1.5 }}>
          Open the <strong>Categories</strong> page to seed the default set, or let your transactions
          categorise themselves automatically. Once you have at least one category, return here to set
          a budget.
        </div>
      </Card>
    );
  }

  return (
    <Card pad="22px 24px" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <CardTitle>Let's set this up</CardTitle>
        <div style={{ fontSize: 13, color: T.muted, fontFamily: T.sans, marginTop: 6, lineHeight: 1.5 }}>
          Pick a bucket for each category. <strong>Fixed</strong> = predictable monthly costs (rent,
          utilities). <strong>Flex</strong> = discretionary spending that shares one pool.{" "}
          <strong>Non-Monthly</strong> = annual / quarterly costs that accrue across months. You can
          change any of these later — nothing here is permanent.
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {categories.map((c) => (
          <UnclassifiedRow key={c.id} category={c} onClassify={onClassify} />
        ))}
      </div>
    </Card>
  );
}

// ─── Bucket strip (3 progress bars) ────────────────────────────────

function BucketStrip({
  summary,
  flexPool,
}: {
  summary: ReturnType<typeof useBudgetSummary>;
  flexPool: number;
}) {
  const T = useTheme();
  const vp = useViewport();

  const items: Array<{ label: string; actual: number; target: number; color: string }> = [
    { label: "Fixed", actual: summary.fixedActual, target: summary.fixedTarget, color: T.green },
    { label: "Non-Monthly", actual: summary.nonMonthlyActual, target: summary.nonMonthlyAccruals, color: T.blue },
    { label: "Flex", actual: summary.flexActual, target: flexPool, color: T.accent },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: vp.veryNarrow ? "1fr" : "1fr 1fr 1fr",
        gap: T.density.gap,
      }}
    >
      {items.map((it) => {
        const pct = it.target > 0 ? Math.min(100, (it.actual / it.target) * 100) : 0;
        return (
          <Card key={it.label} pad="16px 18px" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <CardLabel>{it.label}</CardLabel>
              <span
                style={{
                  fontSize: 11,
                  color: T.dim,
                  fontFamily: T.mono,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                ₾{Math.round(it.actual)} / ₾{Math.round(it.target)}
              </span>
            </div>
            <div style={{ height: 6, background: T.panelAlt, borderRadius: 3, overflow: "hidden" }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: it.color,
                  transition: "width 200ms ease-out",
                }}
              />
            </div>
            <div style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>
              {pct.toFixed(0)}% used
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Plan inputs (income + savings + flex pool) ───────────────────

function PlanInputs({
  plan,
  onSetIncome,
  onSetFlexPool,
  onSetSavingsTarget,
}: {
  plan: ReturnType<typeof useBudgetPlan>;
  onSetIncome: (v: number | null) => Promise<void>;
  onSetFlexPool: (v: number | null) => Promise<void>;
  onSetSavingsTarget: (v: number) => Promise<void>;
}) {
  const T = useTheme();
  const vp = useViewport();

  return (
    <Card pad="22px 24px" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <CardTitle>Income & allocations</CardTitle>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: vp.veryNarrow ? "1fr" : "1fr 1fr 1fr",
          gap: T.density.gap,
        }}
      >
        <NumberField
          label="Expected income"
          value={plan.expectedIncome}
          isAuto={plan.expectedIncomeIsAuto}
          autoHint="3-month avg of your credits"
          onChange={onSetIncome}
        />
        <NumberField
          label="Savings target"
          value={plan.savingsTarget}
          isAuto={false}
          autoHint="0 by default"
          onChange={(v) => onSetSavingsTarget(v ?? 0)}
        />
        <NumberField
          label="Flex pool"
          value={plan.flexPool}
          isAuto={plan.flexPoolIsAuto}
          autoHint={`${plan.expectedIncome > 0 ? "income − fixed − non-monthly − savings" : "no income detected"}`}
          onChange={onSetFlexPool}
        />
      </div>
    </Card>
  );
}

function NumberField({
  label,
  value,
  isAuto,
  autoHint,
  onChange,
}: {
  label: string;
  value: number;
  isAuto: boolean;
  autoHint: string;
  onChange: (v: number | null) => Promise<void>;
}) {
  const T = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(Math.round(value)));

  const startEdit = () => {
    setDraft(String(Math.round(value)));
    setEditing(true);
  };

  const commit = async () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setEditing(false);
      return;
    }
    await onChange(parsed);
    setEditing(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <CardLabel>{label}</CardLabel>
      {editing ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: T.accent, fontFamily: T.sans, fontWeight: 700, fontSize: 22 }}>₾</span>
          <input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            style={{
              flex: 1,
              padding: "6px 10px",
              background: T.panelAlt,
              border: `1px solid ${T.line}`,
              borderRadius: 8,
              color: T.text,
              fontSize: 22,
              fontFamily: T.sans,
              fontWeight: 700,
              outline: "none",
              minWidth: 0,
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 4,
            padding: 0,
            border: "none",
            background: "transparent",
            color: T.text,
            fontSize: 28,
            fontWeight: 700,
            fontFamily: T.sans,
            letterSpacing: -1,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ color: T.accent, opacity: 0.9 }}>₾</span>
          {Math.round(value).toLocaleString("en-US")}
        </button>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: T.dim, fontFamily: T.mono }}>
        <span>{isAuto ? `auto · ${autoHint}` : "manual"}</span>
        {!isAuto && (
          <button
            type="button"
            onClick={() => onChange(null)}
            style={{
              padding: 0,
              background: "transparent",
              border: "none",
              color: T.accent,
              fontFamily: T.mono,
              fontSize: 10.5,
              cursor: "pointer",
            }}
          >
            reset
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Bucket section (Fixed / Flex / Non-Monthly) ──────────────────

function BucketSection({
  bucket,
  rows,
  sinkingFund,
  onSetTarget,
  onSetBucket,
  onSetRollover,
}: {
  bucket: Bucket;
  rows: Array<{ category: Category; bucket: Bucket | null; target: number; monthlyCommitment: number; actual: number; rolloverIn: number; effectiveTarget: number; remaining: number }>;
  sinkingFund: number;
  onSetTarget: (
    catId: string,
    args: { targetAmount?: number; frequencyMonths?: number; rolloverEnabled?: boolean }
  ) => Promise<void>;
  onSetBucket: (catId: string, b: Bucket | null) => Promise<void>;
  onSetRollover: (catId: string, enabled: boolean) => Promise<void>;
}) {
  const T = useTheme();
  if (rows.length === 0) return null;

  return (
    <Card pad="22px 24px" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <CardTitle>{BUCKET_LABELS[bucket]}</CardTitle>
          {bucket === "non_monthly" && sinkingFund !== 0 && (
            <span
              style={{
                fontSize: 11,
                color: sinkingFund >= 0 ? T.green : T.accent,
                fontFamily: T.mono,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {sinkingFund >= 0 ? "+" : "−"}₾{Math.abs(Math.round(sinkingFund)).toLocaleString("en-US")} sinking fund
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: T.muted, fontFamily: T.sans, marginTop: 4, lineHeight: 1.5 }}>
          {BUCKET_DESCRIPTIONS[bucket]}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <BucketRow
            key={r.category.id}
            row={r}
            onSetTarget={(args) => onSetTarget(r.category.id, args)}
            onMoveToBucket={(b) => onSetBucket(r.category.id, b)}
            onSetRollover={(enabled) => onSetRollover(r.category.id, enabled)}
          />
        ))}
      </div>
    </Card>
  );
}

function BucketRow({
  row,
  onSetTarget,
  onMoveToBucket,
  onSetRollover,
}: {
  row: { category: Category; bucket: Bucket | null; target: number; monthlyCommitment: number; actual: number; rolloverIn: number; effectiveTarget: number; remaining: number };
  onSetTarget: (args: { targetAmount?: number; frequencyMonths?: number }) => Promise<void>;
  onMoveToBucket: (b: Bucket | null) => Promise<void>;
  onSetRollover: (enabled: boolean) => Promise<void>;
}) {
  const T = useTheme();
  const [editing, setEditing] = useState(false);
  const [targetDraft, setTargetDraft] = useState(String(row.target || ""));
  const [freqDraft, setFreqDraft] = useState(String(row.category.frequencyMonths || 12));
  const editorRef = useRef<HTMLDivElement | null>(null);

  const showsTarget = row.bucket === "fixed" || row.bucket === "non_monthly";
  // Bar measures actual / effectiveTarget so a positive rollover gives
  // headroom and a negative one shrinks the bar — visually consistent
  // with the displayed "of ₾X" denominator below.
  const denom = row.effectiveTarget > 0 ? row.effectiveTarget : row.monthlyCommitment;
  const pct = denom > 0 ? Math.min(100, (row.actual / denom) * 100) : 0;
  const overspent = showsTarget && row.actual > Math.max(0, row.effectiveTarget);
  const rolloverEnabled = row.bucket === "fixed" && row.category.rolloverEnabled === true;
  const showRolloverHint = showsTarget && row.rolloverIn !== 0;

  const commit = async () => {
    const target = Number(targetDraft);
    const freq = Number(freqDraft);
    if (!Number.isFinite(target) || target < 0) {
      setEditing(false);
      return;
    }
    if (row.bucket === "non_monthly") {
      const f = Number.isFinite(freq) && freq > 0 ? freq : 12;
      await onSetTarget({ targetAmount: target, frequencyMonths: f });
    } else {
      await onSetTarget({ targetAmount: target });
    }
    setEditing(false);
  };

  // For the Non-Monthly two-input editor, blur on the target input
  // fires when the user clicks the months input, which would commit
  // and unmount the months input before they can type. Skip the
  // close when focus is moving to a sibling inside the editor; only
  // commit on a real "exited the editor" blur. (Codex P2 on PR #42.)
  const onFieldBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (editorRef.current?.contains(e.relatedTarget as Node | null)) return;
    void commit();
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        gap: 12,
        alignItems: "center",
        padding: "10px 12px",
        background: T.panelAlt,
        borderRadius: 10,
        border: `1px solid ${T.line}`,
      }}
    >
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              background: row.category.color,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: T.text, fontFamily: T.sans }}>
            {row.category.name}
          </span>
          {overspent && (
            <Pill bg="rgba(255,90,58,0.16)" color={T.accent}>
              over
            </Pill>
          )}
        </div>
        {showsTarget && row.target > 0 && (
          <div style={{ height: 4, background: T.panel, borderRadius: 2, overflow: "hidden" }}>
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: overspent ? T.accent : row.category.color,
                transition: "width 200ms ease-out",
              }}
            />
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          fontFamily: T.mono,
          fontVariantNumeric: "tabular-nums",
          minWidth: 110,
        }}
      >
        <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>
          ₾{Math.round(row.actual).toLocaleString("en-US")}
        </span>
        {showsTarget && (
          <span style={{ fontSize: 10, color: T.dim }}>
            of ₾{Math.round(Math.max(0, row.effectiveTarget)).toLocaleString("en-US")}
          </span>
        )}
        {showRolloverHint && (
          <span
            style={{
              fontSize: 10,
              color: row.rolloverIn >= 0 ? T.green : T.accent,
            }}
          >
            {row.rolloverIn >= 0 ? "+" : "−"}₾{Math.abs(Math.round(row.rolloverIn)).toLocaleString("en-US")} carried
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {row.bucket === "fixed" && (
          <button
            type="button"
            onClick={() => onSetRollover(!rolloverEnabled)}
            title={rolloverEnabled ? "Rollover ON — leftover/overshoot carries to next month" : "Rollover OFF — each month starts fresh"}
            style={{
              padding: "5px 8px",
              background: rolloverEnabled ? T.accentSoft : "transparent",
              border: `1px solid ${rolloverEnabled ? T.accent : T.line}`,
              borderRadius: 6,
              color: rolloverEnabled ? T.accent : T.muted,
              fontSize: 10.5,
              fontFamily: T.mono,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {rolloverEnabled ? "↻ on" : "↻ off"}
          </button>
        )}
        {showsTarget && (
          editing ? (
            <div
              ref={editorRef}
              style={{
                display: "flex",
                gap: 4,
                background: T.panel,
                border: `1px solid ${T.line}`,
                borderRadius: 6,
                padding: 4,
              }}
            >
              <input
                value={targetDraft}
                autoFocus
                onChange={(e) => setTargetDraft(e.target.value.replace(/[^0-9.]/g, ""))}
                onBlur={onFieldBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(false);
                }}
                placeholder="target"
                style={{
                  width: row.bucket === "non_monthly" ? 70 : 90,
                  padding: "4px 8px",
                  background: T.panelAlt,
                  border: "none",
                  borderRadius: 4,
                  color: T.text,
                  fontSize: 12,
                  fontFamily: T.sans,
                  outline: "none",
                }}
              />
              {row.bucket === "non_monthly" && (
                <input
                  value={freqDraft}
                  onChange={(e) => setFreqDraft(e.target.value.replace(/[^0-9]/g, ""))}
                  onBlur={onFieldBlur}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  placeholder="months"
                  style={{
                    width: 60,
                    padding: "4px 8px",
                    background: T.panelAlt,
                    border: "none",
                    borderRadius: 4,
                    color: T.text,
                    fontSize: 12,
                    fontFamily: T.sans,
                    outline: "none",
                  }}
                />
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setTargetDraft(String(row.target || ""));
                setFreqDraft(String(row.category.frequencyMonths || 12));
                setEditing(true);
              }}
              style={{
                padding: "5px 10px",
                background: "transparent",
                border: `1px solid ${T.line}`,
                borderRadius: 6,
                color: T.muted,
                fontSize: 11,
                fontFamily: T.sans,
                cursor: "pointer",
              }}
            >
              {row.target > 0 ? "edit" : "set target"}
            </button>
          )
        )}
        <BucketDropdown current={row.bucket} onChange={onMoveToBucket} />
      </div>
    </div>
  );
}

function BucketDropdown({
  current,
  onChange,
}: {
  current: Bucket | null;
  onChange: (b: Bucket | null) => Promise<void>;
}) {
  const T = useTheme();
  return (
    <select
      value={current ?? ""}
      onChange={(e) => onChange((e.target.value || null) as Bucket | null)}
      style={{
        padding: "5px 10px",
        background: T.panel,
        border: `1px solid ${T.line}`,
        borderRadius: 6,
        color: T.muted,
        fontSize: 11,
        fontFamily: T.sans,
        cursor: "pointer",
      }}
    >
      <option value="">—</option>
      {BUCKETS.map((b) => (
        <option key={b} value={b}>
          {BUCKET_LABELS[b]}
        </option>
      ))}
    </select>
  );
}

// ─── Unclassified section ─────────────────────────────────────────

function UnclassifiedSection({
  rows,
  onSetBucket,
}: {
  rows: Array<{ category: Category; actual: number }>;
  onSetBucket: (catId: string, b: Bucket | null) => Promise<void>;
}) {
  const T = useTheme();
  return (
    <Card pad="22px 24px" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <CardTitle>Unclassified</CardTitle>
        <div style={{ fontSize: 12, color: T.muted, fontFamily: T.sans, marginTop: 4 }}>
          Categories without a bucket. Assign one to include them in the formula.
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <UnclassifiedRow key={r.category.id} category={r.category} onClassify={onSetBucket} />
        ))}
      </div>
    </Card>
  );
}

function UnclassifiedRow({
  category,
  onClassify,
}: {
  category: Category;
  onClassify: (catId: string, b: Bucket) => Promise<void>;
}) {
  const T = useTheme();
  const median = useCategoryMedianSpend(category.id);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        alignItems: "center",
        padding: "10px 12px",
        background: T.panelAlt,
        borderRadius: 10,
        border: `1px solid ${T.line}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            background: category.color,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: T.text, fontFamily: T.sans }}>
          {category.name}
        </span>
        {median > 0 && (
          <span style={{ fontSize: 10.5, color: T.dim, fontFamily: T.mono }}>
            ~₾{Math.round(median)}/mo
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => onClassify(category.id, b)}
            style={{
              padding: "5px 10px",
              background: T.panel,
              border: `1px solid ${T.line}`,
              borderRadius: 6,
              color: T.muted,
              fontSize: 11,
              fontFamily: T.sans,
              cursor: "pointer",
            }}
          >
            {BUCKET_LABELS[b]}
          </button>
        ))}
      </div>
    </div>
  );
}
