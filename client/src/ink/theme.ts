import { createContext, useContext, useEffect, useState } from "react";

export type InkMode = "dark" | "light";
export type InkAccent = "coral" | "amber" | "emerald" | "azure" | "violet" | "rose";
export type InkDensity = "spacious" | "balanced" | "dense";
export type InkFontPair = "modern" | "classic" | "editorial";
export type InkCurrencyMode = "gel" | "all";
export type InkTimeDefault = "today" | "week" | "month" | "year";

export interface InkTweaks {
  mode: InkMode;
  accent: InkAccent;
  density: InkDensity;
  fontPair: InkFontPair;
  currencyMode: InkCurrencyMode;
  chartsVisible: boolean;
  timeDefault: InkTimeDefault;
}

export const DEFAULT_TWEAKS: InkTweaks = {
  mode: "dark",
  accent: "coral",
  density: "spacious",
  fontPair: "classic",
  currencyMode: "gel",
  chartsVisible: true,
  timeDefault: "month",
};

const INK_DARK = {
  bg: "#0c0c0e",
  panel: "#17171a",
  panelAlt: "#1f1f24",
  panelHi: "#242429",
  text: "#f2f2f4",
  muted: "rgba(242,242,244,0.62)",
  dim: "rgba(242,242,244,0.38)",
  faint: "rgba(242,242,244,0.18)",
  line: "rgba(242,242,244,0.08)",
  lineStrong: "rgba(242,242,244,0.14)",
  accent: "#ff5a3a",
  accentSoft: "rgba(255,90,58,0.16)",
  accentDim: "rgba(255,90,58,0.08)",
  green: "#4bd9a2",
  amber: "#f1b84a",
  blue: "#6aa3ff",
  shadow: "0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.25)",
};

const INK_LIGHT = {
  bg: "#fbfaf7",
  panel: "#ffffff",
  panelAlt: "#f1efea",
  panelHi: "#ebe8e1",
  text: "#17151a",
  muted: "rgba(23,21,26,0.62)",
  dim: "rgba(23,21,26,0.42)",
  faint: "rgba(23,21,26,0.18)",
  line: "rgba(23,21,26,0.08)",
  lineStrong: "rgba(23,21,26,0.14)",
  accent: "#ff5a3a",
  accentSoft: "rgba(255,90,58,0.14)",
  accentDim: "rgba(255,90,58,0.06)",
  green: "#0a9a6b",
  amber: "#c48c1a",
  blue: "#3a6ad6",
  shadow: "0 1px 2px rgba(23,21,26,0.04), 0 12px 28px rgba(23,21,26,0.06)",
};

const ACCENTS: Record<InkAccent, { hex: string; soft: string; dim: string }> = {
  coral: { hex: "#ff5a3a", soft: "rgba(255,90,58,0.16)", dim: "rgba(255,90,58,0.08)" },
  amber: { hex: "#e8a05a", soft: "rgba(232,160,90,0.16)", dim: "rgba(232,160,90,0.08)" },
  emerald: { hex: "#4bd9a2", soft: "rgba(75,217,162,0.14)", dim: "rgba(75,217,162,0.07)" },
  azure: { hex: "#6aa3ff", soft: "rgba(106,163,255,0.14)", dim: "rgba(106,163,255,0.07)" },
  violet: { hex: "#b38df7", soft: "rgba(179,141,247,0.14)", dim: "rgba(179,141,247,0.07)" },
  rose: { hex: "#ff7a9e", soft: "rgba(255,122,158,0.14)", dim: "rgba(255,122,158,0.07)" },
};

const FONT_PAIRS: Record<InkFontPair, { sans: string; mono: string; serif: string }> = {
  modern: {
    sans: "'Inter Tight', 'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    serif: "'Instrument Serif', Georgia, serif",
  },
  classic: {
    sans: "'Geist', 'Inter', system-ui, sans-serif",
    mono: "'Geist Mono', ui-monospace, monospace",
    serif: "'Fraunces', Georgia, serif",
  },
  editorial: {
    sans: "'Inter Tight', system-ui, sans-serif",
    mono: "'JetBrains Mono', monospace",
    serif: "'Instrument Serif', Georgia, serif",
  },
};

const DENSITIES: Record<InkDensity, { rowPad: string; gap: number; headerPad: string }> = {
  spacious: { rowPad: "16px 0", gap: 22, headerPad: "28px 40px" },
  balanced: { rowPad: "13px 0", gap: 18, headerPad: "24px 40px" },
  dense: { rowPad: "10px 0", gap: 14, headerPad: "18px 32px" },
};

export interface InkTheme {
  bg: string;
  panel: string;
  panelAlt: string;
  panelHi: string;
  text: string;
  muted: string;
  dim: string;
  faint: string;
  line: string;
  lineStrong: string;
  accent: string;
  accentSoft: string;
  accentDim: string;
  green: string;
  amber: string;
  blue: string;
  shadow: string;
  sans: string;
  mono: string;
  serif: string;
  rMd: number;
  rLg: number;
  rXl: number;
  density: { rowPad: string; gap: number; headerPad: string };
  mode: InkMode;
  chartsVisible: boolean;
  currencyMode: InkCurrencyMode;
  timeDefault: InkTimeDefault;
}

export function buildTheme(tweaks: InkTweaks): InkTheme {
  const base = tweaks.mode === "light" ? INK_LIGHT : INK_DARK;
  const accent = ACCENTS[tweaks.accent] || ACCENTS.coral;
  const fonts = FONT_PAIRS[tweaks.fontPair] || FONT_PAIRS.modern;
  const density = DENSITIES[tweaks.density] || DENSITIES.balanced;
  return {
    ...base,
    accent: accent.hex,
    accentSoft: accent.soft,
    accentDim: accent.dim,
    sans: fonts.sans,
    mono: fonts.mono,
    serif: fonts.serif,
    rMd: 14,
    rLg: 18,
    rXl: 22,
    density,
    mode: tweaks.mode,
    chartsVisible: tweaks.chartsVisible !== false,
    currencyMode: tweaks.currencyMode || "gel",
    timeDefault: tweaks.timeDefault || "month",
  };
}

export const ThemeContext = createContext<InkTheme | null>(null);
export function useTheme(): InkTheme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error("useTheme outside ThemeProvider");
  return t;
}

export const TweaksContext = createContext<{ tweaks: InkTweaks; setTweaks: (t: InkTweaks) => void } | null>(null);
export function useTweaks() {
  const ctx = useContext(TweaksContext);
  if (!ctx) throw new Error("useTweaks outside TweaksProvider");
  return ctx;
}

export function useViewport() {
  const [w, setW] = useState<number>(() => (typeof window !== "undefined" ? window.innerWidth : 1440));
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return {
    width: w,
    veryNarrow: w < 1000,
    narrow: w < 1200,
  };
}

const STORAGE_KEY = "xarji-tweaks";

export function loadTweaks(): InkTweaks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TWEAKS;
    return { ...DEFAULT_TWEAKS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_TWEAKS;
  }
}

export function saveTweaks(t: InkTweaks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}
