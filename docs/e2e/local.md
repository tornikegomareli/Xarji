# Optional local mode smoke checks

Use the local-mode production build and a separate synthetic ledger, as described
in `local/README.md`. This mode uses `--demo`, not the cloud development `?demo=1`
fixture. No Messages access or cloud credentials are needed. Obtain approval for
the intended UI smoke scope before controlling a browser.

### T-LOCAL-01 — locked UI and synthetic overview

Start `node local/index.mjs --demo --data-dir ./local/demo-var`, visit the exact
loopback URL, and check the access-token gate. Unlock with that demo directory's
UI key. Expect a SYNTHETIC DEMO notice, 90 payments, one income entry and several
spending categories. The Assistant link must be absent. These are fabricated
values, not a statement or real account balance.

### T-LOCAL-02 — local mutations survive reload

In Manage, save an exact-date USD rate. In Must pay, create a synthetic obligation,
mark it paid, then reload. Expect the saved rate/obligation and paid state to remain.
In Categories/Budgets, create a synthetic category and change/clear its budget
bucket. The local adapter must persist both setting and removal.

### T-LOCAL-03 — source guard and locking

Without `--messages-db`, click Sync approved Messages source. Expect a local
failure notice and no permission prompt. Import a synthetic JSON payment plus a
mixed payment/OTP fixture; only the payment appears. Lock the dashboard and verify
the token gate returns. No raw SMS panel should appear in local transaction details.

### T-LOCAL-04 — loopback-only requests

Observe network requests while reloading the dashboard and visiting Manage,
Transactions and Must pay. Every request must target the selected loopback origin;
Google Fonts, InstantDB and AI/provider origins must be absent. The backend can
also be run under an OS sandbox that denies outbound network and personal files
for this synthetic check. Never weaken macOS security to make a check pass.
