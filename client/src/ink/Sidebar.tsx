import { NavLink } from "react-router-dom";
import { useTheme } from "./theme";
import { Logo, LiveDot } from "./primitives";

interface SidebarItem {
  to: string;
  name: string;
  glyph: string;
  badge?: string;
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
  const items: SidebarItem[] = [
    { to: "/", name: "Overview", glyph: "◉" },
    { to: "/transactions", name: "Transactions", glyph: "≡", badge: txCount ? txCount.toLocaleString("en-US") : undefined },
    { to: "/income", name: "Income", glyph: "↓", badge: incomeCount ? incomeCount.toLocaleString("en-US") : undefined },
    { to: "/categories", name: "Categories", glyph: "◐" },
    { to: "/merchants", name: "Merchants", glyph: "◆" },
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
