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

# Generate the .icns from the committed PNG so the source of truth
# stays a PNG (editable) and the binary .icns gets regenerated per
# build. sips resizes for each slot macOS wants; iconutil bundles them.
ICON_SRC="$ROOT/AppIcon.png"
ICON_PLIST_KEY=""
if [[ -f "$ICON_SRC" ]]; then
  ICONSET_DIR=$(mktemp -d -t xarji-iconset-XXXXXX)
  # iconutil expects these exact filenames — don't rename them.
  sips -z 16 16     "$ICON_SRC" --out "$ICONSET_DIR/icon_16x16.png"      >/dev/null
  sips -z 32 32     "$ICON_SRC" --out "$ICONSET_DIR/icon_16x16@2x.png"   >/dev/null
  sips -z 32 32     "$ICON_SRC" --out "$ICONSET_DIR/icon_32x32.png"      >/dev/null
  sips -z 64 64     "$ICON_SRC" --out "$ICONSET_DIR/icon_32x32@2x.png"   >/dev/null
  sips -z 128 128   "$ICON_SRC" --out "$ICONSET_DIR/icon_128x128.png"    >/dev/null
  sips -z 256 256   "$ICON_SRC" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
  sips -z 256 256   "$ICON_SRC" --out "$ICONSET_DIR/icon_256x256.png"    >/dev/null
  sips -z 512 512   "$ICON_SRC" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
  sips -z 512 512   "$ICON_SRC" --out "$ICONSET_DIR/icon_512x512.png"    >/dev/null
  sips -z 1024 1024 "$ICON_SRC" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null
  mv "$ICONSET_DIR" "${ICONSET_DIR}.iconset"
  iconutil -c icns "${ICONSET_DIR}.iconset" -o "$APP/Contents/Resources/AppIcon.icns"
  rm -rf "${ICONSET_DIR}.iconset"
  ICON_PLIST_KEY="    <key>CFBundleIconFile</key><string>AppIcon</string>"
else
  echo "WARN: no AppIcon.png at $ICON_SRC — building without a bundle icon"
fi

# Sparkle 2 expects SUPublicEDKey to be either absent OR a valid base64
# EdDSA key. Emitting `<string></string>` is treated as a malformed
# configuration: SPUStandardUpdaterController fails startup with a fatal
# updater alert and disables manual checks. So conditionally inject the
# key only when the env var is non-empty — leaving it out entirely makes
# Sparkle treat the build as "no signature verification configured yet,"
# which is the correct state for a Phase 1 build that has the framework
# embedded but no signing pipeline yet. (Codex P2 on PR #39.)
SPARKLE_KEY_PLIST=""
if [[ -n "${SPARKLE_PUBLIC_KEY:-}" ]]; then
  SPARKLE_KEY_PLIST="    <key>SUPublicEDKey</key><string>${SPARKLE_PUBLIC_KEY}</string>"
else
  echo "WARN: SPARKLE_PUBLIC_KEY is empty — SUPublicEDKey omitted from Info.plist."
  echo "      Sparkle's startup will warn that updates aren't EdDSA-verified."
  echo "      Set the key in .release.env before shipping a public build."
fi

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
${ICON_PLIST_KEY}
    <key>LSMinimumSystemVersion</key><string>${MACOS_MIN_VERSION}</string>
    <key>LSUIElement</key><true/>
    <key>NSHighResolutionCapable</key><true/>
    <key>BuildTimestamp</key><string>${BUILD_TIMESTAMP}</string>
    <key>GitCommit</key><string>${GIT_COMMIT}</string>
    <key>SUFeedURL</key><string>${SPARKLE_FEED_URL:-https://xarji-landing.placeholder/appcast.xml}</string>
${SPARKLE_KEY_PLIST}
    <key>SUEnableAutomaticChecks</key><true/>
    <key>SUScheduledCheckInterval</key><integer>86400</integer>
    <key>SUAutomaticallyDownloadUpdates</key><false/>
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
install_name_tool -add_rpath "@loader_path/../Frameworks" "$APP/Contents/MacOS/XarjiMenuBar"

# Drop the compiled Bun service alongside. The menu-bar app Process-
# spawns this on launch; see CoreProcess.swift resolveCoreBinary().
if [[ ! -x "$XARJI_CORE_BINARY" ]]; then
  echo "ERROR: xarji-core binary not found at $XARJI_CORE_BINARY" >&2
  echo "       Run 'cd service && bun run build:embed && bun run build:binary' first, or set XARJI_CORE_BINARY." >&2
  exit 1
fi
cp "$XARJI_CORE_BINARY" "$APP/Contents/MacOS/xarji-core"
chmod +x "$APP/Contents/MacOS/xarji-core"

# Embed Sparkle.framework. SwiftPM resolves the dependency declared in
# Package.swift and downloads the binary artefact as an xcframework. We
# embed the macos-arm64 slice into Contents/Frameworks/ so the app can
# link against it at runtime. Each helper inside the framework
# (Autoupdate, Updater.app, XPCServices) gets signed individually below
# — `codesign --deep` is deprecated for distribution signing.
SPARKLE_FW_SRC="$ROOT/.build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"
if [[ ! -d "$SPARKLE_FW_SRC" ]]; then
  echo "ERROR: Sparkle.framework not found at $SPARKLE_FW_SRC" >&2
  echo "       Run 'swift package resolve' or 'swift build' first." >&2
  exit 1
fi
mkdir -p "$APP/Contents/Frameworks"
ditto "$SPARKLE_FW_SRC" "$APP/Contents/Frameworks/Sparkle.framework"

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
if [[ "$SIGNING_MODE" == "identity" && -n "$APP_IDENTITY" ]]; then
  CODESIGN_ARGS=(--force --timestamp --options runtime --sign "$APP_IDENTITY")
else
  CODESIGN_ARGS=(--force --sign "-")
fi

# xarji-core is a Bun-compiled binary. Bun JITs JavaScript at runtime,
# which under hardened runtime requires allow-jit + allow-unsigned-
# executable-memory entitlements. Without these the child dies on
# first allocation with "Ran out of executable memory" and the menu
# bar app reports "unreachable" because nothing is listening on the
# dashboard port. Entitlements are scoped to xarji-core only — the
# Swift menu-bar shell doesn't JIT and shouldn't carry JIT rights.
CORE_ENTITLEMENTS="$ROOT/Scripts/xarji-core.entitlements"
CORE_CODESIGN_ARGS=("${CODESIGN_ARGS[@]}")
if [[ "$SIGNING_MODE" == "identity" && -f "$CORE_ENTITLEMENTS" ]]; then
  CORE_CODESIGN_ARGS+=(--entitlements "$CORE_ENTITLEMENTS")
fi

# Sign the inner xarji-core first so the outer signature covers it.
codesign "${CORE_CODESIGN_ARGS[@]}" "$APP/Contents/MacOS/xarji-core"

# Sparkle helpers: each binary inside the framework needs its own
# signature pass (Apple deprecated --deep for distribution signing).
# Inner-most binaries first, then the framework wrapper, so each
# enclosing signature transitively covers what it contains.
SPARKLE_FW="$APP/Contents/Frameworks/Sparkle.framework"
if [[ -d "$SPARKLE_FW" ]]; then
  # XPCServices ship inside Sparkle even in the non-sandboxed install:
  # the framework expects them, signing without them yields a
  # codesign --verify --deep error at notarization time.
  for xpc in "$SPARKLE_FW/Versions/B/XPCServices/"*.xpc; do
    [[ -d "$xpc" ]] || continue
    codesign "${CODESIGN_ARGS[@]}" "$xpc"
  done
  if [[ -f "$SPARKLE_FW/Versions/B/Autoupdate" ]]; then
    codesign "${CODESIGN_ARGS[@]}" "$SPARKLE_FW/Versions/B/Autoupdate"
  fi
  if [[ -d "$SPARKLE_FW/Versions/B/Updater.app" ]]; then
    codesign "${CODESIGN_ARGS[@]}" "$SPARKLE_FW/Versions/B/Updater.app"
  fi
  codesign "${CODESIGN_ARGS[@]}" "$SPARKLE_FW"
fi

codesign "${CODESIGN_ARGS[@]}" "$APP"

echo ""
echo "Created $APP"
echo "  version:  ${MARKETING_VERSION} (${BUILD_NUMBER})"
echo "  commit:   ${GIT_COMMIT}"
echo "  signing:  ${SIGNING_MODE}"
