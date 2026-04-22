#!/usr/bin/env bash
# Attaches the artifacts produced by build.sh to the GitHub Release
# that the release.yml workflow created on tag push.
#
# Usage:
#   ./scripts/release/publish.sh 0.2.0
#
# Expects:
#   - dist/releases/<version>/Xarji-<version>.dmg       (from build.sh)
#   - dist/releases/<version>/Xarji-<version>.dmg.sha256
#   - tag v<version> already pushed to origin
#   - gh CLI authenticated (`gh auth status`)
set -euo pipefail

log() { printf "\n==> %s\n" "$*"; }
fail() { printf "ERROR: %s\n" "$*" >&2; exit 1; }

if [[ $# -lt 1 ]]; then
  fail "Usage: $0 <version>"
fi

VERSION="${1#v}"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  fail "Version '$VERSION' is not semver"
fi
TAG="v$VERSION"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

RELEASE_DIR="$REPO_ROOT/dist/releases/$VERSION"
DMG="$RELEASE_DIR/Xarji-$VERSION.dmg"
CHECKSUM="$RELEASE_DIR/Xarji-$VERSION.dmg.sha256"

[[ -f "$DMG" ]] || fail "$DMG missing — run build.sh first."
[[ -f "$CHECKSUM" ]] || fail "$CHECKSUM missing — run build.sh first."

command -v gh >/dev/null || fail "gh CLI not installed"
gh auth status >/dev/null 2>&1 || fail "gh CLI not authenticated — run \`gh auth login\`"

log "Checking tag $TAG exists on origin"
if ! git ls-remote --tags origin "$TAG" | grep -q "$TAG"; then
  fail "Tag $TAG has not been pushed. Create and push it first (e.g. via /tag-release)."
fi

# The release.yml workflow creates the Release on tag push, so we wait
# for it to appear rather than creating it ourselves. Polls up to 60 s
# which is plenty — in practice the workflow runs in ~10 s.
log "Waiting for GitHub Release v$VERSION to appear (created by release.yml)"
for attempt in $(seq 1 30); do
  if gh release view "$TAG" --repo "$(gh repo view --json nameWithOwner --jq .nameWithOwner)" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    fail "Release $TAG never appeared. Check the Release workflow run on GitHub."
  fi
  sleep 2
done

log "Uploading DMG + checksum to release $TAG"
gh release upload "$TAG" "$DMG" "$CHECKSUM" --clobber

RELEASE_URL=$(gh release view "$TAG" --json url --jq .url)

log "Done."
printf "\n  tag:       %s\n" "$TAG"
printf "  release:   %s\n" "$RELEASE_URL"
printf "  artifacts: %s, %s\n\n" "$(basename "$DMG")" "$(basename "$CHECKSUM")"
