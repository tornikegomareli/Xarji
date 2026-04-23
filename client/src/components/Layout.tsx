import { useEffect, useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "../ink/Sidebar";
import { TweaksPanel } from "../ink/TweaksPanel";
import {
  ThemeContext,
  TweaksContext,
  buildTheme,
  loadTweaks,
  saveTweaks,
  type InkTweaks,
} from "../ink/theme";
import { usePayments } from "../hooks/useTransactions";
import { useSignals } from "../hooks/useSignals";
import { useCredits } from "../hooks/useCredits";
import { useHealth } from "../hooks/useHealth";
import {
  Onboarding,
  clearSetupTransitionFlag,
  readSetupTransitionFlag,
} from "../pages/Onboarding";

export function Layout() {
  const [tweaks, setTweaks] = useState<InkTweaks>(() => loadTweaks());
  const theme = useMemo(() => buildTheme(tweaks), [tweaks]);
  const [transitioning, setTransitioning] = useState<boolean>(() => readSetupTransitionFlag());
  const health = useHealth(transitioning ? 500 : 4000);
  const transitionFlagPresent = readSetupTransitionFlag();
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    saveTweaks(tweaks);
  }, [tweaks]);

  useEffect(() => {
    if (transitionFlagPresent && !transitioning) {
      setTransitioning(true);
    }
  }, [transitionFlagPresent, transitioning]);

  useEffect(() => {
    if (!transitioning) {
      setStuck(false);
      return;
    }

    if (health.state === "running" || health.state === "paused") {
      clearSetupTransitionFlag();
      const id = requestAnimationFrame(() => setTransitioning(false));
      return () => cancelAnimationFrame(id);
    }

    const id = setTimeout(() => setStuck(true), 12000);
    return () => clearTimeout(id);
  }, [transitioning, health.state]);

  return (
    <TweaksContext.Provider value={{ tweaks, setTweaks }}>
      <ThemeContext.Provider value={theme}>
        {/* Precedence MUST stay transitioning > unconfigured: the splash
            is what bridges the post-setup reload, and falling through to
            Onboarding while transitioning re-mounts it at step 0. */}
        {transitioning ? (
          <SetupTransitionSplash stuck={stuck} />
        ) : health.state === "loading" ? (
          <LoadingSplash />
        ) : health.state === "error" && health.data === null ? (
          // /api/health unreachable on a fresh page load — most likely the
          // user opened the PWA from the dock while xarji-core isn't running.
          <ServiceUnreachableSplash onRetry={health.refresh} />
        ) : health.state === "unconfigured" ? (
          <>
            <Onboarding />
            <TweaksPanel />
          </>
        ) : (
          <ConfiguredShell />
        )}
      </ThemeContext.Provider>
    </TweaksContext.Provider>
  );
}

/**
 * Split out so the InstantDB-backed hooks only fire once the service
 * reports a configured state. Rendering Sidebar (and therefore
 * usePayments etc.) against an unconfigured InstantDB app would trigger
 * fruitless queries with bad credentials.
 */
function ConfiguredShell() {
  const { payments } = usePayments();
  const signals = useSignals();
  const { credits } = useCredits();
  return (
    <>
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
        }}
      >
        <Sidebar
          txCount={payments.length}
          incomeCount={credits.length}
          signalsCount={signals.activeCount || undefined}
        />
        <main
          style={{
            flex: 1,
            padding: "28px 36px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Outlet />
        </main>
      </div>
      <TweaksPanel />
    </>
  );
}

function LoadingSplash() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(242,242,244,0.42)",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
      }}
    >
      Loading…
    </div>
  );
}

/**
 * Stand-in shown while the service finishes swapping into configured
 * state after onboarding submits. Lives here (not inside Onboarding)
 * because the whole point is to keep rendering something after the
 * page reload, before we know the new health state.
 */
/**
 * Shown when /api/health is unreachable on first page load. The most
 * common trigger is the user launching the installed PWA / dock shortcut
 * while xarji-core (the bun service supervised by the menu-bar app) is
 * not running. We tell them how to fix it and offer a Retry that just
 * re-polls health — once the service comes up, the next poll succeeds
 * and Layout's render branch flips automatically.
 */
function ServiceUnreachableSplash({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0C0C0E",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        color: "#F2F2F4",
        fontFamily: "'Geist', 'Inter', system-ui, sans-serif",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          background: "rgba(255,90,58,0.12)",
          border: "1px solid rgba(255,90,58,0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#FF5A3A",
          fontSize: 30,
          fontWeight: 700,
        }}
      >
        !
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>
        Xarji isn't running
      </div>
      <div
        style={{
          fontSize: 13,
          color: "rgba(242,242,244,0.62)",
          maxWidth: 380,
          lineHeight: 1.55,
        }}
      >
        Open Xarji from the menu bar (or your Applications folder) so it
        can serve the dashboard. This page will refresh automatically once
        the service is back.
      </div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          marginTop: 8,
          padding: "10px 20px",
          borderRadius: 10,
          background: "#FF5A3A",
          border: "none",
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          fontFamily: "'Geist', 'Inter', system-ui, sans-serif",
          cursor: "pointer",
          boxShadow: "0 8px 24px rgba(255,90,58,0.33)",
        }}
      >
        Try again
      </button>
    </div>
  );
}

function SetupTransitionSplash({ stuck = false }: { stuck?: boolean }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0C0C0E",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        color: "#F2F2F4",
        fontFamily: "'Geist', 'Inter', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          background: "#FF5A3A",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 16px 40px rgba(255,90,58,0.35)",
        }}
      >
        <svg width={34} height={34} viewBox="0 0 34 34" aria-hidden>
          <path
            d="M8 17.5 L14.5 24 L26 12"
            stroke="#fff"
            strokeWidth={3.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>You're all set.</div>
      <div style={{ fontSize: 13, color: "rgba(242,242,244,0.62)" }}>
        {stuck ? "Still finalising setup. Refresh once the service is ready." : "Loading your dashboard…"}
      </div>
      {stuck && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 8,
            background: "transparent",
            border: "none",
            color: "rgba(242,242,244,0.78)",
            fontSize: 13,
            fontFamily: "'Geist', 'Inter', system-ui, sans-serif",
            cursor: "pointer",
            padding: "6px 10px",
            borderRadius: 6,
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          Refresh
        </button>
      )}
    </div>
  );
}
