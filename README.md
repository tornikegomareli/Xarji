# ხარჯი — Xarji

Self-hosted finance manager for Georgian banks.

## The Problem

Georgian banks don't provide public APIs for accessing transaction data. There's no way to programmatically track your spending, build budgets, or analyze your finances. You're stuck with whatever the bank's app shows you — no exports, no integrations, no control.

But banks do send SMS notifications for every transaction.

## The Solution

Xarji reads bank SMS notifications from your Mac's Messages app, parses the transaction details, and syncs them to your own InstantDB instance. You get a real-time dashboard with analytics, category breakdowns, and full control over your financial data.

Your data never touches third-party servers — everything runs locally on your machine.

```
Messages.app → xarji service (parses SMS) → InstantDB (your account) → xarji client (dashboard)
```

## Supported Banks

- Bank of Georgia / Solo
- TBC Bank
- Liberty Bank
- Credo Bank
- Basis Bank
- Tera Bank
- Custom sender IDs

## Prerequisites

- macOS (Messages app is the data source)
- [Bun](https://bun.sh) runtime
- Free [InstantDB](https://instantdb.com) account
- Bank SMS notifications enabled on your Mac

## Setup

```bash
git clone https://github.com/tornikegomareli/Xarji.git
cd Xarji/service
bun install
bun run setup
```

The setup wizard walks you through everything:

1. Paste your InstantDB App ID and Admin Token
2. Pick your banks from the list
3. It checks macOS Full Disk Access
4. Generates all config and env files
5. Pushes the database schema to InstantDB

Then start the client:

```bash
cd ../client
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Usage

**Start the service (foreground):**

```bash
cd service && bun run start
```

**Install as background daemon (auto-starts on login):**

```bash
cd service && bun run install-service
```

**Send each transaction to a webhook (optional):**

```bash
cd service
bun run src/cli.ts set-webhook https://example.com/hook --secret <token>
bun run src/cli.ts test-webhook
```

Then restart Xarji. Each new transaction is POSTed as one `xarji.payment/v1` JSON event with `Authorization: Bearer <token>`. The raw SMS text is never sent. CLAUDE.md §4.7 has the full schema and retry rules.

**Other commands:**

```bash
bun run status       # check service status
bun run test-parse   # test SMS parsing without syncing
```

## Project Structure

```
Xarji/
├── service/          # Bun backend — reads Messages.app, parses SMS, syncs to InstantDB
│   └── src/
│       ├── setup.ts        # Interactive onboarding wizard
│       ├── service.ts      # File watcher + polling daemon
│       ├── parser.ts       # Georgian bank SMS parser
│       ├── instant-sync.ts # InstantDB sync layer
│       └── config.ts       # ~/.xarji/config.json management
├── client/           # React dashboard — Vite + Tailwind + Recharts
│   └── src/
│       ├── pages/          # Dashboard, Transactions, Analytics, Categories, Settings
│       ├── hooks/          # InstantDB query hooks
│       └── components/     # UI components and charts
```

## Tech Stack

- **Service:** Bun, TypeScript, SQLite (local state)
- **Client:** React, Vite, Tailwind CSS, Recharts
- **Database:** InstantDB (real-time sync, user-owned)

## Privacy

All SMS parsing happens locally on your Mac. InstantDB is your own account — no shared databases, no analytics, no telemetry. Delete your data anytime from the Settings page.

## License

MIT
