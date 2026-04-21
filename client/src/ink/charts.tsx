import React from "react";

export interface AreaDatum {
  label: string;
  value: number;
}

export function AreaChart({
  data,
  width = 640,
  height = 180,
  stroke,
  fill,
  strokeWidth = 1.5,
  showGrid = true,
  gridColor = "rgba(0,0,0,0.06)",
  showAxes = true,
  axisColor = "rgba(0,0,0,0.4)",
  axisFont = "ui-monospace, monospace",
  formatY = (n: number) => n.toFixed(0),
  cornerRadius = 0,
  padding = { top: 18, right: 12, bottom: 22, left: 42 },
}: {
  data: AreaDatum[];
  width?: number;
  height?: number;
  stroke: string;
  fill?: string;
  strokeWidth?: number;
  showGrid?: boolean;
  gridColor?: string;
  showAxes?: boolean;
  axisColor?: string;
  axisFont?: string;
  formatY?: (n: number) => string;
  cornerRadius?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
}) {
  const clipId = React.useId();
  if (!data || data.length === 0) return null;
  const values = data.map((d) => d.value);
  const max = Math.max(...values, 1) * 1.08;
  const min = 0;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const x = (i: number) => padding.left + (i / Math.max(1, data.length - 1)) * innerW;
  const y = (v: number) => padding.top + innerH - ((v - min) / (max - min || 1)) * innerH;
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(d.value).toFixed(2)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(2)},${padding.top + innerH} L${x(0).toFixed(2)},${padding.top + innerH} Z`;
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => padding.top + innerH * t);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ display: "block", overflow: "visible", maxWidth: "100%", height: "auto" }}
    >
      {cornerRadius > 0 && (
        <defs>
          <clipPath id={clipId}>
            <rect x={padding.left} y={padding.top} width={innerW} height={innerH} rx={cornerRadius} ry={cornerRadius} />
          </clipPath>
        </defs>
      )}
      {showGrid &&
        gridLines.map((yy, i) => (
          <line key={i} x1={padding.left} x2={width - padding.right} y1={yy} y2={yy} stroke={gridColor} strokeWidth="1" />
        ))}
      {showAxes &&
        [1, 0.75, 0.5, 0.25, 0].map((t, i) => (
          <text
            key={i}
            x={padding.left - 8}
            y={padding.top + innerH * (1 - t) + 3}
            fontSize="10"
            fontFamily={axisFont}
            fill={axisColor}
            textAnchor="end"
          >
            {formatY(max * t)}
          </text>
        ))}
      <g clipPath={cornerRadius > 0 ? `url(#${clipId})` : undefined}>
        {fill && <path d={area} fill={fill} />}
        <path d={line} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      </g>
      {showAxes &&
        data.map((d, i) => {
          if (data.length > 14 && i % Math.ceil(data.length / 7) !== 0 && i !== data.length - 1) return null;
          return (
            <text key={i} x={x(i)} y={height - padding.bottom + 14} fontSize="10" fontFamily={axisFont} fill={axisColor} textAnchor="middle">
              {d.label}
            </text>
          );
        })}
    </svg>
  );
}

export function Donut({
  segments,
  size = 200,
  thickness = 28,
  gap = 2,
  centerLabel,
  centerValue,
  centerColor = "#333",
  labelFont = "ui-monospace, monospace",
}: {
  segments: { value: number; color: string }[];
  size?: number;
  thickness?: number;
  gap?: number;
  centerLabel?: string;
  centerValue?: string;
  centerColor?: string;
  labelFont?: string;
}) {
  const r = size / 2;
  const inner = r - thickness;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = -Math.PI / 2;
  const tau = Math.PI * 2;

  const arc = (startA: number, endA: number) => {
    const large = endA - startA > Math.PI ? 1 : 0;
    const sx = r + r * Math.cos(startA);
    const sy = r + r * Math.sin(startA);
    const ex = r + r * Math.cos(endA);
    const ey = r + r * Math.sin(endA);
    const sx2 = r + inner * Math.cos(endA);
    const sy2 = r + inner * Math.sin(endA);
    const ex2 = r + inner * Math.cos(startA);
    const ey2 = r + inner * Math.sin(startA);
    return `M${sx},${sy} A${r},${r} 0 ${large} 1 ${ex},${ey} L${sx2},${sy2} A${inner},${inner} 0 ${large} 0 ${ex2},${ey2} Z`;
  };

  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      {segments.map((s, i) => {
        const frac = s.value / total;
        const startA = acc;
        const endA = acc + frac * tau - gap / r;
        acc += frac * tau;
        if (endA <= startA) return null;
        return <path key={i} d={arc(startA, endA)} fill={s.color} />;
      })}
      {centerLabel && (
        <text x={r} y={r - 4} textAnchor="middle" fontSize="11" fontFamily={labelFont} fill={centerColor} style={{ opacity: 0.55, letterSpacing: 0.6, textTransform: "uppercase" }}>
          {centerLabel}
        </text>
      )}
      {centerValue && (
        <text x={r} y={r + 18} textAnchor="middle" fontSize="22" fontFamily={labelFont} fill={centerColor} fontWeight={600}>
          {centerValue}
        </text>
      )}
    </svg>
  );
}

export function Sparkline({
  values,
  width = 80,
  height = 24,
  stroke,
  strokeWidth = 1.25,
  fill = "none",
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke: string;
  strokeWidth?: number;
  fill?: string;
}) {
  if (!values || values.length === 0) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const x = (i: number) => (i / (values.length - 1 || 1)) * width;
  const y = (v: number) => height - ((v - min) / (max - min || 1)) * height;
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = fill !== "none" ? `${line} L${width},${height} L0,${height} Z` : null;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {area && <path d={area} fill={fill} />}
      <path d={line} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function HBar({
  fraction,
  height = 6,
  color,
  bgColor = "rgba(0,0,0,0.06)",
  radius = 3,
}: {
  fraction: number;
  height?: number;
  color: string;
  bgColor?: string;
  radius?: number;
}) {
  return (
    <div style={{ width: "100%", height, background: bgColor, borderRadius: radius, overflow: "hidden" }}>
      <div
        style={{
          width: `${Math.min(100, Math.max(0, fraction * 100))}%`,
          height: "100%",
          background: color,
          borderRadius: radius,
          transition: "width .3s ease",
        }}
      />
    </div>
  );
}
