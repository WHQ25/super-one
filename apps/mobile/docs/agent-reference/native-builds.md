# Mobile native builds and updates

Read for native dependencies, build variants, EAS updates, or release validation.
The release smoke below applies to shipping, not routine edits.

EAS files live in this app directory. Run EAS commands from `apps/mobile`, not the
monorepo root. `eas.json` pins the root Bun version, builds the `internal` profile as
an installable Android APK, and reserves `production` for TestFlight/store builds.
Both release profiles use remote build-number increments. Keep `credentials.json`
local and ignored. `assert-release-config.ts` (static, cheap) stays in the test command.

**`runtimeVersion` is `fingerprint`, not `appVersion`.** Under `appVersion` the runtime
version was pinned to the hand-written `version` field, which `autoIncrement` never
touches — so a build carrying new native modules kept the runtime version of the build
before it, and `eas update` would happily serve JS calling native methods that binary
does not have. `fingerprint` derives it from everything shaping the native runtime
instead. **No `.fingerprintignore` is needed**: `@expo/fingerprint` asks the VCS whether
each workflow marker is ignored (`ProjectWorkflow.resolveProjectWorkflowAsync`), and
because `ios/` and `android/` are gitignored here it resolves to `managed` and hashes
neither tree — locally-built and EAS-built binaries land on the same runtime version.
Verify with `createFingerprintAsync(process.cwd())` and check `sources` for any
`ios/` or `android/` entry; there should be none. Do not surface
`Updates.runtimeVersion` in the UI — it is an opaque hash now.

Android's `UpdatesConfiguration.getRuntimeVersion()` opens `assets/fingerprint`
with no try/catch (iOS returns nil). The Gradle task that writes that asset does
not take `app.json` as an input, so a policy switch to `fingerprint` plus an
incremental `rebuild:android` ships a binary whose Application.onCreate dies
with `FileNotFoundException: fingerprint`. Debug/dev-client never loads an EAS
Update — Metro serves JS — so `plugins/with-dev-client-updates.js` sets
`expo.modules.updates.ENABLED=false` on the debug manifest (`getIsEnabled` is
checked before the file open) and makes `create*UpdatesResources` out of date
when the asset is missing, so a local release build cannot repeat the crash.

## Two app identities

The locally built dev client and the EAS `internal` APK have to sit on one phone
at once, and they cannot share a package name: one is signed with
`~/.android/debug.keystore`, the other with the EAS project keystore, and Android
refuses to install either over the other (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`).
So the development variant takes a `.dev` suffix and its own name and scheme.

`app-variant.js` is the only copy of that rule. `app.json` stays the base config
*and the release identity*, so every static assertion in
`assert-release-config.ts` keeps reading the JSON directly; `app.config.js` is a
thin overlay Expo hands `app.json` to, and it only rewrites the identity when
`APP_VARIANT=development`. Everything else — updates URL, permissions, plugins,
the runtime-version policy — is deliberately shared, so the dev client exercises
the same native surface the release build ships.

- Both entry points set the variable, and both are covered rather than trusted:
  `eas.json`'s `development` profile through `env`, and local rebuilds through
  `baseRebuildEnv()` in `scripts/rebuild-dev-client.ts`. Dropping either one
  rebuilds the *release* application id and the install fails with a signature
  error that reads like a broken build. `assert-release-config.ts` asserts the
  split still produces different ids and different schemes.
- **The scheme splits too.** Two installed builds both answering `superone://`
  raise an Android disambiguation chooser on every deep link, and the Maestro
  suite cannot answer a chooser. The dev variant answers `superone-dev://`;
  `parsePreviewRoute` accepts both, and `.maestro/helpers/open-scenario.yaml`
  uses the dev one. Pairing is unaffected — that path is the in-app camera and
  the paste field, not the OS deep link.
- `scripts/maestro.ts` always targets the dev identity, because that suite needs
  Metro and the dev launcher. It imports `devApplicationId` rather than
  re-appending the suffix; a second copy drifts, and the symptom is a UI suite
  silently driving the wrong app.
- Importing `app-variant.js` from TypeScript needs the **explicit `.js`
  extension**. Without it bun resolves the sibling `app-variant.d.ts` first and
  erases the import as type-only, leaving the binding `undefined` at runtime
  while `tsc` stays green.
- Changing the application id is a native change: rebuild with `--clean`. The
  previously installed build keeps the old id, so it has to be uninstalled once
  — after that the two coexist permanently.

## Native-binary updates

EAS Update swaps the JS bundle; anything touching the native runtime needs a new
binary, and neither store gives us a push. So the app polls a manifest published
beside the desktop releases and acts on it (`src/updates/`).

```
mobile/android/v<version>-<buildCode>/superone-<buildCode>.apk   immutable
mobile/android/latest.json    the ONLY mutable object — rollback is one re-point
mobile/ios/latest.json        numbers + a TestFlight link; iOS installs nothing itself
```

Key layout, parsing and the verdict rule live in `@superone/shared/mobile-updates` —
one copy, because `scripts/publish-mobile-update.ts` writes exactly what the app reads.
`.github/workflows/release-mobile.yml` drives an EAS build per platform (`android_profile`
`internal` → APK, `ios_profile` `production` → TestFlight; `platform=both` is one dispatch),
downloads the artifact and runs that script; it needs an `EXPO_TOKEN` secret and defaults
`dry_run` to true.

JS-only changes go out through `.github/workflows/update-mobile.yml` instead — `eas
update`, one publish per platform because the channels differ (Android APK on
`internal`, iOS on `production`). Its one job beyond the publish is the **runtime
guard**: `eas update` computes the fingerprint from the checkout and publishes even when
no shipped build has that runtime, so the workflow first asks
`eas build:list --fingerprint-hash <hash> --channel <channel> --status finished` per
platform and fails on a miss — that change needs `release-mobile.yml` first. The
default `dry_run: true` runs the guard and `expo export` without publishing. Installed
apps pick an update up on the next launch and apply it on the launch after that; there
is no in-app `checkForUpdateAsync`.

- **The floor (`minSupportedBuildCode`) is the one move with no client-side way back.**
  It is inherited unless a number is typed into the workflow, `<= buildCode` is enforced
  on both sides, and the *hard gate is checked before the dismissal* so saying "Later"
  once can never buy past it. Lowering it is deliberately still allowed — that is how a
  floor set too high gets undone.
- **An unparseable or future-`schemaVersion` manifest must read as "no update"**, never
  as an error and never as a gate. Publishing schema 2 must not brick schema-1 builds.
  Same for any non-200: `dl.super-one.dev` answers 404 for a prefix nothing has been
  published to yet.
- **`UpdateGate` mounts in `App.tsx`**, not `mobile-overlays.tsx`. `App.tsx` already
  holds `mobileKv` (so the "never import the encrypted store from a hook" rule costs no
  prop drilling), `mobile-app.tsx` is long enough, and the overlays render inside the
  shell's `SafeAreaView` — which would leave pairing and onboarding reachable underneath
  a gate meant to stop everything. Children stay mounted under it; unmounting would cost
  a full relay reconnect for a state only an install can leave.
- **`UpdateDownloadError` lives in `update-download-state.ts`, not beside the ports.**
  `use-update-check` imports `UpdatePorts` type-only; a value import would drag
  `expo-updates`, `expo-intent-launcher` and `expo-application` into every jest suite
  that mounts the gate, and a suite that cannot load reports as *missing* tests.
- **The install intent needs both `data` and `type`.** expo-intent-launcher calls
  `setDataAndType` when it has both; the documented `ACTION_VIEW` + URI-only recipe
  leans on the file provider returning a MIME type for `.apk`, which many devices do
  not, leaving the intent unresolvable. `expo-file-system` already registers a provider
  covering `Paths.cache`, so no `FileProvider` of our own and no `<queries>` entry
  (package visibility gates resolve/query, not launching).
- **The install result is meaningless.** `startActivityForResult` returns as soon as the
  installer appears, and a successful self-update kills this process. Treat "launched"
  as terminal; never gate UI on the promise's value.
- **`REQUEST_INSTALL_PACKAGES` is not enough** — Android 8+ also needs a per-source
  "install unknown apps" toggle, so the failure path offers
  `MANAGE_UNKNOWN_APP_SOURCES`. And `android.permissions` is additive across *every*
  Android profile, so it rides along in the `production` AAB: fine while production is
  TestFlight-only, a Play policy problem before the first store submission.
- **A locally built dev client cannot be updated over.** `expo run:android` signs with
  `~/.android/debug.keystore` while EAS signs with the project keystore, so the R2 APK
  fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. `canSelfInstall` is false there
  (`Updates.isEnabled` is false in a dev client), and the checker stays silent on
  Android rather than nagging a developer to install something that cannot install.
- **Progress needs the legacy download API.** The new `File.downloadFileAsync`'s
  `DownloadOptions` is `{ headers, idempotent }` — no callback. `expo-file-system/legacy`
  `createDownloadResumable` reports bytes and takes `md5: true`, which hashes natively
  during the download instead of blocking the JS thread on `File.md5` over 100 MB.
  `totalBytesExpectedToWrite` is `-1` without `Content-Length`; fall back to the
  manifest's size rather than dropping to an indeterminate bar.

Preview every state at `superone://native-preview?page=Update` — a hard gate, a failed
checksum and an installer Android refused to open are not states you can reach by hand
without publishing a broken manifest.

**`t()` has no interpolation, and the `en` map is not identity.** Any string carrying a
number needs a static translatable sentence plus its own `<Text>` (`update-format.ts`
holds those fragments). And `en` applies the desktop's Title Case — `t('Try again')`
renders `Try Again`, so component tests must assert the *rendered* string.

**Release acceptance.** Shipping requires one release-mode smoke on one
physical iPhone and one physical Android (pair by camera QR, stream + stop, Pinyin IME,
one sheet of each kind, 10 s airplane-mode flap, terminal `pwd`, one image attach, one
received file, iPad rotation with a sheet open) plus a single RSS sanity run of the
200-turn corpus under 250 MB — tighten the 24/40 DOM window if it is over. Record the
result as a short Markdown note under gitignored `docs/temp/`. Screenshots and videos
never enter git.

Needs a **dev client** (`bun run rebuild:mobile:ios` / `rebuild:mobile:android`),
not Expo Go. That script builds chat-view, runs `expo prebuild`, then `expo run`
with `LANG=en_US.UTF-8`. After changing native dependencies or config plugins,
pass `--clean` so the ignored `ios/` / `android/` trees are not reused with stale
Info.plist entries or pods. `--no-bundler` skips Metro when `dev:mobile` is
already running.

CocoaPods crashes with `Encoding::CompatibilityError` under this repo's default
shell locale. The rebuild script sets `LANG` / `LC_ALL` for you. If you invoke
`pod install` or `expo run:ios` by hand, prefix both with
`LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`; without it `expo run:ios` exits on its own
`pod install` before xcodebuild ever starts, which reads as a successful no-op.

**Drawing.** `react-native-svg` covers gradients and masks over measured text.
`@shopify/react-native-skia` (with `react-native-reanimated` and the
`react-native-worklets/plugin` babel plugin, which must stay last) covers
anything needing a real canvas — currently the `max` effort easter egg's particle
fire, which needs `BlendMode.Plus`. RN views composite with plain alpha, so
overlapping particles can only get muddier, never hotter; that is why the
easter egg is not pure `Animated`. Skia work belongs in immediate mode
(`Skia.PictureRecorder` inside `useDerivedValue`) with the expensive part
precomputed on the JS thread — see `src/fire-sim.ts` and `src/ui/fire-embers.tsx`.
Adding these was a native dependency change: changing these native dependencies requires a
dev-client rebuild, not just a Metro restart. The same applies to
`expo-media-library` (Save to Photos in the file preview): its config plugin writes
the add-only photo-library usage string, and `app.json` blocks the read-side Android
media permissions it would otherwise request.
