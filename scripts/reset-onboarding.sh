#!/usr/bin/env bash
# Wipe all Xarji state so the next page load drops you back into the
# onboarding wizard. Intended as a dev-loop convenience — do NOT point
# this at a real install you care about.
#
# Removes:
#   ~/.xarji/                         (config.json, state.db, transactions.json)
#   service/.env                      (INSTANT_APP_ID + INSTANT_ADMIN_TOKEN)
#   client/.env                       (VITE_INSTANT_APP_ID)
#
# Kills (best-effort):
#   bun run --watch src/index.ts      (the service dev server)
#   vite dev                          (the client dev server)
#   xarji-core                        (the compiled binary if the menu-bar
#                                      app installed from the DMG is running)
#
# After running, start the dev stack again with:
#   cd service && bun run dev
#   cd client  && bun run dev
# Then reload http://localhost:5173/.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

printf "==> Killing dev processes (if any)\n"
# `|| true` because pkill exits 1 when nothing matched, and that's fine.
pkill -f "bun run --watch src/index.ts" 2>/dev/null || true
pkill -f "bun run dev"                 2>/dev/null || true
pkill -f "vite"                        2>/dev/null || true
pkill -f "xarji-core"                  2>/dev/null || true

printf "==> Removing state files\n"
rm -rf "$HOME/.xarji"
rm -f  "$REPO_ROOT/service/.env"
rm -f  "$REPO_ROOT/client/.env"

printf "==> Verifying\n"
for path in "$HOME/.xarji" "$REPO_ROOT/service/.env" "$REPO_ROOT/client/.env"; do
  if [[ -e "$path" ]]; then
    printf "   !! %s still exists\n" "$path"
  else
    printf "   ok %s gone\n" "$path"
  fi
done

if lsof -iTCP:8721 -sTCP:LISTEN >/dev/null 2>&1; then
  printf "   !! something is still listening on :8721 — kill it manually\n"
else
  printf "   ok port 8721 is free\n"
fi

printf "\nClean. Start the dev stack and reload http://localhost:5173/ :\n"
printf "  (cd %s && bun run dev) &\n" "service"
printf "  (cd %s && bun run dev) &\n" "client"
