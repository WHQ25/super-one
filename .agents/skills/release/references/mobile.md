# Mobile release

The mobile app (`apps/mobile`, Expo) ships two ways, and **Decide** picks
between them per platform — nobody names it:

| Ships | When | Workflow |
|---|---|---|
| **OTA** — the JS bundle, to apps already installed | a shipped build has this platform's runtime fingerprint | `update-mobile.yml` |
| **Native** — Android APK to R2, iOS to TestFlight | the fingerprint moved (native module, config plugin, `eas.json`) | `release-mobile.yml` |

Two entry points run the same decision: an alpha desktop release (`desktop.md`
Step 1, everything rides along in that release) and `/release mobile` for a
mobile-only update between desktop releases (the flow below).

**There is no alpha/stable here.** One app (`com.superone.superone_remote`),
version `1.0.0`-style in `apps/mobile/app.json`, one shared build code in
`apps/mobile/build-code.js`. What differs per platform is fixed, not chosen:
Android's installable APK is built with the `internal` profile and updated on the
`internal` channel; iOS is built with `production` and updated on `production`.
The two platforms are decided and shipped independently: one can take an OTA
while the other takes a binary.

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

Read `apps/mobile/docs/agent-reference/native-builds.md` → **Native-binary updates** when something below
does not add up; it is the design record.

---

## Decide (per platform)

Run for `android` (channel `internal`) and `ios` (channel `production`):

1. **Baseline**: whichever is newer of the last OTA on the platform's channel and
   the last native build tag `mobile/<platform>/v*` —
   ```bash
   cd apps/mobile
   GROUP=$(bunx eas-cli@24.0.0 update:list --branch <channel> --limit 1 --json --non-interactive | jq -r '.currentPage[0].group')
   bunx eas-cli@24.0.0 update:view "$GROUP" --json | jq -r '.[0].gitCommitHash'
   git tag -l 'mobile/<platform>/v*' --sort=-creatordate | head -1
   ```
   (`update:list` does not carry the commit; `update:view` does.) Compare the two
   with `git merge-base --is-ancestor`; the descendant is the baseline.
2. **What goes out**: commits since the baseline touching the mobile closure —
   ```bash
   git log --oneline --no-decorate <baseline>..HEAD -- \
     ':/apps/mobile' ':/packages/chat-view' ':/packages/chat-core' ':/packages/relay-client' ':/packages/shared'
   ```
   The `:/` prefix anchors the paths at the repo root; item 1 and 3 run inside
   `apps/mobile`, where bare paths silently match nothing and read as `nothing`.
   Empty → `nothing` for this platform.
3. **Runtime check** — the same guard `update-mobile.yml` runs:
   ```bash
   cd apps/mobile
   HASH=$(bunx @expo/fingerprint fingerprint:generate --platform <platform> | jq -r .hash)
   bunx eas-cli@24.0.0 build:list --platform <platform> --channel <channel> --status finished \
     --fingerprint-hash "$HASH" --limit 1 --json --non-interactive \
     | jq -r '.[0].appBuildVersion // "NOT SHIPPED"'
   ```
   A build number → **OTA** onto that build. `NOT SHIPPED` → **native**: an OTA
   would publish to a runtime nobody runs.

Report one line per platform: `android: OTA (runtime = build 29, 6 commits since
a7729d22)`, `ios: native → build 30 (fingerprint 8171a5f1 not shipped)`, or
`android: nothing (no mobile commits since <baseline>)`.

## `/release mobile`

1. Run **Decide**. Both platforms `nothing` → say so and stop. Otherwise start
   the local CI gate (`SKILL.md` → **Shared rules**) and let it finish before
   the confirmation.
2. For a native platform, work out the numbers in **Native → Step 1**. For OTA,
   the message is the subject of the most recent commit from Decide item 2 (or a
   one-line summary when several matter); it is recorded on the EAS update group
   and the commit hash is recorded automatically.
3. Show the CI results, the per-platform lines, the commit list, and the
   numbers / message in one plain message and ask "Publish this?" — the only prompt in the flow.
4. Native platforms: **Native → Step 2** (commit + push), then both dispatches
   (**OTA → Dispatch**, **Native → Step 3**) and their monitoring, verification
   and report.

## OTA

### Dispatch

```bash
SHA=$(git rev-parse HEAD)   # what was reviewed, not "main" — main may move before the runner checks out
gh workflow run update-mobile.yml --ref main \
  -f platform=<the OTA platforms: android, ios or both> \
  -f android_channel=internal -f ios_channel=production \
  -f message="<message>" -f ref="$SHA" -f dry_run=false
sleep 8; gh run list --workflow=update-mobile.yml --limit 1 --json databaseId,url -q '.[0]'
```

`dry_run=false` straight away: **Decide** already did the runtime check, and the
workflow repeats it before publishing. `HEAD` must be pushed first.

### Monitor + verify

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

### Report

Per platform: channel, update group id, runtime (= which build it lands on). State
the delivery rule: the app downloads on its next launch and applies on the launch
after — there is no in-app "update now".

### Recovery

| Failure | Action |
|---|---|
| `Verify a shipped build runs this runtime` fails | The fingerprint moved since the last binary. Nothing to fix in the workflow — **Decide** ran before the fingerprint moved; re-run it — that platform now needs a native build, and the binary carries this JS |
| `Publish update` fails | Inspect `gh run view <id> --log-failed`. `EXPO_TOKEN` and the EAS project are the usual suspects. Re-dispatch is safe — a failed publish creates no group |
| Published, then found broken | Publish the fix the same way (a new group supersedes), or `eas update:republish --group <last-good>` from `apps/mobile` to put the previous group back at the channel head |
| Need to see what a runner would do without publishing | Dispatch with `dry_run=true`: runs the guard and `expo export` per platform |

---

## Native

For the platforms **Decide** marked native: a build-code commit, then **one
dispatch** of `release-mobile.yml` with `platform=` those platforms (`both` when
both moved). The workflow carries a profile per platform (`android_profile`
defaults to `internal`, `ios_profile` to `production`), builds from one `ref`, and
tags `mobile/<platform>/…` at that commit.

### Step 1: Numbers

1. Read `version` from `apps/mobile/app.json` and `BUILD_CODE` from
   `apps/mobile/build-code.js`, and the published state:
   ```bash
   curl -s https://dl.super-one.dev/mobile/android/latest.json | jq '{version, buildCode, minSupportedBuildCode}'
   curl -s https://dl.super-one.dev/mobile/ios/latest.json     | jq '{version, buildCode, minSupportedBuildCode}'
   ```
2. **Build code**: one above the highest of `BUILD_CODE` and both published
   `buildCode`s. The platforms' published codes may differ after a
   single-platform build; the next build of the other one simply skips ahead.
3. **Version**: unchanged. The app is pre-launch and ships `1.0.0` until the
   launch; decide the post-launch rule then.
4. `min_supported_build_code` stays **blank**: blank inherits the published
   floor. Raising it locks older builds out with no client-side way back, so it
   is set only when the user asks.
5. Confirmation line: `ios: 1.0.0 (29) → 1.0.0 (30)`, the floor (`inherit <N>`)
   and the profile (android/internal, ios/production).

### Step 2: Bump, commit, push

1. `apps/mobile/build-code.js` → `const BUILD_CODE = <N+1>`. `app.json` stays.
2. Nothing else: no CHANGELOG (the mobile app has none; the desktop CHANGELOG is
   the desktop line), no `bun.lock`, no tag — the workflow tags the build's
   commit after it publishes.
3. ```bash
   git add apps/mobile/build-code.js
   git commit -m "chore(mobile): bump to <version> (build <N+1>)"
   git push origin main
   SHA=$(git rev-parse HEAD)
   ```

### Step 3: Dispatch

```bash
gh workflow run release-mobile.yml --ref main -f platform=<the native platforms: android, ios or both> -f ref="$SHA" -f dry_run=false
sleep 8; gh run list --workflow=release-mobile.yml --limit 1 --json databaseId,url -q '.[0]'
```

Leave `android_profile` / `ios_profile`, `min_supported_build_code` and
`testflight_url` at their defaults unless Step 1 said otherwise. With `both`, the two platform
jobs run in parallel inside the one run; each holds its own concurrency group,
so a later single-platform re-dispatch still queues behind it.

### Step 4: Monitor

```bash
gh run watch <run-id> --exit-status
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

The run URL, the two tags, the manifests' `version (buildCode)`, and that
Android installs prompt from the manifest while iOS users install from
TestFlight once processing completes. If the reason for the binary was a
fingerprint move, say that OTA is unblocked again from this build onward.

### Recovery

| Failure | Action |
|---|---|
| `build code <N+1> does not advance the published <M>` | Step 2 was skipped or a newer binary shipped in between. Bump `build-code.js` past `M`, commit, re-dispatch with the new `ref` |
| App Store Connect rejects the build number | Same cause on the iOS side (a `CFBundleVersion` it has seen). Bump again; the Android run is unaffected |
| One platform job red, the other green | They are independent jobs. `gh run rerun <run-id> --failed` re-runs the red one on the same `ref` (same build code, same commit for both tags). If the fix has to be in the tree, bump the build code again and dispatch fresh — the green platform's build code must not be reused either |
| Need to re-point Android at an older build (rollback) | `gh workflow run release-mobile.yml -f platform=android -f build_id=<older EAS build id> -f dry_run=false` — `platform=android` only: `build_id` is refused by the iOS job. Skips the EAS queue and rewrites `latest.json` at that build. iOS has no equivalent; TestFlight keeps every build |
| iOS job fails at `Check inputs` with `cannot be submitted to TestFlight` | `ios_profile` was not `production`. Nothing was queued; re-dispatch with the default |
| Wrong `min_supported_build_code` published | Re-dispatch with `build_id=<same build>` and the corrected number — lowering is allowed; that is how a floor set too high is undone |

---

## Invariants

- **OTA never ships a native change.** The fingerprint guard in
  `update-mobile.yml` is the enforcement; **Decide** runs the same check locally so
  the answer precedes the confirmation, not the CI failure.
- **One build code counter, bumped by hand** in `build-code.js`, always past
  the highest published code on either platform. Never turn `autoIncrement` back
  on. A platform only gets a binary when its fingerprint moved; the other takes
  an OTA, so the two published codes may differ.
- **One dispatch per release builds every platform that needs a binary from one
  `ref`**, so the tags for one build code name one commit.
- **Android `internal`, iOS `production`** — for builds and for update channels
  alike. A one-off elsewhere is a typed workflow input, never a default.
- **`min_supported_build_code` is inherited unless typed.** Raising it locks
  every older build out with no client-side way back.
- **Mobile tags live under `mobile/<platform>/`, never `v*`** — that namespace is
  the desktop line. Tags are created by the workflow after publishing, never
  pushed from local.
