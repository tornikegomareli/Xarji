# Release pipeline

Local-only tooling for cutting a signed, notarized Xarji release. Nothing in this
directory runs on CI and no credentials ever leave the releaser's Mac — the
signing certificate lives in the login Keychain and the notary password lives
behind `xcrun notarytool store-credentials`.

## One-time setup on your Mac

1. **Enroll in the Apple Developer Program** and issue a *Developer ID
   Application* certificate. The fastest path is Xcode → Settings → Accounts →
   Manage Certificates → + → *Developer ID Application*. When it lands, verify
   with

   ```
   security find-identity -v -p codesigning
   ```

   Copy the common name (the part in quotes after the SHA-1, e.g.
   `Developer ID Application: Tornike Gomareli (XXXXXXXXXX)`). That string is
   the value of `APP_IDENTITY` below.

2. **Generate an app-specific password** for notarization at
   <https://appleid.apple.com> → Sign-In and Security → App-Specific Passwords.
   Label it something like `xarji-notary`.

3. **Store the notary password in the Keychain** so it never touches a file:

   ```
   xcrun notarytool store-credentials "xarji-notary" \
     --apple-id you@example.com \
     --team-id XXXXXXXXXX \
     --password <app-specific-password>
   ```

   `"xarji-notary"` is the profile label — you'll reference it later as
   `NOTARY_PROFILE`.

4. **Copy the env template** and fill it in with your cert name + profile
   label:

   ```
   cp scripts/release/.release.env.example scripts/release/.release.env
   $EDITOR scripts/release/.release.env
   ```

   `.release.env` is gitignored. Nothing in it is a real secret — the Keychain
   holds the actual password; this file just tells the build script which
   Keychain entry to use.

## Cutting a release

The happy path is one command:

```
./scripts/release/release.sh 0.2.0
```

Which does, in order:

1. Runs `build.sh` — client build, embed, service binary, signed + notarized
   `.app`, signed + notarized DMG, stapled, checksummed. Output lands in
   `dist/releases/0.2.0/`.
2. Creates + pushes the annotated git tag `v0.2.0`. `release.yml` reacts to
   the tag push and creates an empty GitHub Release with auto-generated notes.
3. Runs `publish.sh` — waits for the Release to appear, then
   `gh release upload`s the DMG + checksum to it.

If you want manual control between stages:

```
./scripts/release/build.sh 0.2.0      # produces the DMG, doesn't push anything
# inspect dist/releases/0.2.0/ — audit the signature, try the DMG
./scripts/release/release.sh 0.2.0    # (or tag + publish separately)
```

`build.sh` is safe to re-run with the same version if something fails
mid-way — nothing is pushed until stage 2.

## What each script does

| Script | Does | Touches GitHub? |
|---|---|---|
| `build.sh <v>` | builds signed DMG locally | no |
| `publish.sh <v>` | attaches DMG to existing Release | yes (upload) |
| `release.sh <v>` | chains build → tag → publish | yes (tag + upload) |
| `../build-dev.sh` | unsigned local build for contributors | no |

## Unsigned local builds (no Apple Developer account needed)

```
./scripts/build-dev.sh
```

Produces `dist/dev/Xarji.app` + `dist/dev/Xarji-dev.dmg`, ad-hoc signed. macOS
Gatekeeper warns "unidentified developer" on first launch — right-click →
Open bypasses it. This is what contributors without signing creds should use
to smoke-test their changes end-to-end.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Signing cert '...' not found in login keychain` | typo in `APP_IDENTITY`, or the cert is on a different Keychain | run `security find-identity -v -p codesigning` and paste the exact name |
| `notarytool profile '...' missing or invalid` | you never ran `store-credentials`, or the app-specific password was revoked | re-run `xcrun notarytool store-credentials ...` |
| notarization hangs > 5 min | Apple's servers are slow that day, OR the `.app` has a banned entitlement | `xcrun notarytool history --keychain-profile xarji-notary` to see status |
| `spctl --assess` fails after staple | ticket hasn't propagated yet | wait ~60 s and rerun `xcrun stapler staple` |
| `Release vX.Y.Z never appeared` in publish.sh | `release.yml` workflow failed | check Actions tab, fix the workflow, then `gh release upload` manually |
