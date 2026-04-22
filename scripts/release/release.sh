#!/usr/bin/env bash
# Single-command release orchestrator: build → tag → publish.
#
# Intentionally defensive about ordering:
#   1. Run build.sh first. If it fails (notarization rejected, etc.)
#      no tag is created, so you can retry the same version.
#   2. Only after build.sh succeeds do we create + push the git tag,
#      which triggers release.yml on GitHub to create an empty Release
#      with auto-generated notes.
#   3. publish.sh waits for the Release to exist, then attaches the
#      DMG + checksum.
#
# Each stage is idempotent in the sense that you can rerun the whole
# script or jump straight to publish.sh if a partial run already
# advanced through the earlier stages.
#
# Usage:
#   ./scripts/release/release.sh 0.2.0
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

# Refuse to release from anywhere but main — otherwise we'd end up
# tagging a commit that isn't on the main timeline and release.yml
# would notice and skip release creation, leaving us stuck.
BRANCH=$(git branch --show-current)
[[ "$BRANCH" == "main" ]] || fail "release.sh must be run from main (currently on $BRANCH)"

# Working tree must be clean-ish — stash noise like .DS_Store but
# nothing that would slip into the build.
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  fail "working tree has uncommitted changes — commit or stash before releasing"
fi

# Must be up to date with origin/main so the tagged commit is
# actually the one users will see in the Release changelog.
git fetch origin main >/dev/null
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[[ "$LOCAL" == "$REMOTE" ]] || fail "local main ($LOCAL) is not at origin/main ($REMOTE). Pull or push first."

# Tag uniqueness — refuse rather than clobber.
if git tag --list "$TAG" | grep -q "$TAG"; then
  fail "tag $TAG already exists locally"
fi
if git ls-remote --tags origin "$TAG" | grep -q "$TAG"; then
  fail "tag $TAG already exists on origin"
fi

log "Stage 1/3 — build + sign + notarize"
./scripts/release/build.sh "$VERSION"

log "Stage 2/3 — create + push tag $TAG"
git tag -a "$TAG" -m "$TAG"
git push origin "$TAG"

log "Stage 3/3 — wait for Release + upload artifacts"
./scripts/release/publish.sh "$VERSION"

log "Release $TAG complete."
