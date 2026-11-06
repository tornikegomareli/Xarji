# Optional local-only mode

This is a separate, opt-in runtime. The existing Bun service, InstantDB workflow,
menu-bar app and release build remain the default. Nothing is migrated or uploaded
automatically. Local mode initially supports **TBC SMS** and **TBC** only.

```
approved TBC SMS → parser → private SQLite → authenticated loopback UI
                                  ↓
                     separate, bounded read-only API
```

## Build and start without Messages access

Requires Node.js **24.13 or newer** (native TypeScript stripping and `node:sqlite`)
and Bun for the existing client dependency lockfile. The backend has no third-party
runtime dependencies. From the repository root:

```sh
cd client
bun install --frozen-lockfile --ignore-scripts
bun run build:local
cd ..
node --test local/local.test.mjs
node local/index.mjs --data-dir ./local/var
```

Open **http://127.0.0.1:8721** (the exact address matters). The launcher prints the
path to `ui.token`, never its contents. Read that private file locally and paste its
value into the login form. Do not put a token in a URL, shell argument, screenshot,
issue or remote chat. Login stores an HttpOnly, SameSite=Strict session cookie;
tokens and transaction data are not persisted in browser localStorage. Theme
preferences may be. Sessions expire after eight hours and restart invalidates them.

`Ctrl-C` stops the foreground runtime. It does not install a login item or change
macOS permissions. Stop any existing Xarji process using port 8721 yourself, or
choose a different `--port`. No native wrapper, signed release or auto-start setup
is included in this mode yet.

For an isolated **synthetic** demonstration:

```sh
node local/index.mjs --demo --data-dir ./local/demo-var --port 8722
```

Demo and live directories must be separate. The demo contains 90 fabricated card
payments, a fabricated salary and a discarded OTP fixture. It never opens Messages.

## Data access and storage

The default launch does **not** open `~/Library/Messages/chat.db`, enumerate senders
or search personal conversations. In Manage, upload a JSON file you have prepared:

```json
{
  "messages": [{
    "messageId": 1,
    "senderId": "TBC SMS",
    "timestamp": "2026-01-01T12:00:00Z",
    "text": "47.80 GEL\nVISA (***0000)\nSYNTHETIC SHOP\n01/01/2026"
  }]
}
```

Upload is limited to 1 MiB; only enabled, allowlisted TBC senders are parsed. Sender
labels are filters, not cryptographic proof that an SMS came from a bank.

Only after the operator has explicitly approved the source and macOS access,
automatic polling can be enabled with an explicit path:

```sh
# Permission-sensitive: do not run until source access has been approved.
node local/index.mjs --data-dir ./local/var --messages-db /absolute/approved/chat.db
```

The source is opened read-only. SQL selects the enabled bank handle and incoming
rows (`is_from_me=0`) before accessing message bodies. It does not enumerate other
senders. Import runs at startup, then every 60 seconds, at most 20,000 bank rows
per sender per pass. Cursors advance through rejected/unrecognised rows. macOS
`attributedBody` extraction is inherited from the existing heuristic parser; new
archive layouts can remain unsupported. Counters report discarded rows without
logging their contents. The original Messages DB is never modified.

**Full Disk Access is broad OS access**, even with a narrow SQL filter. This Node
runtime cannot turn it into a bank-only macOS permission. It never requests or
grants it. Avoid granting broad Terminal/Node access just to try the app; manual
import works without it. A dedicated, reviewed and signed importer is future work.
iPhone SMS must first reach the Mac through an operator-configured Apple forwarding
workflow. This runtime does not enable forwarding or Messages-in-iCloud.

Local mode keeps amounts, currencies, dates, transaction types, bank sender,
merchant/counterparty labels and optionally 3–4 card suffix digits. It **does not
store raw SMS, OTP/security messages, balances, failure text or source account
fields** in the ledger, WAL, export or API. Security messages are skipped before
transaction parsing, including mixed payment/OTP bodies. This is a conservative
pattern guard, not a guarantee that every future OTP format is recognised; it may
also reject a legitimate merchant name containing a security keyword. Source SMS
and manually prepared input files remain where the operator kept them.
The same guard protects cloud parsing. Cloud reads also check the full archive
before text extraction, and security SMS are omitted from parser failure results.

The data directory must be owned by the current OS user, mode `0700`, and not a
symlink. SQLite, WAL/SHM and capability files are private (`0600`); unsafe existing
permissions are rejected. It uses a new `ledger.sqlite`, never the original
`~/.xarji/config.json`, `state.db` or JSON backup. Data is **not encrypted by the
app**. FileVault, OS account security and backup choices remain relevant. A process
running as the same OS user can read the ledger and capabilities. This is not an
isolation boundary against malware running as you.

Deleting transactions keeps deduplication fingerprints so the same SMS cannot
quietly return on the next poll. There is no automatic reset or destructive cloud
migration. Export in Manage downloads structured JSON including categories,
budgets and must-pay items, without tokens/raw messages. Export is currently one-way;
restoring an exported ledger is not implemented.

## Local interface and read-only agent API

The existing dashboard, categories, merchant overrides, budgets and must-pay tools
use a local adapter. AI/Assistant, provider setup, webhooks, remote exchange rates,
InstantDB sync, remote fonts and update checks are disabled in this build. Currency
rates can be entered manually for the exact date in Manage. Until a rate exists,
foreign-currency amounts are omitted from GEL totals with an explicit notice.

The server binds only `127.0.0.1`. Exact Host/Origin checks, rejection of proxy
headers/cross-site fetches, per-session CSRF, bounded JSON bodies and a `connect-src
'self'` CSP protect the loopback API from ordinary websites and DNS rebinding.
No CORS is enabled. API/static responses use `Cache-Control: no-store`. The original
pass-through PWA worker does not cache responses. Errors and logs omit request
payloads, source text and capabilities.

`agent-read.token` is a separate capability. It cannot create UI sessions, read the
full export, mutate a record, import SMS, fetch source messages or use another API.
Only these GET endpoints are available:

- `/api/agent/transactions?limit=100&offset=0` (maximum 500 per page)
- `/api/agent/summary` (totals grouped by currency; excludes failed/excluded rows)

The response allowlist includes amount, currency, date, transaction type, bank sender
and opaque ID; it omits merchant/counterparty names, card digits, raw SMS and tokens.
Use the CLI to keep the capability out of command-line arguments:

```sh
node local/agent-export.mjs --token-file ./local/var/agent-read.token --summary
node local/agent-export.mjs --token-file ./local/var/agent-read.token --limit 100 --offset 0
```

The CLI connects only to loopback and refuses redirects. These responses are still
financial data. Giving the output to a remote/cloud agent requires the operator's
separate approval; the application does not do this itself. The UI needs its own
key and can see more details. Removing a capability file and restarting generates
a new key; a restart also invalidates UI sessions. Keep token files out of backups
that may be shared. No bank/MyApps API credentials are required.

## Validation and limits

`node --test local/local.test.mjs` uses a temporary synthetic Messages database and
tests OTP rejection, read-only/source filtering, pagination, private files,
immutable imported fields, atomic changes, dedup deletion, authentication,
CSRF/Host/Origin, static traversal, agent scopes and sanitized errors. It never
opens a personal Messages database. When running the original Bun service suite,
use an isolated HOME: existing upstream tests can read Messages and modify
`~/.xarji` if run against your ordinary account.

SMS are incomplete evidence, **not a bank statement or verified balance**. Missing
notifications, changed formats, duplicates from multiple forwarding sources,
own-account transfers skipped by the parser and unsupported archives can affect
totals. Reversals are represented as incoming credits; they are not matched back
to the original purchase. This mode reuses the existing TBC parser without adding
SMS formats: single-star card masks such as `(*0000)` and English declined-payment
notifications are currently unsupported. Budgets and the must-pay pot are manually maintained.
This mode has no automatic backup, encrypted vault, export restore, reconciliation,
mobile app or production security audit. Dependencies are fetched during setup;
runtime code does not make external requests. Keep the cloud build (`bun run build`)
and local build (`bun run build:local`, `dist-local`) separate.
