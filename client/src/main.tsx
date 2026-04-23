import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

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
