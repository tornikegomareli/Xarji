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

export function Layout() {
  const [tweaks, setTweaks] = useState<InkTweaks>(() => loadTweaks());
  const theme = useMemo(() => buildTheme(tweaks), [tweaks]);
  const { payments } = usePayments();
  const signals = useSignals();
  const { credits } = useCredits();

  useEffect(() => {
    saveTweaks(tweaks);
  }, [tweaks]);

  return (
    <TweaksContext.Provider value={{ tweaks, setTweaks }}>
      <ThemeContext.Provider value={theme}>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            background: theme.bg,
            color: theme.text,
            fontFamily: theme.sans,
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
      </ThemeContext.Provider>
    </TweaksContext.Provider>
  );
}
