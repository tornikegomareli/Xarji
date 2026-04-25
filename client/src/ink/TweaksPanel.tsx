import { useState } from "react";
import { useTheme, useTweaks, type InkAccent, type InkMode, type InkDensity, type InkFontPair, type InkCurrencyMode, type InkTimeDefault } from "./theme";
import { getCurrentDemoSelection, setDemoMode, type DemoSelection } from "../dev/demoMode";

const ACCENT_SWATCHES: { id: InkAccent; hex: string }[] = [
  { id: "coral", hex: "#ff5a3a" },
  { id: "amber", hex: "#e8a05a" },
  { id: "emerald", hex: "#4bd9a2" },
  { id: "azure", hex: "#6aa3ff" },
  { id: "violet", hex: "#b38df7" },
  { id: "rose", hex: "#ff7a9e" },
];

const MODES: InkMode[] = ["dark", "light"];
const DENSITIES: InkDensity[] = ["spacious", "balanced", "dense"];
const FONTS: InkFontPair[] = ["modern", "classic", "editorial"];
const CURRENCIES: InkCurrencyMode[] = ["gel", "all"];
const TIMES: InkTimeDefault[] = ["today", "week", "month", "year"];

export function TweaksPanel() {
  const T = useTheme();
  const { tweaks, setTweaks } = useTweaks();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  const handleDemoChange = (target: DemoSelection) => {
    if (target === getCurrentDemoSelection()) return;
    setSwitching(
      target === "off"
        ? "Restoring real data…"
        : target === "empty"
          ? "Loading empty demo…"
          : "Loading rich demo…"
    );
    // Brief delay so the overlay actually paints before the reload
    // navigates the document — keeps on-camera switches tidy.
    window.setTimeout(() => setDemoMode(target), 350);
  };

  const overlay = switching && (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: T.bg,
        opacity: 0.94,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: T.sans,
        color: T.text,
        fontSize: 14,
        fontWeight: 600,
        letterSpacing: 0.2,
      }}
    >
      {switching}
    </div>
  );

  if (!open) {
    return (
      <>
        {overlay}
        <button
          onClick={() => setOpen(true)}
          title="Tweaks"
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            width: 42,
            height: 42,
            borderRadius: 21,
            border: `1px solid ${T.lineStrong}`,
            background: T.panel,
            color: T.text,
            cursor: "pointer",
            fontSize: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: T.sans,
            boxShadow: T.shadow,
            zIndex: 100,
          }}
        >
          ✦
        </button>
      </>
    );
  }

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>
      {children}
    </div>
  );

  const ChipRow = ({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => {
        const active = o === value;
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid ${active ? T.accent + "55" : T.line}`,
              background: active ? T.accentSoft : T.panelAlt,
              color: active ? T.accent : T.muted,
              fontSize: 11.5,
              fontWeight: 600,
              fontFamily: T.sans,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      {overlay}
      <div
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          width: 280,
          background: T.panel,
          border: `1px solid ${T.lineStrong}`,
          borderRadius: T.rLg,
          padding: 16,
          boxShadow: T.shadow,
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.sans }}>Tweaks</div>
        <button
          onClick={() => setOpen(false)}
          style={{ border: "none", background: "transparent", color: T.dim, cursor: "pointer", fontSize: 16 }}
        >
          ×
        </button>
      </div>

      <div>
        <SectionLabel>Mode</SectionLabel>
        <ChipRow options={MODES} value={tweaks.mode} onChange={(v) => setTweaks({ ...tweaks, mode: v as InkMode })} />
      </div>

      <div>
        <SectionLabel>Accent</SectionLabel>
        <div style={{ display: "flex", gap: 6 }}>
          {ACCENT_SWATCHES.map((a) => {
            const active = a.id === tweaks.accent;
            return (
              <button
                key={a.id}
                onClick={() => setTweaks({ ...tweaks, accent: a.id })}
                title={a.id}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: `2px solid ${active ? T.text : "transparent"}`,
                  background: a.hex,
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            );
          })}
        </div>
      </div>

      <div>
        <SectionLabel>Density</SectionLabel>
        <ChipRow options={DENSITIES} value={tweaks.density} onChange={(v) => setTweaks({ ...tweaks, density: v as InkDensity })} />
      </div>

      <div>
        <SectionLabel>Font pair</SectionLabel>
        <ChipRow options={FONTS} value={tweaks.fontPair} onChange={(v) => setTweaks({ ...tweaks, fontPair: v as InkFontPair })} />
      </div>

      <div>
        <SectionLabel>Currency</SectionLabel>
        <ChipRow options={CURRENCIES} value={tweaks.currencyMode} onChange={(v) => setTweaks({ ...tweaks, currencyMode: v as InkCurrencyMode })} />
      </div>

      <div>
        <SectionLabel>Default range</SectionLabel>
        <ChipRow options={TIMES} value={tweaks.timeDefault} onChange={(v) => setTweaks({ ...tweaks, timeDefault: v as InkTimeDefault })} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SectionLabel>Charts</SectionLabel>
        <button
          onClick={() => setTweaks({ ...tweaks, chartsVisible: !tweaks.chartsVisible })}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: `1px solid ${T.line}`,
            background: tweaks.chartsVisible ? T.accentSoft : T.panelAlt,
            color: tweaks.chartsVisible ? T.accent : T.muted,
            fontSize: 11.5,
            fontWeight: 600,
            fontFamily: T.sans,
            cursor: "pointer",
          }}
        >
          {tweaks.chartsVisible ? "Visible" : "Hidden"}
        </button>
      </div>

      {import.meta.env.DEV && (
        <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 12 }}>
          <SectionLabel>Demo data (dev)</SectionLabel>
          <ChipRow
            options={["off", "default", "empty"]}
            value={getCurrentDemoSelection()}
            onChange={(v) => handleDemoChange(v as DemoSelection)}
          />
        </div>
      )}
      </div>
    </>
  );
}
