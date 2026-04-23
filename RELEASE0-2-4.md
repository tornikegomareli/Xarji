# v0.2.4

## What's new

### Install the dashboard as a native web app

Xarji's dashboard is now a proper Progressive Web App — you can install it directly from your browser and it behaves like any other macOS app: its own window without browser chrome, its own Dock icon, Spotlight + ⌘-Tab support, and a real `.app` bundle on disk.

- **Chrome / Edge / Brave / Arc** — a small coral **"Install as app"** button appears in the sidebar once the page finishes loading. Click it and the browser's native install dialog fires.
- **Safari (macOS 14+)** — File → Add to Dock…

The installed dashboard still points at the local `xarji-core` service, so you need the menu-bar Xarji running to use it. If you launch the installed app while the service is stopped, you now see a clear **"Xarji isn't running"** screen with a Retry button — no more hangs or blank pages.

### Under the hood

- Web app manifest with proper 192 / 512 / apple-touch icons generated from the existing `AppIcon.png` (so the PWA icon matches the menu-bar app).
- Minimal pass-through service worker — satisfies Chromium's PWA installability gate without caching anything. Localhost is the source of truth, so a stale cache would actively mislead rather than help.
- `usePwaInstall` hook captures `beforeinstallprompt` so the Sidebar button can fire the install dialog programmatically, instead of making users hunt for the browser's install affordance.
- `/api/health` unreachable state now renders a dedicated splash instead of falling through to a broken dashboard.

## Install

Download `Xarji-0.2.4.dmg`, verify with `Xarji-0.2.4.dmg.sha256`, open and drag Xarji into Applications. On first launch grant Full Disk Access when prompted so the service can read `~/Library/Messages/chat.db`.
