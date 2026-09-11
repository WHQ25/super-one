# Mobile release

The mobile app (`apps/mobile`, Expo) ships two ways, and the first argument after
`mobile` picks which:

| Command | What ships | Workflow |
|---|---|---|
| `/release mobile ota` | The JS bundle only, to apps already installed | `update-mobile.yml` |
| `/release mobile major\|feature\|patch\|build` | A native binary: Android APK to R2, iOS to TestFlight | `release-mobile.yml` |

**There is no alpha/stable here.** One app (`com.superone.superone_remote`),
version `1.0.0`-style in `apps/mobile/app.json`, one shared build code in
`apps/mobile/build-code.js`. What differs per platform is fixed, not chosen:
Android's installable APK is built with the `internal` profile and updated on the
`internal` channel; iOS is built with `production` and updated on `production`.

Two facts decide which of the two you can use:

- **The runtime version is a fingerprint** of everything shaping the native binary
  (`runtimeVersion.policy: fingerprint`; `fingerprint.config.js` excludes the
  version fields, so a version / build-code bump alone does **not** move it). An
  OTA reaches an install only if some shipped build has the same fingerprint.
  Anything that changes it — a native dependency, a config plugin, `eas.json` —
  needs a binary.
- **The build code is bumped by hand** in `build-code.js`. EAS's remote counter
  is per platform and drifted (Android 5 vs iOS 21), so both platforms read one
  local number. The publish script refuses a build code that does not advance
  the published one, and App Store Connect rejects a repeated `CFBundleVersion`,
  so a forgotten bump fails loudly rather than shipping.

Read `apps/mobile/CLAUDE.md` → **Native-binary updates** when something below
does not add up; it is the design record.

---

## OTA (`/release mobile ota`)

No version bump, no commit. Fingerprint check → one dispatch → verify.

### Step 1: Confirm (single turn)

1. **Baseline**: the commit of the last published update on each channel —
   ```bash
   cd apps/mobile
   GROUP=$(bunx eas-cli@24.0.0 update:list --branch internal --limit 1 --json --non-interactive | jq -r '.currentPage[0].group')
   bunx eas-cli@24.0.0 update:view "$GROUP" --json | jq -r '.[0].gitCommitHash'
   ```
   (`update:list` does not carry the commit; `update:view` does.) If there has
   never been an update on the channel, use the shipped build's commit from the
   `mobile/<platform>/v<version>-build<N>` tag instead.
2. **What goes out**: commits since that baseline touching the mobile closure —
   ```bash
   git log --oneline --no-decorate <baseline>..HEAD -- \
     apps/mobile packages/chat-view packages/chat-core packages/relay-client packages/shared
   ```
   Empty → there is nothing to publish; say so and stop.
3. **Runtime check, per platform** — the same guard the workflow runs, done here
   so the answer is on the table before anyone confirms:
   ```bash
   cd apps/mobile
   for P in android ios; do
     case $P in android) CH=internal ;; ios) CH=production ;; esac
     HASH=$(bunx @expo/fingerprint fingerprint:generate --platform $P | jq -r .hash)
     bunx eas-cli@24.0.0 build:list --platform $P --channel $CH --status finished \
       --fingerprint-hash "$HASH" --limit 1 --json --non-interactive \
       | jq -r --arg p $P --arg h "$HASH" '.[0] | "\($p): \($h[0:8]) → " + (if . then "build \(.appBuildVersion)" else "NOT SHIPPED" end)'
   done
   ```
   Both shipped → OTA for `both`. One shipped → OTA for that platform only, and
   the other needs a binary. Neither → stop: **this change needs
   `/release mobile <bump>`**, an OTA would publish to a runtime nobody runs.
4. **Message**: the subject of the most recent commit from item 2 (or a one-line
   summary when several matter). It is recorded on the EAS update group and is
   what `eas update:list` shows later; the commit hash is recorded automatically.
5. Show, in one plain message: the platform(s), the runtime line per platform
   (`android: 8171a5f1 → build 22`), the commit list, and the message. Ask
   "Publish this?" — the only prompt in the flow.

### Step 2: Dispatch

```bash
SHA=$(git rev-parse HEAD)   # what was reviewed, not "main" — main may move before the runner checks out
gh workflow run update-mobile.yml --ref main \
  -f platform=<both|android|ios> \
  -f android_channel=internal -f ios_channel=production \
  -f message="<message>" -f ref="$SHA" -f dry_run=false
sleep 8; gh run list --workflow=update-mobile.yml --limit 1 --json databaseId,url -q '.[0]'
```

`dry_run=false` straight away: Step 1 already did the runtime check, and the
workflow repeats it before publishing. `HEAD` must be pushed first.

### Step 3: Monitor + verify

```bash
gh run watch <run-id> --exit-status      # ~4 min; the guard is the step before "Publish update"
```

Then confirm the channel head is the new group and names the reviewed commit:

```bash
cd apps/mobile
GROUP=$(bunx eas-cli@24.0.0 update:list --branch internal --limit 1 --json --non-interactive | jq -r '.currentPage[0].group')
bunx eas-cli@24.0.0 update:view "$GROUP" --json | jq -r '.[0] | "\(.platform) \(.group) \(.gitCommitHash[0:8]) runtime \(.runtimeVersion[0:8])"'
# same for --branch production
```

### Step 4: Report

Per platform: channel, update group id, runtime (= which build it lands on). State
the delivery rule: the app downloads on its next launch and applies on the launch
after — there is no in-app "update now".

### Recovery

| Failure | Action |
|---|---|
| `Verify a shipped build runs this runtime` fails | The fingerprint moved since the last binary. Nothing to fix in the workflow — ship `/release mobile <bump>`; the new binary carries this JS, no OTA needed afterwards |
| `Publish update` fails | Inspect `gh run view <id> --log-failed`. `EXPO_TOKEN` and the EAS project are the usual suspects. Re-dispatch is safe — a failed publish creates no group |
| Published, then found broken | Publish the fix the same way (a new group supersedes), or `eas update:republish --group <last-good>` from `apps/mobile` to put the previous group back at the channel head |
| Need to see what a runner would do without publishing | Dispatch with `dry_run=true`: runs the guard and `expo export` per platform |

---

## Native (`/release mobile major|feature|patch|build`)

A version bump commit, then **two dispatches** of `release-mobile.yml` — one per
platform, because the workflow takes a single `profile` and the platforms need
different ones (`internal` for the APK, `production` for TestFlight). Both use the
same `ref`, so the two `mobile/<platform>/…` tags name one commit.

### Step 1: Confirm (single turn)

1. Read `version` from `apps/mobile/app.json` and `BUILD_CODE` from
   `apps/mobile/build-code.js`. Read the published state:
   ```bash
   curl -s https://dl.super-one.dev/mobile/android/latest.json | jq '{version, buildCode, minSupportedBuildCode}'
   curl -s https://dl.super-one.dev/mobile/ios/latest.json     | jq '{version, buildCode, minSupportedBuildCode}'
   ```
2. Commits since the last native build, mobile closure only:
   ```bash
   git log --oneline --no-decorate mobile/android/v<version>-build<N>..HEAD -- \
     apps/mobile packages/chat-view packages/chat-core packages/relay-client packages/shared
   ```
   Derive the recommended position from their types (table in `SKILL.md`) and
   show it beside the argument; the argument ships.
3. New numbers:
   - `major` / `feature` / `patch`: bump `app.json` `version` at that position;
     `BUILD_CODE + 1`.
   - `build`: `version` unchanged; `BUILD_CODE + 1`. This is the usual native
     re-ship — a fingerprint moved (new native module, config plugin) and the
     user-facing version has no reason to change.
   The new build code must be greater than **both** published `buildCode`s.
4. `min_supported_build_code` stays **blank** unless the user asked to lock old
   builds out; blank inherits the published floor. Raising it has no client-side
   way back — it is a decision, never a default.
5. Show: `1.0.0 (22) → 1.0.1 (23)` with the position used, the recommendation
   if it differs, the commit list, the floor (`inherit <N>`), and that two
   dispatches follow (android/internal, ios/production). Ask "Proceed?".

### Step 2: Bump, commit, push

1. `apps/mobile/app.json` → `version` (not for `build`).
2. `apps/mobile/build-code.js` → `const BUILD_CODE = <N+1>`.
3. Nothing else: no CHANGELOG (the mobile app has none; the desktop CHANGELOG is
   the desktop line), no `bun.lock`, no tag — the workflow tags the build's
   commit after it publishes.
4. ```bash
   git add apps/mobile/app.json apps/mobile/build-code.js
   git commit -m "chore(mobile): bump to <version> (build <N+1>)"
   git push origin main
   SHA=$(git rev-parse HEAD)
   ```

### Step 3: Dispatch — twice, same `ref`

```bash
gh workflow run release-mobile.yml --ref main -f platform=android -f profile=internal   -f ref="$SHA" -f dry_run=false
gh workflow run release-mobile.yml --ref main -f platform=ios     -f profile=production -f ref="$SHA" -f dry_run=false
sleep 8; gh run list --workflow=release-mobile.yml --limit 2 --json databaseId,url,displayTitle
```

Leave `min_supported_build_code` and `testflight_url` at their defaults unless
Step 1 said otherwise. The concurrency group is per platform, so the two runs
proceed in parallel.

### Step 4: Monitor

```bash
gh run watch <android-run-id> --exit-status
gh run watch <ios-run-id> --exit-status
```

Wall clock is the EAS queue plus the build: Android typically 15–25 min, iOS
20–40 min, then `eas submit` hands the IPA to App Store Connect. **TestFlight
processing continues after the run is green** (a few minutes to an hour); the
public link already points at the group, and Beta App Review has been passed
once — later builds do not wait for it.

### Step 5: Verify

```bash
curl -s https://dl.super-one.dev/mobile/android/latest.json | jq '{version, buildCode, artifact: .artifact.url}'
curl -s https://dl.super-one.dev/mobile/ios/latest.json     | jq '{version, buildCode, testflightUrl}'
git fetch origin --tags
git tag -l 'mobile/*/v<version>-build<N+1>'      # expect both platforms, both → $SHA
```

`buildCode` must read `<N+1>` on both; the Android `artifact.url` is the
immutable `superone-v<version>-build<N+1>.apk`.

### Step 6: Report

Both run URLs, the two tags, the manifests' `version (buildCode)`, and that
Android installs prompt from the manifest while iOS users install from
TestFlight once processing completes. If the reason for the binary was a
fingerprint move, say that OTA is unblocked again from this build onward.

### Recovery

| Failure | Action |
|---|---|
| `build code <N+1> does not advance the published <M>` | Step 2 was skipped or a newer binary shipped in between. Bump `build-code.js` past `M`, commit, re-dispatch with the new `ref` |
| App Store Connect rejects the build number | Same cause on the iOS side (a `CFBundleVersion` it has seen). Bump again; the Android run is unaffected |
| Android run green, iOS run red (or vice versa) | They are independent. Fix and re-dispatch only the red platform with the **same `ref`** so both tags still name one commit |
| Need to re-point Android at an older build (rollback) | `gh workflow run release-mobile.yml -f platform=android -f profile=internal -f build_id=<older EAS build id> -f dry_run=false` — skips the EAS queue and rewrites `latest.json` at that build. iOS has no equivalent; TestFlight keeps every build |
| `profile` was `internal` on the iOS dispatch | An ad-hoc IPA that `eas submit` cannot send to TestFlight. Re-dispatch iOS with `profile=production`; nothing was published |
| Wrong `min_supported_build_code` published | Re-dispatch with `build_id=<same build>` and the corrected number — lowering is allowed; that is how a floor set too high is undone |

---

## Invariants

- **OTA never ships a native change.** The fingerprint guard in
  `update-mobile.yml` is the enforcement; Step 1 runs the same check locally so
  the answer precedes the confirmation, not the CI failure.
- **One build code, both platforms, bumped by hand** in `build-code.js`. Never
  turn `autoIncrement` back on and never bump only one platform's number.
- **Both native dispatches use the same `ref`**, so
  `mobile/android/v…` and `mobile/ios/v…` for one build code name one commit.
- **Android `internal`, iOS `production`** — for builds and for update channels
  alike. A one-off elsewhere is a typed workflow input, never a default.
- **`min_supported_build_code` is inherited unless typed.** Raising it locks
  every older build out with no client-side way back.
- **Mobile tags live under `mobile/<platform>/`, never `v*`** — that namespace is
  the desktop line. Tags are created by the workflow after publishing, never
  pushed from local.
