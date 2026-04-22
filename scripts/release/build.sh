#!/usr/bin/env bash
# Xarji release build — produces a signed, notarized, stapled DMG.
#
# Nothing is pushed to GitHub or npm; this is a local-only build that
# you can audit before running publish.sh.
#
# Outputs:
#   dist/releases/<version>/Xarji-<version>.dmg          the installer
#   dist/releases/<version>/Xarji-<version>.dmg.sha256   SHA-256 checksum
#
# Required on this Mac:
#   - Apple Developer Program membership with a Developer ID Application
#     certificate imported into the login keychain.
#   - A notarytool keychain profile created once via
#     `xcrun notarytool store-credentials`.
#   - bun, swift (Xcode command-line tools), gh (for later publish step).
#
# Usage:
#   ./scripts/release/build.sh 0.2.0
#   ./scripts/release/build.sh v0.2.0      # leading v is accepted and stripped
set -euo pipefail

log() { printf "\n==> %s\n" "$*"; }
fail() { printf "ERROR: %s\n" "$*" >&2; exit 1; }

# -------- args + env --------

if [[ $# -lt 1 ]]; then
  fail "Usage: $0 <version>"
fi

VERSION="${1#v}"  # strip an optional leading 'v'
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  fail "Version '$VERSION' is not semver (expected N.N.N or N.N.N-prerelease)"
fi
TAG="v$VERSION"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/scripts/release/.release.env"
[[ -f "$ENV_FILE" ]] || fail "$ENV_FILE missing — copy .release.env.example and fill it in."
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${APP_IDENTITY:?APP_IDENTITY is empty in .release.env}"
: "${NOTARY_PROFILE:?NOTARY_PROFILE is empty in .release.env}"

# -------- preflight --------

log "Preflight checks"

for tool in bun swift xcodebuild xcrun hdiutil shasum; do
  command -v "$tool" >/dev/null || fail "missing tool: $tool"
done

# Verify the signing cert is actually in the keychain under the given
# common name. `security` lists one row per cert; we match the exact
# name the user pasted into .release.env.
if ! security find-identity -v -p codesigning | grep -F "$APP_IDENTITY" >/dev/null; then
  fail "Signing cert '$APP_IDENTITY' not found in login keychain. Run \`security find-identity -v -p codesigning\` to see what's available."
fi

# Verify the notary keychain profile exists. notarytool doesn't have a
# clean "is this profile valid?" command, but we can call history with
# it and see if it errors on missing creds.
if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  fail "notarytool profile '$NOTARY_PROFILE' missing or invalid. Create it with \`xcrun notarytool store-credentials\`."
fi

# Git cleanliness: untracked .DS_Store and similar noise is fine, but a
# dirty working tree probably means an in-progress edit the user hasn't
# decided about. Warn loudly, don't hard-fail.
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  printf "WARN: working tree has uncommitted changes — the build will pick them up.\n"
fi

# -------- build --------

BUILD_DIR="$REPO_ROOT/dist/build/$VERSION"
RELEASE_DIR="$REPO_ROOT/dist/releases/$VERSION"
mkdir -p "$BUILD_DIR" "$RELEASE_DIR"

log "Building client (bun)"
(cd client && bun install --frozen-lockfile && bun run build)

log "Embedding client assets into service"
bun run "$REPO_ROOT/scripts/embed-assets.ts"

log "Compiling xarji-core (Bun executable)"
(cd service && bun install --frozen-lockfile && bun run build:binary)

log "Packaging Xarji.app with Developer ID signature"
# app-menubar/Scripts/package_app.sh already supports SIGNING_MODE=identity.
# Reuse it so the signing path is identical regardless of entry point.
(cd app-menubar && \
  MARKETING_VERSION="$VERSION" \
  SIGNING_MODE="identity" \
  APP_IDENTITY="$APP_IDENTITY" \
  XARJI_CORE_BINARY="$REPO_ROOT/service/dist/xarji" \
  ./Scripts/package_app.sh release)

APP_SRC="$REPO_ROOT/app-menubar/dist/Xarji.app"
[[ -d "$APP_SRC" ]] || fail "expected $APP_SRC after package_app.sh but it does not exist"

# Copy the .app into a per-version staging area so we can keep the
# un-notarized and notarized builds side-by-side for debugging.
log "Staging .app at $BUILD_DIR"
rm -rf "$BUILD_DIR/Xarji.app"
cp -R "$APP_SRC" "$BUILD_DIR/Xarji.app"

# -------- notarize --------

log "Zipping .app for notarization"
ZIP="$BUILD_DIR/Xarji.zip"
rm -f "$ZIP"
# ditto preserves symlinks and xattrs better than zip; Apple's own
# notarization docs use this exact incantation.
ditto -c -k --keepParent "$BUILD_DIR/Xarji.app" "$ZIP"

log "Submitting to notarytool (this waits for Apple's servers)"
# --wait blocks until the submission finishes; on success we move on,
# on failure notarytool exits non-zero and this script exits with it.
xcrun notarytool submit "$ZIP" \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait

log "Stapling notarization ticket to Xarji.app"
xcrun stapler staple "$BUILD_DIR/Xarji.app"
xcrun stapler validate "$BUILD_DIR/Xarji.app"

# Verify the signature + Gatekeeper assessment while the .app is still
# loose (easier to debug than inside a DMG).
log "Verifying signature + Gatekeeper assessment"
codesign --verify --deep --strict --verbose=2 "$BUILD_DIR/Xarji.app"
spctl --assess --type execute --verbose "$BUILD_DIR/Xarji.app"

# -------- DMG --------

DMG="$RELEASE_DIR/Xarji-$VERSION.dmg"
CHECKSUM="$RELEASE_DIR/Xarji-$VERSION.dmg.sha256"

log "Building DMG at $DMG"
DMG_STAGE=$(mktemp -d -t xarji-dmg-XXXXXX)
trap 'rm -rf "$DMG_STAGE"' EXIT

cp -R "$BUILD_DIR/Xarji.app" "$DMG_STAGE/Xarji.app"
# Drag-to-Applications convention: a symlink to /Applications in the
# DMG root so the user can install by drag-and-drop inside Finder.
ln -s /Applications "$DMG_STAGE/Applications"

rm -f "$DMG"
hdiutil create \
  -volname "Xarji $VERSION" \
  -srcfolder "$DMG_STAGE" \
  -ov \
  -format UDZO \
  "$DMG"

log "Signing the DMG"
codesign --force --sign "$APP_IDENTITY" --timestamp "$DMG"

log "Notarizing the DMG"
# Notarizing both the .app and the containing DMG is best practice:
# the .app staple lets users run it after extracting, the DMG staple
# prevents Gatekeeper from rejecting the disk image on mount.
xcrun notarytool submit "$DMG" \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait

log "Stapling the DMG"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

log "Computing checksum"
(cd "$RELEASE_DIR" && shasum -a 256 "Xarji-$VERSION.dmg" > "Xarji-$VERSION.dmg.sha256")

log "Done."
printf "\n  DMG:       %s\n" "$DMG"
printf "  checksum:  %s\n" "$CHECKSUM"
printf "  version:   %s\n" "$VERSION"
printf "  tag:       %s (not yet pushed)\n\n" "$TAG"
