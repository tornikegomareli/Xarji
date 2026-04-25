import { NavLink } from "react-router-dom";
import { useTheme } from "./theme";
import { Logo, LiveDot } from "./primitives";
import { usePwaInstall } from "../hooks/usePwaInstall";

interface SidebarItem {
  to: string;
  name: string;
  glyph: string;
  badge?: string;
  pillBadge?: string;
}

export function Sidebar({
  txCount,
  signalsCount,
  incomeCount,
}: {
  txCount?: number;
  signalsCount?: number;
  incomeCount?: number;
}) {
  const T = useTheme();
  const pwa = usePwaInstall();
  const items: SidebarItem[] = [
    { to: "/", name: "Overview", glyph: "◉" },
    { to: "/transactions", name: "Transactions", glyph: "≡", badge: txCount ? txCount.toLocaleString("en-US") : undefined },
    { to: "/income", name: "Income", glyph: "↓", badge: incomeCount ? incomeCount.toLocaleString("en-US") : undefined },
    { to: "/categories", name: "Categories", glyph: "◐" },
    { to: "/merchants", name: "Merchants", glyph: "◆" },
    { to: "/assistant", name: "Assistant", glyph: "✧", pillBadge: "NEW" },
    { to: "/signals", name: "Signals", glyph: "✦", badge: signalsCount ? String(signalsCount) : undefined },
    { to: "/manage", name: "Manage", glyph: "⚙" },
  ];

  return (
    <aside
      style={{
        width: 228,
        borderRight: `1px solid ${T.line}`,
        padding: "28px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 26,
        flexShrink: 0,
        background: T.bg,
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      <Logo size={34} />
      <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === "/"}
            style={({ isActive }) => ({
              padding: "9px 12px",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              textAlign: "left",
              textDecoration: "none",
              background: isActive ? T.text : "transparent",
              color: isActive ? T.bg : T.muted,
              fontSize: 13.5,
              fontWeight: isActive ? 700 : 500,
              fontFamily: T.sans,
              transition: "background .15s ease",
            })}
          >
            {({ isActive }) => (
              <>
                <span style={{ fontFamily: T.mono, fontSize: 12, opacity: 0.85 }}>{it.glyph}</span>
                <span style={{ flex: 1 }}>{it.name}</span>
                {it.pillBadge && (
                  <span
                    style={{
                      fontFamily: T.sans,
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: 0.5,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: isActive ? "rgba(12,12,14,0.12)" : T.accent,
                      color: isActive ? T.bg : "#fff",
                    }}
                  >
                    {it.pillBadge}
                  </span>
                )}
                {it.badge && (
                  <span
                    style={{
                      fontFamily: T.mono,
                      fontSize: 10,
                      color: isActive ? "rgba(12,12,14,0.55)" : T.dim,
                      fontWeight: 600,
                    }}
                  >
                    {it.badge}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div style={{ flex: 1 }} />
      {pwa.canInstall && !pwa.isStandalone && (
        <button
          type="button"
          onClick={() => void pwa.install()}
          style={{
            padding: "11px 12px",
            borderRadius: T.rMd,
            background: T.accentSoft,
            border: `1px solid ${T.accent}55`,
            color: T.accent,
            fontSize: 12.5,
            fontWeight: 700,
            fontFamily: T.sans,
            letterSpacing: 0.1,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 10,
            textAlign: "left",
            transition: "background 150ms ease-out, border-color 150ms ease-out",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = T.accent;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = `${T.accent}55`;
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>↓</span>
          <span style={{ flex: 1 }}>Install as app</span>
        </button>
      )}
      <div style={{ padding: 14, background: T.panel, borderRadius: T.rMd, border: `1px solid ${T.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <LiveDot />
          <span style={{ fontSize: 12, fontWeight: 600, color: T.text, fontFamily: T.sans }}>Live</span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: T.dim, fontFamily: T.mono }}>sync</span>
        </div>
        <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.4, fontFamily: T.sans }}>
          Reading Messages.app via local service
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            background: T.panelAlt,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            color: T.text,
            fontFamily: T.sans,
          }}
        >
          X
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text, fontFamily: T.sans }}>You</div>
          <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>self-hosted</div>
        </div>
      </div>
    </aside>
  );
}
