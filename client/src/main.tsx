import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { buildTheme, loadTweaks } from './ink/theme'

// Apply persisted theme to <html>+<body> BEFORE React mounts, so a
// user with persisted light-mode preferences doesn't see the dark
// stylesheet defaults flash for one frame on cold reload. The Layout
// effect still keeps these in sync when the user toggles the theme
// at runtime; this just covers the pre-paint window.
{
  const theme = buildTheme(loadTweaks())
  document.documentElement.style.background = theme.bg
  document.documentElement.style.color = theme.text
  document.body.style.background = theme.bg
  document.body.style.color = theme.text
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the pass-through service worker. Required for Chromium-based
// browsers (Arc, Chrome, Edge, Brave) to show the "Install Xarji…"
// affordance — the manifest alone isn't enough, the installability gate
// needs a registered SW with a fetch handler. Safari uses the manifest
// directly and ignores the SW registration here.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Silent — failure to register just means the install prompt won't
      // appear. The dashboard still works in the regular tab.
    });
  });
}
