import React from "react";
import { useTheme } from "./theme";

export function Logo({ size = 32 }: { size?: number }) {
  const T = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 10,
          background: T.accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 800,
          fontSize: size * 0.5,
          fontFamily: T.sans,
        }}
      >
        X
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.2, color: T.text, fontFamily: T.sans }}>Xarji</div>
        <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }} lang="ka">
          ხარჯი
        </div>
      </div>
    </div>
  );
}

export function Pill({
  children,
  color,
  bg,
  bold,
}: {
  children: React.ReactNode;
  color?: string;
  bg?: string;
  bold?: boolean;
}) {
  const T = useTheme();
  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        background: bg || T.accentSoft,
        color: color || T.accent,
        fontSize: 10.5,
        fontWeight: bold ? 800 : 700,
        letterSpacing: 0.4,
        fontFamily: T.sans,
        textTransform: "uppercase",
        lineHeight: 1.3,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      {children}
    </span>
  );
}

export function LiveDot({ color }: { color?: string }) {
  const T = useTheme();
  const c = color || T.green;
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        background: c,
        boxShadow: `0 0 8px ${c}99`,
        display: "inline-block",
      }}
    />
  );
}

export function Card({
  children,
  style,
  pad = "22px 24px",
  dark,
  accent,
  glow,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  pad?: string;
  dark?: boolean;
  accent?: boolean;
  glow?: boolean;
}) {
  const T = useTheme();
  return (
    <div
      style={{
        background: dark ? T.bg : accent ? T.accentSoft : T.panel,
        border: `1px solid ${accent ? T.accent + "33" : T.line}`,
        borderRadius: T.rXl,
        padding: pad,
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      {glow && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -60,
            right: -40,
            width: 220,
            height: 220,
            borderRadius: "50%",
            background: T.accent,
            opacity: 0.22,
            filter: "blur(70px)",
            pointerEvents: "none",
          }}
        />
      )}
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}

export function CardLabel({ children }: { children: React.ReactNode }) {
  const T = useTheme();
  return <div style={{ fontSize: 12, color: T.muted, fontWeight: 600, fontFamily: T.sans, letterSpacing: 0.2 }}>{children}</div>;
}

export function CardTitle({ children, size = 15 }: { children: React.ReactNode; size?: number }) {
  const T = useTheme();
  return <div style={{ fontSize: size, fontWeight: 700, color: T.text, fontFamily: T.sans, letterSpacing: -0.2 }}>{children}</div>;
}

export function LinkBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  const T = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        cursor: "pointer",
        fontSize: 11,
        color: T.accent,
        fontWeight: 700,
        fontFamily: T.sans,
        padding: 0,
        letterSpacing: 0.3,
      }}
    >
      {children}
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  rightSlot,
  ranges = ["Today", "Week", "Month", "Year", "Custom", "Cycle"],
  active = "Month",
  onRange,
  customStart,
  customEnd,
  onCustomChange,
  cycleDay,
  cycleLabel,
  onCycleDayChange,
  onCyclePrev,
  onCycleNext,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  rightSlot?: React.ReactNode;
  ranges?: string[] | null;
  active?: string;
  onRange?: (r: string) => void;
  /** YYYY-MM-DD; only consulted when active === "Custom". */
  customStart?: string;
  customEnd?: string;
  /** Fired whenever either custom date input changes. */
  onCustomChange?: (start: string, end: string) => void;
  /** 1–31; the cycle-start day of month, only used when active === "Cycle". */
  cycleDay?: number;
  /** Formatted label for the active cycle, e.g. "Apr 25 – May 24, 2026". */
  cycleLabel?: string;
  onCycleDayChange?: (day: number) => void;
  onCyclePrev?: () => void;
  onCycleNext?: () => void;
}) {
  const T = useTheme();
  const showCustomInputs = ranges && ranges.includes("Custom") && active === "Custom" && onCustomChange;
  const showCycleControls = active === "Cycle" && onCyclePrev;

  const pillStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    background: T.panel,
    borderRadius: 12,
    border: `1px solid ${T.line}`,
  };
  const navBtnStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: T.muted,
    fontSize: 14,
    padding: "2px 6px",
    borderRadius: 6,
    lineHeight: 1,
    fontFamily: T.mono,
  };

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, marginBottom: 6, flexWrap: "wrap" }}>
      <div>
        {eyebrow && <div style={{ fontSize: 12.5, color: T.muted, fontWeight: 500, fontFamily: T.sans }}>{eyebrow}</div>}
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -1, lineHeight: 1.1, marginTop: 4, color: T.text, fontFamily: T.sans }}>
          {title}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {rightSlot}
        {showCustomInputs && (
          <div style={pillStyle}>
            <input
              type="date"
              value={customStart ?? ""}
              max={customEnd || undefined}
              onChange={(e) => onCustomChange!(e.target.value, customEnd ?? "")}
              style={{
                background: "transparent",
                border: "none",
                color: T.text,
                fontSize: 12,
                fontFamily: T.mono,
                padding: "4px 6px",
                outline: "none",
              }}
            />
            <span style={{ color: T.dim, fontSize: 12, fontFamily: T.mono }}>→</span>
            <input
              type="date"
              value={customEnd ?? ""}
              min={customStart || undefined}
              onChange={(e) => onCustomChange!(customStart ?? "", e.target.value)}
              style={{
                background: "transparent",
                border: "none",
                color: T.text,
                fontSize: 12,
                fontFamily: T.mono,
                padding: "4px 6px",
                outline: "none",
              }}
            />
          </div>
        )}
        {showCycleControls && (
          <>
            <div style={pillStyle}>
              <button type="button" style={navBtnStyle} onClick={onCyclePrev} title="Previous cycle">←</button>
              <span style={{ fontSize: 12, fontFamily: T.mono, color: T.text, whiteSpace: "nowrap", padding: "0 2px" }}>
                {cycleLabel}
              </span>
              <button type="button" style={navBtnStyle} onClick={onCycleNext} title="Next cycle">→</button>
            </div>
            <div style={{ ...pillStyle, gap: 4 }}>
              <span style={{ fontSize: 11, color: T.muted, fontFamily: T.sans, whiteSpace: "nowrap" }}>Day</span>
              <input
                type="number"
                min={1}
                max={31}
                value={cycleDay ?? 25}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isNaN(v)) onCycleDayChange?.(v);
                }}
                style={{
                  width: 38,
                  background: "transparent",
                  border: "none",
                  color: T.text,
                  fontSize: 12,
                  fontFamily: T.mono,
                  padding: "4px 4px",
                  outline: "none",
                  textAlign: "center",
                }}
              />
            </div>
          </>
        )}
        {ranges && (
          <div style={{ display: "flex", background: T.panel, borderRadius: 12, padding: 3, border: `1px solid ${T.line}` }}>
            {ranges.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRange && onRange(r)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 9,
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  background: r === active ? (T.mode === "light" ? T.text : "#fff") : "transparent",
                  color: r === active ? T.bg : T.muted,
                  fontFamily: T.sans,
                }}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Toggle({ active, onChange }: { active: boolean; onChange: () => void }) {
  const T = useTheme();
  return (
    <button
      type="button"
      onClick={onChange}
      style={{
        width: 40,
        height: 22,
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        background: active ? T.accent : T.panelAlt,
        position: "relative",
        transition: "background .15s ease",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: active ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: 9,
          background: "#fff",
          transition: "left .15s ease",
        }}
      />
    </button>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  const T = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.line}` }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: T.sans }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: T.muted, marginTop: 2, fontFamily: T.sans }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}
