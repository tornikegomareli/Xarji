#!/usr/bin/env bash
# Assemble Xarji.app out of the SwiftPM build output + the compiled
# Bun service (xarji-core). Unsigned by default — PR 4 will layer on
# the `codesign` + `notarytool` pipeline.
#
# Usage:
#   ./Scripts/package_app.sh [release|debug]
#
# Environment overrides:
#   APP_NAME=Xarji                    bundle and binary name
#   BUNDLE_ID=app.xarji.menubar       CFBundleIdentifier
#   XARJI_CORE_BINARY=path            path to the prebuilt xarji-core
#                                     (default: ../service/dist/xarji)
#   SIGNING_MODE=adhoc|identity       code-signing mode (adhoc default)
#   APP_IDENTITY="Developer ID ..."   only when SIGNING_MODE=identity

set -euo pipefail

CONF=${1:-release}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
REPO_ROOT=$(cd "$ROOT/.." && pwd)
cd "$ROOT"

APP_NAME=${APP_NAME:-Xarji}
BUNDLE_ID=${BUNDLE_ID:-app.xarji.menubar}
MACOS_MIN_VERSION=${MACOS_MIN_VERSION:-13.0}
SIGNING_MODE=${SIGNING_MODE:-adhoc}
APP_IDENTITY=${APP_IDENTITY:-}
XARJI_CORE_BINARY=${XARJI_CORE_BINARY:-"$REPO_ROOT/service/dist/xarji"}

# Capture caller-provided values before sourcing version.env. Without
# this guard `source` silently overwrites env vars the caller set, so
# the release pipeline in scripts/release/build.sh would ship a bundle
# stamped with whatever version.env holds instead of the version it
# asked for.
ENV_MARKETING_VERSION=${MARKETING_VERSION:-}
ENV_BUILD_NUMBER=${BUILD_NUMBER:-}

if [[ -f "$ROOT/version.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/version.env"
fi

MARKETING_VERSION=${ENV_MARKETING_VERSION:-${MARKETING_VERSION:-0.1.0}}
BUILD_NUMBER=${ENV_BUILD_NUMBER:-${BUILD_NUMBER:-1}}

# Apple Silicon only — the whole app is single-arch by design.
ARCH_LIST=( "arm64" )

echo "==> swift build -c $CONF --arch arm64"
swift build -c "$CONF" --arch arm64

# Stage the app bundle in a dedicated dist/ dir so repeated runs
# don't overwrite each other and so .gitignore can scope cleanly.
DIST_DIR="$ROOT/dist"
mkdir -p "$DIST_DIR"
APP="$DIST_DIR/${APP_NAME}.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

BUILD_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")

# LSUIElement=true hides the Dock icon so the app is menu-bar-only.
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>${APP_NAME}</string>
    <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
    <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
    <key>CFBundleExecutable</key><string>XarjiMenuBar</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>${MARKETING_VERSION}</string>
    <key>CFBundleVersion</key><string>${BUILD_NUMBER}</string>
    <key>LSMinimumSystemVersion</key><string>${MACOS_MIN_VERSION}</string>
    <key>LSUIElement</key><true/>
    <key>NSHighResolutionCapable</key><true/>
    <key>BuildTimestamp</key><string>${BUILD_TIMESTAMP}</string>
    <key>GitCommit</key><string>${GIT_COMMIT}</string>
</dict>
</plist>
PLIST

# Copy the SwiftPM executable into the bundle.
SWIFT_BIN=".build/arm64-apple-macosx/$CONF/XarjiMenuBar"
if [[ ! -x "$SWIFT_BIN" ]]; then
  echo "ERROR: Swift build artefact not found at $SWIFT_BIN" >&2
  exit 1
fi
cp "$SWIFT_BIN" "$APP/Contents/MacOS/XarjiMenuBar"
chmod +x "$APP/Contents/MacOS/XarjiMenuBar"

# Drop the compiled Bun service alongside. The menu-bar app Process-
# spawns this on launch; see CoreProcess.swift resolveCoreBinary().
if [[ ! -x "$XARJI_CORE_BINARY" ]]; then
  echo "ERROR: xarji-core binary not found at $XARJI_CORE_BINARY" >&2
  echo "       Run 'cd service && bun run build:embed && bun run build:binary' first, or set XARJI_CORE_BINARY." >&2
  exit 1
fi
cp "$XARJI_CORE_BINARY" "$APP/Contents/MacOS/xarji-core"
chmod +x "$APP/Contents/MacOS/xarji-core"

# Bundle any SwiftPM .bundle resources next to the executable.
BUILD_DIR=".build/arm64-apple-macosx/$CONF"
shopt -s nullglob
SWIFTPM_BUNDLES=("${BUILD_DIR}/"*.bundle)
shopt -u nullglob
if [[ ${#SWIFTPM_BUNDLES[@]} -gt 0 ]]; then
  for bundle in "${SWIFTPM_BUNDLES[@]}"; do
    cp -R "$bundle" "$APP/Contents/Resources/"
  done
fi

# Remove extended attributes so codesign / Gatekeeper don't complain
# about AppleDouble files. Cheap even in the adhoc path.
chmod -R u+w "$APP"
xattr -cr "$APP"
find "$APP" -name '._*' -delete

# Ad-hoc sign by default so the binary can actually run without the
# "unidentified developer" Gatekeeper warning on the dev's own machine.
# PR 4 will swap this for Developer ID signing + notarization.
if [[ "$SIGNING_MODE" == "identity" && -n "$APP_IDENTITY" ]]; then
  CODESIGN_ARGS=(--force --timestamp --options runtime --sign "$APP_IDENTITY")
else
  CODESIGN_ARGS=(--force --sign "-")
fi

# Sign the inner xarji-core first so the outer signature covers it.
codesign "${CODESIGN_ARGS[@]}" "$APP/Contents/MacOS/xarji-core"
codesign "${CODESIGN_ARGS[@]}" "$APP"

echo ""
echo "Created $APP"
echo "  version:  ${MARKETING_VERSION} (${BUILD_NUMBER})"
echo "  commit:   ${GIT_COMMIT}"
echo "  signing:  ${SIGNING_MODE}"
