# CLAUDE.md — Xarji

Working context for Claude Code sessions in this repo. Read it all before making non-trivial changes. If something here is wrong, fix the doc and the code in the same PR.

---

## 1. What we are building

**Xarji** (Georgian: ხარჯი, "expense") is a macOS desktop app that parses your Georgian bank SMS locally and shows the results on a dashboard you own end-to-end.

- Input: SMS notifications from Georgian banks (TBC, Bank of Georgia / Solo, Liberty, Credo, Basis, Tera) that land in `~/Library/Messages/chat.db`.
- Processing: per-bank regex parsers extract `{ amount, merchant, direction, cardLastDigits, date, … }` and classify transactions as `payment`, `payment_failed`, or `credit`.
- Storage: every parsed transaction is written to an **InstantDB** app the user creates themselves (free tier, their credentials). No Xarji-owned backend exists. A JSON backup at `~/.xarji/transactions.json` is the last-line-of-defense copy.
- UI: a React dashboard served by the app's own HTTP server on `127.0.0.1:8721`, accessed via the browser. A small Swift menu-bar app shows live status and gives the user a "Open dashboard" / "Quit" entry point.

**Intentional non-goals**:

- No cloud service Xarji runs. No Xarji account. No billing. No analytics.
- No cross-platform support. macOS 13+, Apple Silicon only. `chat.db` is a macOS thing; everything else follows.
- No collaboration / team features. Single-user tool for one Mac.
- No Mac App Store distribution. DMG only, signed + notarized with Developer ID.

**Target user**: a Georgian who banks with at least one of the supported banks, has an `appleid.com` account, and is comfortable pasting credentials once during onboarding. Not necessarily technical beyond that.

---

## 2. Architecture at a glance

Three components in one repo. They run as three separate processes in production:

```
┌─────────────────────────────────────────────────────────────────┐
│  Xarji.app (menu-bar, Swift)                                    │
│  ─ NSStatusItem in menu bar                                     │
│  ─ supervises xarji-core as a child Process                     │
│  ─ polls /api/health every 5s to show status                    │
└──────────────────┬──────────────────────────────────────────────┘
                   │ spawns + stdio pipe
┌──────────────────▼──────────────────────────────────────────────┐
│  xarji-core (Bun-compiled binary)                               │
│  ─ HTTP server on 127.0.0.1:8721 (never 0.0.0.0)                │
│  ─ serves embedded React bundle AND /api/* JSON                 │
│  ─ reads chat.db, parses SMS, writes to InstantDB               │
│  ─ state.db (SQLite) tracks per-sender cursor + dedup           │
└──────────────────┬──────────────────────────────────────────────┘
                   │ HTTP (localhost)
┌──────────────────▼──────────────────────────────────────────────┐
│  React dashboard (served from /)                                │
│  ─ InstantDB SDK in the browser, queries the user's app         │
│  ─ Onboarding wizard when the service reports "unconfigured"    │
│  ─ Full dashboard once the service is configured + running      │
└─────────────────────────────────────────────────────────────────┘
```

Key invariant: the **three processes never share secrets directly**. The InstantDB admin token lives in `~/.xarji/config.json` and is used by the Bun service. The client gets only a redacted form. The menu-bar app sees nothing sensitive.

---

## 3. Directory layout

```
.
├── CLAUDE.md                     ← this file
├── README.md                     ← end-user-facing intro
├── app-menubar/                  ← Swift menu-bar app (SwiftPM, no Xcode)
│   ├── Package.swift
│   ├── AppIcon.png               ← 1024×1024 source, regenerated to .icns at build
│   ├── version.env               ← MARKETING_VERSION + BUILD_NUMBER
│   ├── Scripts/
│   │   ├── package_app.sh        ← assembles Xarji.app from swift build output
│   │   └── xarji-core.entitlements  ← JIT entitlements for the Bun child
│   └── Sources/XarjiMenuBar/
│       ├── main.swift            ← NSApplication bootstrap + SIGTERM via DispatchSource
│       ├── AppDelegate.swift
│       ├── StatusBarController.swift   ← NSStatusItem
│       ├── CoreProcess.swift     ← Process supervision w/ exponential backoff
│       └── HealthPoller.swift    ← periodic /api/health
│
├── service/                      ← Bun service (xarji-core)
│   ├── package.json
│   └── src/
│       ├── index.ts              ← entrypoint: loads config, starts HTTP + service
│       ├── http.ts               ← Bun.serve — API + static assets + runtime HTML inject
│       ├── service.ts            ← orchestrator: watches chat.db, parses, syncs
│       ├── config.ts             ← loadConfig + isConfigured (file → env fallback)
│       ├── db-reader.ts          ← read-only bun:sqlite client for chat.db
│       ├── state-db.ts           ← ~/.xarji/state.db (cursor + dedup)
│       ├── parser.ts             ← parser registry + parseMessage() dispatch
│       ├── parsers/              ← per-bank regex parsers (solo.ts, tbc.ts, …)
│       ├── sync.ts               ← fan-out to local JSON + InstantDB + webhook
│       ├── instant-sync.ts       ← @instantdb/admin client wrapper
│       ├── instant-schema.ts     ← schema definition for payments/failedPayments/credits/…
│       ├── push-schema.ts        ← one-shot: push schema to InstantDB
│       ├── setup/                ← shared setup pipeline (TUI + HTTP both use it)
│       │   ├── schema.ts         ← field definitions (source of truth)
│       │   ├── apply.ts          ← applySetup(values) — validate/bootstrap/write
│       │   ├── preview.ts        ← read-only sampler for the onboarding wizard
│       │   └── tui.ts            ← schema-driven terminal wizard
│       ├── tui.ts                ← generic TUI primitives (prompt, spinner, box)
│       ├── cli.ts                ← `bun run status|test|install-service`
│       ├── diagnose-month.ts     ← ad-hoc dev script for parser QA
│       └── generated/
│           └── client-assets.ts  ← stub; overwritten at build time by embed-assets.ts
│
├── client/                       ← React dashboard (Vite + React 19)
│   ├── package.json
│   ├── vite.config.ts            ← dev proxy /api → 127.0.0.1:8721
│   └── src/
│       ├── main.tsx              ← router + providers
│       ├── App.tsx
│       ├── index.css
│       ├── components/Layout.tsx ← health-based split: Onboarding vs ConfiguredShell
│       ├── pages/
│       │   ├── Onboarding.tsx            ← orchestrator for the 6-step wizard
│       │   ├── OnboardingSteps.tsx       ← individual step components + motion
│       │   ├── Dashboard.tsx
│       │   ├── Transactions.tsx
│       │   ├── Analytics.tsx
│       │   ├── Categories.tsx
│       │   ├── Merchants.tsx
│       │   ├── Income.tsx
│       │   └── Settings.tsx
│       ├── ink/                  ← the in-house design system
│       │   ├── theme.ts          ← tokens, modes, accents (Ink)
│       │   ├── primitives.tsx    ← Card, Pill, Logo, LiveDot, Toggle…
│       │   ├── Sidebar.tsx
│       │   ├── TxRow.tsx
│       │   ├── charts.tsx
│       │   ├── TweaksPanel.tsx   ← floating dark/light + accent picker
│       │   └── format.ts
│       ├── hooks/
│       │   ├── useHealth.ts      ← polls /api/health every 4s
│       │   ├── useTransactions.ts, useCredits.ts, useSignals.ts, …
│       │   └── useBankSenders.ts, useCategories.ts, useMonthlyAnalytics.ts, …
│       └── lib/
│           ├── instant.ts        ← InstantDB init; reads window.__XARJI_APP_ID__
│           └── utils.ts
│
├── scripts/                      ← repo-level dev + release scripts
│   ├── build-dev.sh              ← dev-only packaging helper
│   ├── embed-assets.ts           ← generates service/src/generated/client-assets.ts
│   ├── reset-onboarding.sh       ← dev: wipe ~/.xarji + .envs, kill dev servers
│   └── release/
│       ├── build.sh              ← signed + notarized DMG build
│       ├── release.sh            ← orchestrates build → tag → publish
│       ├── publish.sh            ← uploads DMG + checksum to the GitHub release
│       └── README.md             ← one-time Apple setup walkthrough
│
├── .github/workflows/
│   ├── ci.yml                    ← lint + typecheck + test on every PR
│   └── release.yml               ← on tag push, creates GitHub release w/ auto notes
│
├── dist/                         ← gitignored; release artefacts + dev builds
├── keys/                         ← gitignored; ASC API .p8 private key
└── scripts/release/.release.env  ← gitignored; APP_IDENTITY + NOTARY_PROFILE
```

---

## 4. The Bun service (xarji-core)

### 4.1 Config resolution

`service/src/config.ts::loadConfig()` resolves in this order:

1. `~/.xarji/config.json` — the canonical location. Written by `applySetup` on successful onboarding.
2. `INSTANT_APP_ID` + `INSTANT_ADMIN_TOKEN` env vars — the dev-mode fallback, also used by `scripts/release/build.sh` when it needs the service to run in a sidecar.
3. Otherwise `defaultConfig` → the service reports `unconfigured` and the UI shows the onboarding wizard.

`isConfigured()` mirrors this: returns true if the config file exists OR both env vars are set. Both are exported from `config.ts` and used by `service/src/index.ts`.

### 4.2 Setup pipeline

The onboarding wizard (TUI + HTTP) is **schema-driven**. The schema lives at `service/src/setup/schema.ts` and defines every field (id, kind, validator, placeholder, etc.). There is exactly one source of truth.

- **TUI**: `service/src/setup/tui.ts` reads the schema and renders prompts.
- **HTTP**: `GET /api/setup` returns `serializeSchema()` (schema with validators stripped) plus current values. `POST /api/setup` runs `applySetup(values)`.
- **applySetup** (`service/src/setup/apply.ts`) is the shared persistence + bootstrap pipeline. Ordering is deliberate:
  1. validate via schema validators
  2. **InstantDB bootstrap FIRST** — schemaless pass to create attrs, then schema-backed pass to register uniqueness/indexes. If this fails, we bail *before* writing `config.json` so the next launch still sees the install as unconfigured.
  3. write `~/.xarji/config.json`
  4. initialise `~/.xarji/state.db`
  5. on any failure after step 3, `rollbackConfig()` unlinks the config file.

  We deliberately do NOT write `service/.env` or `client/.env` from this path. They used to be a "dev convenience" but caused the post-onboarding Welcome flash — see §10.5.

### 4.3 HTTP surface

`service/src/http.ts` starts a `Bun.serve({ hostname: "127.0.0.1", … })` on port 8721. **Never** 0.0.0.0 — this is a loopback-only app, the user's trust model is "I own this Mac."

API surface (all under `/api/`):

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | `{ state, senders, transactionCount, lastSync, running }` — polled by UI + menu-bar |
| `/api/config` | GET | redacted config (admin token replaced with `[redacted]`) |
| `/api/banks` | GET | list of known bank parsers + sender ids |
| `/api/setup` | GET | serialized schema + current values (admin token blanked) |
| `/api/setup` | POST | runs `applySetup`, hot-swaps the service into the configured state in-place |
| `/api/preview` | POST | read-only sampler: given senders, returns per-bank counts + sample transactions. Distinguishes `full-disk-access` vs `messages-db-missing` vs `internal` error kinds. |

Static assets: served from `CLIENT_ASSETS` when populated (compiled binary), or from `client/dist/` on disk otherwise. HTML entries (`/`, `*.html`) get runtime config injected — see §4.4.

### 4.4 Runtime HTML inject

Vite bakes `import.meta.env.VITE_*` variables in at build time. That's wrong for our case because the user's InstantDB app id is only known after onboarding.

Fix: `serveHtmlWithRuntimeConfig()` in `http.ts` reads the HTML, inserts `<script>window.__XARJI_APP_ID__=…;</script>` before `</head>`, and `client/src/lib/instant.ts::resolveAppId()` prefers `window.__XARJI_APP_ID__` over the Vite-baked env var. This is why a config change on the server takes effect on the next page reload without a service restart.

Escapes `</` in the injected JSON payload defensively — belt-and-braces against a pathological app id.

### 4.5 Service runtime (`service.ts`)

`ExpenseTrackerService.start()` flow:

1. `ensureStateDbDir()` + `new StateDb(…)`.
2. `initSyncTargets(config)` — initialises InstantDB client etc.
3. `processNewMessages()` initial sync — iterates configured sender ids, reads since-last-message-id, parses, dedups, syncs, advances cursor.
4. `startWatching()` — `fs.watch(chat.db)` with a 2s debounce to handle rapid writes (Messages.app tends to write in bursts).
5. A fallback `setInterval` polls at `pollIntervalMs * 5` so we survive watcher misses.

Cursor-advancement rule (subtle): `last_message_id` only ever advances to the highest **successfully-parsed** message id. We never jump past unparsed messages, so adding a new parser later can retroactively pick up old SMS that used to be unrecognised.

### 4.6 Building the compiled binary

```
cd service
bun run build:binary   # bun build --compile --target=bun-darwin-arm64
```

This:

1. Builds the React client (`cd client && bun run build`).
2. Runs `scripts/embed-assets.ts` which populates `service/src/generated/client-assets.ts` with `import path with { type: "file" }` entries for every file in `client/dist/`. These imports are what `bun build --compile` bakes the bytes into the binary for.
3. Compiles `service/src/index.ts` into `service/dist/xarji` (~60 MB).

`client-assets.ts` is a committed stub (empty `CLIENT_ASSETS: Record<string, string> = {}`). The build overwrites it; `git checkout` restores the stub. Never commit the generated form.

---

## 5. The React client

### 5.1 Routing + shell

`client/src/components/Layout.tsx` decides what to render based on `useHealth()`:

- `loading` → `LoadingSplash` (a simple centred "Loading…")
- `unconfigured` → `<Onboarding />` + `<TweaksPanel />`
- `running` / `paused` / `error` → `<ConfiguredShell />` which mounts Sidebar + Outlet and the InstantDB-backed hooks (`usePayments`, `useSignals`, `useCredits`). Hooks are **not** called when `unconfigured` because queries against an unconfigured InstantDB app would error quietly.

There is also a **setup-transition splash** — a sessionStorage flag (`xarji-setup-transition`) that Onboarding sets right before `window.location.reload()` so the reload window doesn't flash a broken dashboard. Layout reads the flag and renders a dedicated splash until health confirms `running`, then clears. See `Layout.tsx::SetupTransitionSplash`.

### 5.2 Ink — the design system

`client/src/ink/theme.ts` is the token source. Design constraints worth internalising:

- **Modes**: `dark` (default, near-black `#0C0C0E` bg), `light` (warm off-white `#FBFAF7`). Same coral accent in both.
- **Accents**: `coral` (default `#FF5A3A`), `amber`, `emerald`, `azure`, `violet`, `rose`. User-pickable via TweaksPanel.
- **Densities**: `spacious` (default), `balanced`, `dense`. Controls row padding + gap.
- **Fonts**: three pairs (`modern` Inter Tight, `classic` Geist + Fraunces, `editorial` Inter + Instrument Serif). Default is `classic`.
- All tweaks persist to localStorage under `xarji-tweaks`. Enum validation on load so a corrupted storage entry never lands in `buildTheme`.

Always use `useTheme()` — never hard-code colors. `useTweaks()` is for the TweaksPanel itself.

### 5.3 Onboarding flow

Six screens, one decision per screen, motion-animated via `motion` (v12+, the Framer successor):

| # | Step | Input | Notes |
|---|---|---|---|
| 0 | Welcome | none | Logo + value prop, animated in |
| 1 | App ID | UUID | Masked via `-webkit-text-security: disc` + hold-to-reveal eye + paste button |
| 2 | Admin Token | secret | Same mask + reveal + paste. `Stored locally` pill. |
| 3 | Banks | multiselect | 7 bank options, SOLO preselected |
| 4 | Preview | none | `/api/preview` live sampler; auto-retries every 4s while errored (handles Full Disk Access grant during onboarding) |
| 5 | Done | none | Coral check + `window.location.reload()` via setup-transition flag |

Progress dots above the content; hidden on Welcome + Done. Click a completed dot to jump back.

**Secret inputs**: `type="text"` with `-webkit-text-security: disc` — NOT `type="password"`. That type triggers browser password managers to offer "Save password?" and autofill, which is wrong for app-specific tokens. Also applies `autocomplete="off"`, `data-1p-ignore`, `data-lpignore="true"`, `data-form-type="other"`.

**Motion**: 420ms screen transitions, directional slide (60px translate), easing `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quart). `AnimatePresence mode="wait"`.

**Full Disk Access recovery**: the preview step detects `errorKind: "full-disk-access"`, shows a coral block with a deep-link button that opens `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles`. While errored it re-probes `/api/preview` every 4s so the UI auto-recovers once the user grants access — no relaunch of xarji-core needed (TCC checks happen on file access, not process start).

### 5.4 InstantDB integration

`client/src/lib/instant.ts` initialises a single `init({ appId })` client. The module uses **top-level `await`** so evaluation blocks until the app id is resolved. Resolution order:

1. `window.__XARJI_APP_ID__` — runtime-injected by xarji-core's HTML inject (production path).
2. `GET /api/config` — dev-mode fallback. Vite serves the HTML so step 1 never fires; we ask the bun service directly. Adds one localhost round-trip to first paint in dev only.
3. `import.meta.env.VITE_INSTANT_APP_ID` — only if the API is unreachable at boot.
4. Hard-coded sentinel — last resort.

Hooks (`usePayments`, `useCredits`, `useSignals`) are thin wrappers around `db.useQuery(…)`. They assume a configured client — Layout guarantees this by not mounting `ConfiguredShell` before `health.state === "running" | "paused"`.

---

## 6. The Swift menu-bar app

### 6.1 Structure

- **No Xcode project.** Pure SwiftPM. Built with `swift build -c release --arch arm64`.
- `main.swift` creates `NSApplication.shared`, sets `.accessory` activation policy (Dock icon hidden), and installs a SIGTERM handler via `DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)` — NOT a raw `signal(2)` handler, because signal handlers can only do async-signal-safe work and `NSApplication.terminate` is not. GCD routes signal delivery through the main queue outside signal context.
- `AppDelegate.applicationDidFinishLaunching` builds the status item, starts `HealthPoller`, starts `CoreProcess`.
- `StatusBarController` owns the NSStatusItem and its menu.
- `HealthPoller` GETs `/api/health` every 5s and pipes the JSON into the menu (`Status: running`, `Last sync: …`, `Senders: SOLO, TBC SMS`).
- `CoreProcess` supervises `xarji-core` as a `Process` child:
    - `resolveCoreBinary()` — search order: `XARJI_CORE_BINARY` env → `Xarji.app/Contents/MacOS/xarji-core` → binary next to the menu-bar exe (the `swift run` case).
    - stdout + stderr captured via `Pipe.readabilityHandler`, forwarded to `os.Logger`. **On EOF (child closed pipe) we clear the handler and close the fd** — otherwise the closure keeps firing forever on the closed descriptor and leaks across every respawn.
    - Restart-on-crash uses exponential backoff capped at 30s (`0.5s, 1s, 2s, 4s, …`). Reset to 0 after a 10-second successful run.
    - `@unchecked Sendable` because all mutable state is manually serialised on `supervisionQueue`.

### 6.2 Packaging

`app-menubar/Scripts/package_app.sh`:

1. `swift build -c release --arch arm64`.
2. Creates `dist/Xarji.app/Contents/{MacOS,Resources}`.
3. Generates `AppIcon.icns` from `app-menubar/AppIcon.png` via `sips` + `iconutil` (all 10 size slots macOS wants).
4. Writes `Info.plist` with `LSUIElement=true` (hides Dock icon), `CFBundleIconFile=AppIcon`, the versioning from `version.env`.
5. Copies the SwiftPM executable and the pre-built `xarji-core` into `Contents/MacOS/`.
6. `xattr -cr` to strip extended attributes so codesign doesn't complain.
7. **Signs `xarji-core` with the JIT entitlements** from `app-menubar/Scripts/xarji-core.entitlements`:
    - `com.apple.security.cs.allow-jit` — true
    - `com.apple.security.cs.allow-unsigned-executable-memory` — true

    Without these the Bun-compiled binary dies on first JIT allocation with `Ran out of executable memory while allocating N bytes.` under hardened runtime. See §10 gotchas.
8. Signs the outer app (no JIT entitlements — the Swift shell doesn't need them).

`version.env` (at `app-menubar/version.env`) is the source of truth for `MARKETING_VERSION` + `BUILD_NUMBER`. `package_app.sh` lets the environment override the file so `scripts/release/build.sh` can pass a specific version without editing the committed file.

### 6.3 Entitlements plist syntax

**AMFIUnserializeXML (the kernel's entitlements parser) is strict.** It rejects XML comments, CDATA, and anything unusual. `plutil -lint` will happily pass a file that `codesign` refuses. Keep the plist minimal, no XML comments. Explanatory prose goes in `package_app.sh` instead.

---

## 7. Development

### 7.1 Dev stack

Two processes in two terminals:

```
cd service && bun run dev    # bun run --watch src/index.ts, serves :8721
cd client  && bun run dev    # vite, serves :5173 with /api proxy to :8721
```

Open `http://localhost:5173/`. Vite's proxy sends `/api/*` to the Bun service. The service's HTML inject doesn't apply in dev because Vite serves the HTML directly — `client/src/lib/instant.ts` resolves the app id by hitting `/api/config` (see §5.4).

### 7.2 Reset script

`scripts/reset-onboarding.sh` wipes onboarding state so the next page load drops back into the wizard. Removes:

- `~/.xarji/` (config.json, state.db, transactions.json)
- `service/.env` and `client/.env`

Kills `bun --watch`, `vite`, and any lingering `xarji-core` from an installed DMG. Safe to run with nothing running.

### 7.3 Testing

`cd service && bun test` runs the service test suite (158+ tests across 10 files). Notable suites:

- `service/src/setup/__tests__/schema.test.ts` — every schema validator + `validateAll` mixed-good-bad paths.
- `service/src/setup/__tests__/apply.test.ts` — validation gate fast-fail (does not touch fs or network).
- `service/src/setup/__tests__/preview.test.ts` — preview error classification.
- `service/src/setup/__tests__/config.test.ts` — file vs env-var resolution paths. `stashConfig()` uses `mkdirSync({ recursive: true })` because the CI runner's HOME lacks `~/.xarji` on fresh boot.
- `service/src/parsers/__tests__/*.test.ts` — per-bank parser fixtures.

Client tests don't exist yet — we rely on `tsc -b` + `vite build` as the only gate, plus manual UI verification. If a client refactor benefits from unit tests, add them; otherwise don't invent coverage for its own sake.

### 7.4 Dev → DMG loop

For testing an end-user-facing change (icon, onboarding, signed binary behaviour), you have to build the DMG because dev mode doesn't exercise hardened runtime, notarization, or the HTML runtime inject. See §8.

---

## 8. Release pipeline

End-to-end flow, from "I have commits on main" to "there's a signed DMG on the GitHub release":

### 8.1 One-time Apple setup (per-Mac, per-releaser)

1. Enrol in the Apple Developer Program → **Developer ID Application** certificate. Install into login Keychain via Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application. **Not** Apple Development / Apple Distribution — those are for the App Store.
2. Create an **App Store Connect API key** under the same team:
    - appstoreconnect.apple.com → Users and Access → Integrations → Team Keys → Generate
    - Access: `Developer` role is enough for notarization
    - Download the `.p8` once (not re-downloadable), save to `keys/AuthKey.p8` (gitignored)
    - Record the Key ID and Issuer ID (shown on the Keys page)
3. Store the key with notarytool:

    ```
    xcrun notarytool store-credentials "xarji-notary" \
      --key keys/AuthKey.p8 \
      --key-id <10-char key id> \
      --issuer <uuid issuer id>
    ```

4. Create `scripts/release/.release.env`:

    ```
    APP_IDENTITY="Developer ID Application: Techzy LLC (539293JFA3)"
    NOTARY_PROFILE="xarji-notary"
    APPLE_TEAM_ID="539293JFA3"
    ```

    The team id in the cert common name **must match** the team the ASC key belongs to — notarization rejects mismatches. If you get a team mismatch, it's usually because the ASC key was generated under the wrong team (App Store Connect silently defaults to the last-used team in the team selector).

### 8.2 Cutting a release

```
# 1. Bump version
#    edit app-menubar/version.env (MARKETING_VERSION + BUILD_NUMBER)
#    commit + push to main

# 2. Build the signed + notarized DMG locally
./scripts/release/build.sh 0.X.Y
#    → dist/releases/0.X.Y/Xarji-0.X.Y.dmg
#    → dist/releases/0.X.Y/Xarji-0.X.Y.dmg.sha256

# 3. Tag + push. The Release workflow (.github/workflows/release.yml)
#    fires on the tag push and auto-creates a GitHub release with
#    auto-generated notes.
git tag -a v0.X.Y -m "v0.X.Y"
git push origin v0.X.Y

# 4. Upload the DMG + checksum to the release
gh release upload v0.X.Y \
  dist/releases/0.X.Y/Xarji-0.X.Y.dmg \
  dist/releases/0.X.Y/Xarji-0.X.Y.dmg.sha256
```

`scripts/release/release.sh` wraps all four steps if you want a one-shot.

### 8.3 What `build.sh` actually does

1. Validates `.release.env` exists and both `APP_IDENTITY` / `NOTARY_PROFILE` are set.
2. Verifies the Developer ID cert is in the keychain AND the notary profile exists.
3. Warns (not errors) on a dirty working tree.
4. Builds the client (`bun run build`) + embeds assets (`scripts/embed-assets.ts`) + compiles the Bun binary (`bun build --compile`).
5. Runs `app-menubar/Scripts/package_app.sh release` with `SIGNING_MODE=identity` — this is where JIT entitlements + Developer ID signing happen.
6. Zips `.app` with `ditto -c -k --keepParent` (preserves symlinks + xattrs correctly, Apple's documented incantation).
7. Submits to notarytool with `--wait`. Typical wall time: 1–3 minutes per submission.
8. Staples the ticket to the `.app` with `xcrun stapler staple`.
9. Builds the DMG via `hdiutil create -format UDZO` with a Drag-to-Applications symlink.
10. Signs the DMG, submits THE DMG for a second notarization pass, staples that too.
11. Computes SHA-256.

Both `.app` and `.dmg` are notarized. The app staple lets users run after extracting; the DMG staple prevents Gatekeeper from rejecting the disk image on mount.

### 8.4 Tag → GitHub release workflow

`.github/workflows/release.yml`:

- Fires on tag push matching `v*.*.*`.
- Verifies the tagged commit is reachable from `origin/main` — prevents accidental releases from feature branches that happen to have a semver tag.
- Runs `gh release create <tag> --title <tag> --generate-notes --verify-tag`.
- Does **not** build the DMG. Notarization requires a Mac with your Developer ID cert + notary profile; we keep that local rather than shipping credentials to GitHub Actions.

---

## 9. Conventions

### 9.1 Code style (TypeScript / React)

- **Trust framework guarantees.** Don't add `if (res == null)` defensive checks around things that can't be null. Only validate at system boundaries (user input, external APIs).
- **No premature abstraction.** Three similar lines is better than a helper.
- **No speculative features.** Don't add flags, hooks, or config knobs for hypothetical future requirements. Add them when the second caller materialises.
- **Comments explain *why*, not *what*.** If a reader could learn "what" from the code, the comment is redundant. Write comments for: hidden constraints, subtle invariants, workarounds for specific bugs, behaviour that would surprise a future reader. No per-line commentary.
- **No referencing the current task or caller in comments.** `// used by X`, `// added for the Y flow`, `// handles issue #123` belong in the PR description, not the codebase. They rot.
- **Default to no comments** unless the "why" is non-obvious.

### 9.2 Swift style

- **No `@MainActor` sprinkled where unnecessary.** Use it on NSApplication-owned types (AppDelegate, StatusBarController). Use `@unchecked Sendable` for types that manage their own synchronisation (CoreProcess uses a dispatch queue).
- **Raw `signal()` handlers are async-signal-unsafe.** Use `DispatchSource.makeSignalSource(signal:queue:)`. See `main.swift`.
- **Readability handler cleanup on EOF.** Always clear `fh.readabilityHandler = nil` and close the fd when `availableData` is empty — otherwise the closure keeps firing on the closed descriptor.

### 9.3 Commits

- **Subject in imperative mood**, ≤72 chars. Describe what the commit *does*, not what it changes.
- **Body explains why.** Include the failure mode if it's a fix, the rationale if it's an architectural choice.
- Co-author every Claude commit:

    ```
    Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
    ```

- Never `--no-verify`. Never `--amend` after the commit has been pushed.

### 9.4 Stacked PRs

We ship features as stacks (PR 2 targets main, PR 3 targets PR 2's branch, etc.). Rules:

- **Before merging the bottom of a stack, retarget all dependent PRs to `main`.** Deleting a base branch (`--delete-branch`) cascades and closes dependent PRs that pointed at it. GitHub refuses to reopen a PR whose base branch is gone — the only recovery is opening a new PR from the same head branch, which loses the PR number and review history.
- Merge order: retarget all → merge bottom → merge next → etc. `--delete-branch` is safe once everything above has been retargeted.

See `memory/feedback_stacked_pr_merges.md`.

### 9.5 Tests

- `bun test` must pass before any commit that touches service code.
- `cd client && bun run build` (typecheck + vite build) must pass before any client commit.
- When adding a parser, add a fixture test in `service/src/parsers/__tests__/` with at least 3 real-world SMS samples (anonymised if needed).
- For the schema-driven setup, any new field requires a validator test in `service/src/setup/__tests__/schema.test.ts`.

---

## 10. Gotchas we've hit

### 10.1 JIT entitlements under hardened runtime

**Symptom**: signed + notarized DMG installs cleanly, but the menu bar shows `Status: unreachable`. Running `xarji-core` directly prints `Ran out of executable memory while allocating 128 bytes.`

**Cause**: Bun is a JavaScriptCore-based runtime, it JITs JS at runtime. macOS hardened runtime (enabled via `codesign --options runtime`) blocks JIT without explicit entitlements.

**Fix**: `app-menubar/Scripts/xarji-core.entitlements` grants `com.apple.security.cs.allow-jit` + `com.apple.security.cs.allow-unsigned-executable-memory`. `package_app.sh` passes this file to codesign **only for `xarji-core`**, not the outer app (the Swift shell doesn't JIT and shouldn't carry JIT rights).

### 10.2 AMFIUnserializeXML + XML comments

**Symptom**: `Failed to parse entitlements: AMFIUnserializeXML: syntax error near line N` during codesign.

**Cause**: the entitlements plist parser is strict and rejects XML comments, even though `plutil -lint` passes.

**Fix**: no comments in the entitlements file. Explanatory prose lives in `package_app.sh`.

### 10.3 Team ID mismatch between cert and ASC key

**Symptom**: notarization uploads succeed but return `Invalid` status with a team-id mismatch message.

**Cause**: the Developer ID Application cert was issued to team A, but the ASC API key was generated under team B. Apple requires them to match.

**Fix**: regenerate the ASC API key under the right team. App Store Connect's team selector silently defaults to the last-used team — always double-check the top-right switcher before generating.

### 10.4 Stacked PR cascade on `--delete-branch`

**Symptom**: you merge PR 2 with `--delete-branch`, then PR 3 shows as `CLOSED` with no way to reopen.

**Cause**: PR 3's base branch was PR 2's head, which you just deleted. GitHub auto-closes the child and `gh pr reopen` errors with `Could not open the pull request`.

**Fix**: retarget every dependent PR to `main` *before* merging the parent with `--delete-branch`. See §9.4.

### 10.5 Setup-flow reload race (the post-onboarding Welcome flash)

**Symptom (now fixed)**: completing the onboarding wizard in dev mode briefly flashed the Welcome step before the Dashboard appeared. Reproduced in the compiled DMG too, just less frequently.

**Cause**: `applySetup` used to write `service/.env` and `client/.env` mid-POST. Vite watches `.env` files and triggers a browser reload on change; bun's `--watch` does the same and additionally killed the in-flight POST. The Vite-triggered reload landed on a fresh page *before* `submit()` ever wrote the `xarji-setup-transition` flag — so Layout had no signal to render the splash and fell through to `Onboarding` at step 0. The catch block in `submit()` made it worse by clearing the flag whenever the killed POST threw, even when a separate reload had been triggered.

**Fix**: `applySetup` no longer writes the `.env` files. The runtime reads `~/.xarji/config.json` directly; `client/src/lib/instant.ts` resolves the InstantDB app id via `GET /api/config` when `window.__XARJI_APP_ID__` isn't injected (dev mode). Neither `bun --watch` nor Vite restarts during setup. Belt-and-braces: `Onboarding.submit()` writes the transition flag as the very first statement (before the POST), and the catch block keeps the flag set so a transient network blip doesn't unhide Welcome.

### 10.6 `type="password"` triggers password managers

**Symptom**: user pastes an InstantDB admin token into the onboarding field, browser offers to "Save password?" and autofills from unrelated saved credentials.

**Cause**: `type="password"` is a browser heuristic trigger for password-manager integration, regardless of semantics.

**Fix**: keep `type="text"` and mask visually with `-webkit-text-security: disc`. Widely supported in Chromium + Safari. Also set `autocomplete="off"`, `data-1p-ignore`, `data-lpignore="true"`, `data-form-type="other"`.

### 10.7 macOS icon caching

**Symptom**: new DMG installs but Finder shows the old (or generic) icon.

**Cause**: macOS aggressively caches bundle icons in `/private/var/folders/*/com.apple.iconservices`.

**Fix** (local dev):

```
sudo find /private/var/folders/ -name com.apple.iconservices -exec rm -rf {} +
killall Finder Dock
```

End users on a fresh machine don't see this.

### 10.8 Full Disk Access grant mid-run

The good news: TCC permission for Full Disk Access is checked on each file access, not at process start. When the user grants FDA while xarji-core is running, subsequent reads of `chat.db` succeed. No relaunch needed.

The onboarding preview exploits this: while in `full-disk-access` error state, it re-probes `/api/preview` every 4s so the UI auto-recovers the moment the user toggles Xarji in System Settings.

---

## 11. Skills / tooling we've used

### 11.1 Codex review via the OpenAI Codex plugin

The `codex-plugin-cc` plugin (installed at `~/.claude/plugins/cache/openai-codex/codex/1.0.4/`) lets Claude hand a diff to the Codex CLI for an independent review pass.

Invocation for a stacked PR:

```
node "~/.claude/plugins/cache/openai-codex/codex/1.0.4/scripts/codex-companion.mjs" \
  review --wait --base <parent-branch> --scope branch
```

- `--base` targets the parent branch so the review sees only this PR's own diff, not the cumulative diff against main.
- `--scope branch` vs `--scope pr` — `branch` works for diff-against-base-branch, `pr` uses GitHub PR metadata.
- `--wait` blocks until Codex finishes and returns its findings inline.

Codex's output comes back as categorised findings like `[P1] <finding title> — <file>:<lines>`. P1 = blocker, P2 = nice-to-have, P3 = nit. We address P1s in the same PR, P2s when they're quick, P3s rarely.

This is how we found and fixed, across the stacked PR series that built this project:

- **PR#2** config.ts env-var fallback path
- **PR#3** HTML runtime injection + config rollback ordering
- **PR#4** SIGTERM signal safety + readabilityHandler EOF cleanup
- **PR#5** `accessSync` EACCES/EPERM classification for Full Disk Access
- **PR#6** `MARKETING_VERSION` override leak in `version.env` sourcing

### 11.2 Claude `tag-release` skill

A user-level skill that enforces the release-tag discipline: tag from `main` only, annotated tags (`-a -m`), semver-validated names, no overwrites, no force-pushes of tags. Invoked as `/tag-release 0.X.Y` from Claude Code. Always prepends `v` if missing.

### 11.3 Claude `macos-spm-app-packaging` skill

Used once during project bootstrap (`app-menubar/` creation) to scaffold the SwiftPM layout + signing scripts. Has templates under `~/.claude/skills/macos-spm-app-packaging/assets/templates/` for `package_app.sh`, `sign-and-notarize.sh`, `compile_and_run.sh`, `make_appcast.sh`, a `bootstrap/` app skeleton, and reference docs for packaging + release. We copy from its templates and adapt to the Xarji-specific needs (menu-bar instead of Dock app, embedded xarji-core child binary, JIT entitlements).

### 11.4 Reset-state dev script

`scripts/reset-onboarding.sh` — kills dev processes, wipes `~/.xarji/`, `.env` files, and verifies the port is free. Used every time we iterate on the onboarding UX.

---

## 12. Future work (explicitly deferred)

Things we considered and decided to skip for now. Re-evaluate when there's a concrete need, not before:

- **Homebrew Cask tap** (`tornikegomareli/homebrew-xarji`). Trivial to add — single Ruby file pointing at the GitHub release DMG. Skipped because a download-from-landing-page flow is fine at current scale.
- **npm per-platform distribution** (`@xarji/darwin-arm64` optional dependencies). Would enable `npx xarji` for CLI-only use. Would also inherit the Full Disk Access / TCC bundle-id problem that `npx` makes harder. No demand yet.
- **Sparkle auto-updates.** `scripts/release/make_appcast.sh` template from the `macos-spm-app-packaging` skill supports it. Not wired up. The GitHub release + Homebrew Cask combo gets us 80% of the way without the complexity.
- **Client tests.** No Vitest / Playwright yet. Add when a refactor is risky enough to warrant them; don't invent coverage.
- **Code splitting for the client bundle.** Currently 190KB gzipped in one chunk. Fine for now; revisit if the onboarding first-paint becomes slow.
- **Light-mode polish.** Dark mode is the default and gets most attention. Light mode works but is less rehearsed.

---

## 13. Quick reference

```
Dev:
  cd service && bun run dev           # :8721
  cd client  && bun run dev           # :5173
  open http://localhost:5173

Reset onboarding:
  ./scripts/reset-onboarding.sh

Tests:
  cd service && bun test

Typecheck:
  cd service && bun run typecheck
  cd client  && bun run build

Local signed DMG build:
  ./scripts/release/build.sh 0.X.Y    # needs scripts/release/.release.env + cert + notary profile

Tag + GitHub release:
  git tag -a v0.X.Y -m v0.X.Y
  git push origin v0.X.Y
  gh release upload v0.X.Y dist/releases/0.X.Y/Xarji-0.X.Y.dmg{,.sha256}

Codex review (stacked):
  node ~/.claude/plugins/cache/openai-codex/codex/1.0.4/scripts/codex-companion.mjs \
    review --wait --base <parent-branch> --scope branch
```

Read §10 before debugging anything that smells like "it built but it doesn't run."
