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

**Two variants on each platform, like the desktop.** Version `1.0.0`-style in
`apps/mobile/app.json`, one shared build code in `apps/mobile/build-code.js`.
What differs is fixed, not chosen:

- **Alpha** ("SuperOne Alpha", `<release id>.alpha` on both platforms): profile
  and channel `alpha` on both, pointers `mobile/<platform>/alpha/latest.json`,
  tags `mobile/<platform>-alpha/…`. Android is a self-updating APK; iOS is its
  own App Store Connect app, TestFlight only. Every alpha release and every
  `/release mobile` ships here — it may need an alpha desktop.
- **Stable** (the release ids in `app.json`): Android profile and channel
  `internal`, iOS `production` (the existing TestFlight app, App Store at
  launch); pointers `mobile/<platform>/latest.json`, tags `mobile/<platform>/…`.
  Shipped only by a stable cut (`desktop.md` → **Cutting a stable release**).
  The workflow refuses to queue a stable build whose `MIN_PHONE_DESKTOP_VERSION`
  is above the released stable desktop.

The two platforms are decided and shipped independently: one can take an OTA
while the other takes a binary.

When accompanying a desktop release, publish only after that desktop Release
is public and set-latest succeeds. OTA platforms run through
`release.yml stage=publish`; native platforms dispatch afterwards from the same
desktop commit. A standalone `/release mobile` keeps the flow below.

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

Physical-device smoke remains recommended for native releases, not a mandatory
release gate. Use the checklist in that manual when running it and state whether
it was run; lack of a smoke record is not itself a publication blocker.

---

## Decide (per platform)

Run for `android` and `ios`, each on channel `alpha` with tag prefix
`mobile/<platform>-alpha/`:

1. **Baseline**: whichever is newer of the last OTA on the platform's channel and
   the last native build tag under its prefix —
   ```bash
   cd apps/mobile
   GROUP=$(bunx eas-cli@24.0.0 update:list --branch <channel> --limit 1 --json --non-interactive | jq -r '.currentPage[0].group')
   bunx eas-cli@24.0.0 update:view "$GROUP" --json | jq -r '.[0].gitCommitHash'
   git tag -l '<tag prefix>v*' --sort=-creatordate | head -1
   ```
   The fingerprint must be computed with `APP_VARIANT=alpha` — the variant
   identity is part of it.
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
   A build number → **OTA** onto that build. `NOT SHIPPED` is not yet native.
   `eas build --local` publishes an APK to R2 and tags
   `mobile/<platform>-alpha/v<version>-build<N>`, but it does not create an EAS
   build, so `build:list` cannot see that runtime. Before choosing native,
   resolve the published `buildCode` from `latest.json` to its tag and compare
   fingerprint inputs with the checkout:
   ```bash
   git diff --quiet <tag>..HEAD -- apps/mobile \
     ':!apps/mobile/src' ':!apps/mobile/build-code.js' \
     ':!apps/mobile/**/*.md' ':!apps/mobile/**/*.test.ts' ':!apps/mobile/**/*.test.tsx'
   ```
   An empty diff means the published binary already runs this fingerprint
   (`build-code.js` is ignored by `fingerprint.config.js`; JS under `src` is
   what an OTA ships). That platform is **OTA** onto the published build code.
   Do not bump `build-code.js`. A non-empty diff is **native**: an OTA would
   publish to a runtime nobody runs.

   `update-mobile.yml` repeats only the EAS lookup. An OTA onto a local APK
   fails that step until the guard accepts an unchanged fingerprint since the
   published native tag. Do not dispatch that OTA before the guard is updated.

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
  -f android_channel=alpha -f ios_channel=alpha \
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
GROUP=$(bunx eas-cli@24.0.0 update:list --branch alpha --limit 1 --json --non-interactive | jq -r '.currentPage[0].group')
bunx eas-cli@24.0.0 update:view "$GROUP" --json | jq -r '.[0] | "\(.platform) \(.group) \(.gitCommitHash[0:8]) runtime \(.runtimeVersion[0:8])"'
# the same group covers both platforms when both took the OTA
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
and `ios_profile` both default to `alpha`), builds from one `ref`, and tags
`mobile/<platform>-alpha/…` at that commit.

### Step 1: Numbers

1. Read `version` from `apps/mobile/app.json` and `BUILD_CODE` from
   `apps/mobile/build-code.js`, and the published state:
   ```bash
   curl -s https://dl.super-one.dev/mobile/android/alpha/latest.json | jq '{version, buildCode, minSupportedBuildCode}'
   curl -s https://dl.super-one.dev/mobile/android/latest.json       | jq '{version, buildCode, minSupportedBuildCode}'
   curl -s https://dl.super-one.dev/mobile/ios/alpha/latest.json     | jq '{version, buildCode, minSupportedBuildCode}'
   curl -s https://dl.super-one.dev/mobile/ios/latest.json           | jq '{version, buildCode, minSupportedBuildCode}'
   ```
2. **Build code**: one above the highest of `BUILD_CODE` and all published
   `buildCode`s. The platforms' published codes may differ after a
   single-platform build; the next build of the other one simply skips ahead.
3. **Version**: unchanged. The app is pre-launch and ships `1.0.0` until the
   launch; decide the post-launch rule then.
4. `min_supported_build_code` stays **blank**: blank inherits the published
   floor. Raising it locks older builds out with no client-side way back, so it
   is set only when the user asks.
5. Confirmation line: `ios: 1.0.0 (29) → 1.0.0 (30)`, the floor (`inherit <N>`)
   and the profile (alpha).

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

### Local Android APK

Use this instead of the Android half of Step 3 when the APK is built on this
machine (`eas build --local`). iOS stays on EAS, as its own dispatch with no
`apk_url`. The free EAS plan stops an Android build at 45 minutes; retrying
does not raise that cap.

`expo run:android` is not this path. It signs with the debug keystore and, for
the dev variant, a different application id. The workflow checks the package,
version name and version code against the checkout. It does not check the
signing certificate, so only `eas build --local` produces an APK that installs
over the shipped app.

1. Build from a clean checkout of the commit you will pass as `ref`. From
   `apps/mobile`, pinned to the same CLI the workflow uses:
   ```bash
   bunx eas-cli@24.0.0 build --local --platform android --profile alpha
   ```
   Stable uses `--profile internal`. The APK stays on disk; EAS does not keep a
   URL for it.
2. Stage it. Do not commit the APK, and do not attach it to the desktop Release.
   ```bash
   bun scripts/stage-local-android-apk.ts --apk <the path eas printed> --profile alpha
   ```
   A dirty mobile tree is refused: the workflow will compare the APK to `ref`,
   not to uncommitted files. If the build rewrote a tracked file, restore it
   first; the APK still has to match that commit's version and build code.
   The script prints `apk_url=gh-release:staging/android-apk/<id>/superone.apk`
   and `ref=<sha>`. That draft is not a `v*` or `mobile/*` tag.
3. Dispatch the workflow file from `main` and the app from that `ref`:
   ```bash
   gh workflow run release-mobile.yml --ref main \
     -f platform=android -f android_profile=alpha \
     -f ref="$SHA" -f apk_url="$APK_URL" -f dry_run=false
   ```
   `platform=both` or an iOS dispatch with `apk_url` set fails before EAS.
   `apk_url` and `build_id` together fail. Then Step 4–6 for Android. After a
   real publish the workflow deletes the staging draft. A dry run leaves it, so
   the real dispatch can reuse the same `apk_url`.

### Step 4: Monitor

```bash
gh run watch <run-id> --exit-status
```

Wall clock for an EAS build is the queue plus the build. iOS is typically
20–40 min, then `eas submit` hands the IPA to App Store Connect. A local
Android APK skips that queue; the job is the upload. **TestFlight
processing continues after the run is green** (a few minutes to an hour); the
public link already points at the group, and Beta App Review has been passed
once — later builds do not wait for it.

### Step 5: Verify

```bash
curl -s https://dl.super-one.dev/mobile/android/alpha/latest.json | jq '{version, buildCode, artifact: .artifact.url}'
curl -s https://dl.super-one.dev/mobile/ios/alpha/latest.json     | jq '{version, buildCode, testflightUrl}'
git fetch origin --tags
git tag -l 'mobile/*/v<version>-build<N+1>'      # expect android-alpha and ios-alpha, both → $SHA
```

`buildCode` must read `<N+1>` on both; the Android `artifact.url` is the
immutable `alpha/superone-v<version>-build<N+1>.apk`. The Android tag also has a
GitHub Release with the APK: `gh release view mobile/android-alpha/v<version>-build<N+1>`.

### Step 6: Report

The run URL, the two tags, the Android GitHub Release URL, the manifests' `version (buildCode)`, and that
Android installs prompt from the manifest while iOS users install from
TestFlight once processing completes. If the reason for the binary was a
fingerprint move, say that OTA is unblocked again from this build onward.

### Recovery

| Failure | Action |
|---|---|
| `build code <N+1> does not advance the published <M>` | Step 2 was skipped or a newer binary shipped in between. Bump `build-code.js` past `M`, commit, re-dispatch with the new `ref`. A local APK has to be rebuilt at the new code: the identity check refuses a file that does not match the checkout |
| `APK does not match this checkout` | The file was built from a different package, version or build code than `ref`. Rebuild `eas build --local` from that commit. A dev client (`.dev`) or the other track will not publish. The staging draft is still there |
| `apk_url publishes one local Android APK` / `apk_url is an Android APK` | `platform` was `ios` or `both`, or `build_id` was also set. Nothing was queued. Re-dispatch Android alone; dispatch iOS separately without `apk_url` |
| App Store Connect rejects the build number | Same cause on the iOS side (a `CFBundleVersion` it has seen). Bump again; the Android run is unaffected |
| One platform job red, the other green | They are independent jobs. `gh run rerun <run-id> --failed` re-runs the red one on the same `ref` (same build code, same commit for both tags). If the fix has to be in the tree, bump the build code again and dispatch fresh — the green platform's build code must not be reused either |
| Need to re-point a platform at an older build (rollback) | `gh workflow run release-mobile.yml -f platform=<android or ios> -f <android_profile or ios_profile>=<the build's own profile> -f build_id=<older EAS build id> -f ref=<full 40-char SHA> -f dry_run=false` — one platform per dispatch (a build id belongs to one). Skips the EAS queue and rewrites that track's `latest.json` at that build; a profile mismatch is refused. iOS submits nothing, so the build must still be installable in TestFlight, and TestFlight still offers its newest build: expire the bad ones in App Store Connect too. Phones already on a newer build stay there. **For stable, pick the build tagged at the stable desktop's own commit** (`git rev-parse mobile/<platform>/v1.0.0-build<N>^{commit}` equal to `v<stable>^{commit}`), not the newest one below `MIN_PHONE_DESKTOP_VERSION`: breaking phone↔desktop changes from before that constant carry no machine-readable floor (build 35 broke stable 0.72.2 that way) |
| Stable Android publish fails with `stable desktop is <X>` | The tree requires a desktop newer than the released stable (`MIN_PHONE_DESKTOP_VERSION`). Ship it on `alpha`, or cut the stable desktop first |
| iOS job fails at `Check inputs` with `cannot be submitted to TestFlight` | `ios_profile` was `internal`. Nothing was queued; re-dispatch with the default |
| iOS job fails at `Check inputs` with `no TestFlight link` / `no submit.<profile>.ios.ascAppId` | That app is not wired yet: set the `TESTFLIGHT_URL_STABLE` repository variable (`gh variable set`) / `submit.<profile>.ios.ascAppId` in `apps/mobile/eas.json` |
| iOS alpha warns `no TestFlight link for the alpha app yet` | Expected until its external group has a public link: the build is submitted, only `mobile/ios/alpha/latest.json` is skipped. Set the `TESTFLIGHT_URL_ALPHA` repository variable once the link exists |
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
  `ref`**, so the tags for one build code name one commit. A local Android APK
  is the exception: `apk_url` is Android-only, so iOS is a second dispatch
  without it.
- **A local APK is staged, not committed.** The draft lives at
  `staging/android-apk/<id>` and is deleted after a non-dry-run publish. It is
  never a `v*` tag, never a `mobile/*` tag, and never an asset on the desktop
  Release.
- **`alpha` on both platforms** — for builds and for update channels alike.
  Stable (Android `internal`, iOS `production`) is typed only by a stable cut,
  never a default; a stable phone must never require an unreleased stable
  desktop.
- **`min_supported_build_code` is inherited unless typed.** Raising it locks
  every older build out with no client-side way back.
- **Mobile tags live under `mobile/<platform>[-alpha]/`, never `v*`** — that namespace is
  the desktop line. Tags are created by the workflow after publishing, never
  pushed from local.
