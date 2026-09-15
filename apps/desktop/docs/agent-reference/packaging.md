# Desktop packaging and updates

Read for build identity, distribution, updater, or versioning changes. Paths are repository-relative.

### Auto-Update

`apps/desktop/src/main/updater.ts` wraps `electron-updater` with an IPC push pattern:

- Guarded by `is.dev` — completely skipped in development unless `TEST_UPDATER=1`
- `autoDownload = false` — the check may run automatically on launch, but the binary download starts only when the user clicks **Update** (sidebar / settings / app menu → `UPDATER_DOWNLOAD` → `downloadUpdate()`). Restart still uses `UPDATER_INSTALL`
- Distribution: artifacts hosted on Cloudflare R2, served via custom domain `https://dl.super-one.dev`. `electron-updater` uses the built-in `GenericProvider`; no auth tokens needed (bucket is public via custom domain)
- **There is no runtime channel.** `updater.ts` never sets `autoUpdater.channel` or `allowDowngrade`; a build only ever reads the feed baked into its own `app-update.yml`. That is deliberate — setting `channel` at runtime also latches `allowDowngrade = true` inside electron-updater (`AppUpdater.js`), which used to leave every user with a channel preference permanently able to move backwards. `updater.test.ts` guards this
- Events flow: `autoUpdater` → `webContents.send(UPDATER_EVENT)` → `useAppStore.handleUpdateEvent()` → `<UpdateNotification />`

Dev testing: `TEST_UPDATER=1 bun run dev` (uses `apps/desktop/dev-app-update.yml`).

### Build Variants (stable + alpha side by side)

**`apps/desktop/variants.json` is the single source of truth** for every identity a
variant owns, read by both the builder config (CJS) and the runtime (TS). The two
variants are two different applications that happen to share a codebase — a user can
install both, and they share no data, no bundle id, no install directory and no
update feed. `stable` inherits the historical identity (`com.superone.app` /
`SuperOne` / the existing userData tree); `alpha` is the new one.

Three identity chains have to move together, and they come from three different
electron-builder fields — getting only two of them right produces a collision that
does not show up until install time:

| Field | Governs | Symptom if shared |
|---|---|---|
| `appId` | OS registration, macOS TCC, Windows registry / AUMID | Grants and taskbar pinning bleed across variants |
| `productName` | `.app` name, Electron `app.name` → log dir, `safeStorage` keychain entry | One app's credentials are undecryptable by the other |
| package.json `name` | NSIS install dir + electron-updater cache dir (via `appInfo.sanitizedName`) | **Both variants install into the same `%LOCALAPPDATA%\Programs` folder** |

The third is injected through `extraMetadata.name`, which electron-builder applies
before it constructs `AppInfo`, so it is the only seam that reaches the install path.

- **`electron-builder.config.cjs` is the only build entry point.** It loads
  `electron-builder.yml` as a base and overrides the identity keys. It deliberately
  does **not** use electron-builder's `extends`: that unions arrays, so a variant
  could never drop a target the base declares. It requires `SUPERONE_VARIANT` (no
  default) and derives the packaging version from the base version plus the
  variant's `prereleaseTag` — see **Versioning** below. Output goes to
  `dist/<variant>/`
- **`electron-builder.yml` is not a complete config on its own** — the identity
  fields were removed from it
- **`src/main/variant.ts`** is the runtime lookup, reading `variant` from the
  packaged package.json. `variant()` / `variantId()` / `variantScopedId()` are how
  main-process code asks which app it is
- **There is a third variant, `dev`**, and it never publishes. `downloadPrefix` is
  `null`, which makes the builder emit `publish: null` so no `app-update.yml` is
  baked and a local build cannot auto-update itself onto a shipping line.
  `build:mac-dev` defaults to it — before that it defaulted to `alpha`, so a local
  build installed under the real Alpha's appId and shared its profile, TCC grants
  and Computer Use helper. `scripts/set-latest.ts` only accepts variants that have
  a prefix
- **Unpackaged runs are the `dev` variant** (`DEV_VARIANT_ID`). They cannot take
  its bundle id — macOS reads that from `node_modules/electron/dist/Electron.app`
  at launch and Electron has no runtime override, so `bun run dev` is always
  `com.github.Electron`. Everything SuperOne itself controls does follow it. To
  exercise anything keyed on a real bundle id (notification authorization, TCC),
  build `SUPERONE_VARIANT=dev bun run build:mac-dev` and run the packaged app.
  That build is unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`), so it ends with
  an ad-hoc `codesign --deep`. Without it Finder refuses to launch the app while
  running the executable from a shell still works — the kernel accepts Electron's
  linker-signed binary, Gatekeeper does not accept the bundle — and the nested
  Computer Use helper has no `_CodeSignature/CodeResources`, which
  `helperBundleFingerprint` requires, so the app boots and then reports
  "Packaged Computer Use helper is incomplete"
- Force the onboarding flow with `RENDERER_VITE_FORCE_ONBOARDING=1 bun run dev`.
  It re-shows the flow but resets nothing, so a step gated on persisted state
  (`notificationsPrimedAt`) needs that field cleared in `.dev-data/app-settings.json`
- **userData is set explicitly**, not via `app.setName`. Electron computes the
  userData path from package.json during init, *before* main runs, so `setName` does
  not move it. `packagedUserDataPath()` in `user-data-path.ts` builds it and
  `index.ts` calls `app.setPath('userData', …)` in both the dev and packaged branches
- Anything else living at a fixed absolute path needs a per-variant scope too, and
  the list is not obvious: the harness root (`$SUPERONE_HOME/harness`, because
  `pruneVersions` keeps only two versions and would delete the other variant's
  running binary), the Computer Use helper bundle id and install root, and the
  lid-keep-awake lease (now per-process: `<prefix>.<uid>.<pid>.lease`)
- The renderer learns which variant it is from `StartupData.variant`. **Never derive
  it from the version string** — `SUPERONE_VERSION` breaks that correspondence

### Release Flow

Three independent workflows; they do not call each other. All take a `variant`.

1. **`build-{mac,win,linux}.yml`** — `workflow_dispatch` with `ref`, `variant`,
   optional `version` / `prerelease_n`. Sets `SUPERONE_VARIANT` / `SUPERONE_VERSION`
   / `SUPERONE_PRERELEASE_N` and uploads from `apps/desktop/dist/<variant>/`.
2. **`promote.yml` (archive only)** — uploads the artifacts **flat** to a draft
   GitHub Release (changelog mirror + the legacy GitHub-provider bridge), then moves
   the binaries to `<variant>/v${VERSION}/` on R2 and drops the ymls. **Promote never
   makes anything live.**
3. **`set-latest.yml` (makes a version live)** — inputs `release_tag`, `variant`,
   `force`, `legacy_root`. Downloads that version's flat manifests from the GitHub
   Release, runs `scripts/set-latest.ts`, publishes `<variant>/latest-*.yml` and
   refreshes the fixed download links. `force=true` is how you roll a variant back.

`scripts/lib/channels.ts` holds the pure helpers (`compareVersions`, `shouldPublish`,
`prefixVersionPaths`, `rootRelativePaths`, `fixedLinkName`, `fixedDownloadPath`,
`versionedArtifactPath`), tested in `channels.test.ts` — which runs under the desktop
vitest suite via the `../../scripts/**` include in `vitest.config.ts`.

**There is no channel cascade.** It was removed with the variant split: handing the
alpha app a stable build would install a different `appId` over it. Each variant owns
one R2 prefix and publishes exactly one `latest-*.yml` inside it. `@superone/shared/update-channels`
keeps only `channelFromVersion`, for `@super-one/cli` (which ships at the desktop
version, has no variant, and needs a harness manifest channel).

R2 layout:

```
super-one-releases/
  stable/latest-mac.yml · latest.yml · latest-linux.yml   ← what the stable app polls
  stable/v0.61.0/{*.dmg,*.zip,*.exe,*.AppImage,*.blockmap}
  stable/latest/{SuperOne-x64.dmg,SuperOne-arm64.dmg,…}   ← shareable release-number-less links
  alpha/…                                                  ← same shape, separate app
  alpha/latest/{SuperOne-alpha-x64.dmg,SuperOne-alpha-arm64.dmg,…}
  alpha-mac.yml · alpha.yml · alpha-linux.yml              ← LEGACY, bucket root only
```

**Installer filenames come from `artifactBaseName`, not `productName`.** Both
variants name their files `SuperOne`, because `${productName}` would write
"SuperOne Alpha-0.61.0-alpha-arm64.dmg" — the word once for the app and once
for the version's prerelease tag. The `.app` keeps the full product name; only
the file on disk drops it.

What separates the two variants' *fixed* links is therefore the prerelease tag
alone, and it survives because `fixedLinkName` strips only the semver **core**:
`SuperOne-0.61.0-alpha-arm64.dmg` → `SuperOne-alpha-arm64.dmg`, while stable's
`SuperOne-0.62.0-arm64.dmg` → `SuperOne-arm64.dmg`. Strip the whole version and
both variants publish one filename, distinguished only by a prefix the browser
throws away.

This is a **three-way** contract with no build-time link between the parts, so a
drift surfaces only as a 404 in production:

| Part | File | Role |
|---|---|---|
| `artifactName` templates | `electron-builder.config.cjs` | produces the versioned name |
| `fixedLinkName` | `scripts/lib/channels.ts` | derives the object key set-latest writes |
| `fixedInstallerName` | `packages/shared/src/download-links.ts` | derives the URL desktop + web request |

`channels.test.ts` pins the last two against each other directly;
`variant-build-config.test.ts` asserts the templates put `${version}` right
after the base, which is what makes the tag land where the other two expect it.

**Read a build log before touching the arch suffixes.** How `${arch}` renders is
not uniform and not guessable, and every one of the three was wrong on first
guess: mac emits `-x64` / `-arm64` (an EXPLICIT artifactName does not collapse
x64 the way the built-in default does), Windows emits nothing (the workflow
builds only the host arch and NSIS produces one installer), and Linux emits
`x86_64`, not `x64`. Nothing fails until a download 404s.

Manifest urls are relative, so `<variant>/latest-mac.yml` + `v${VERSION}/x.dmg`
resolves inside the right prefix with zero client config.

**Legacy root bridge (`legacy_root=true`).** Builds from before the variant split
baked in `url: https://dl.super-one.dev` with no variant segment and derived their
channel from their own version, so they poll `alpha-*.yml` **at the bucket root** and
will never look inside `stable/`. `legacy_root` re-roots the same manifest
(`rootRelativePaths` → `stable/v${VERSION}/…`) and writes it under those root names,
pulling installed clients across onto the stable app. Constraints:

- It only refreshes root names that **already exist**; a 404 means no shipped build
  reads that name, and creating it would leave an orphan `prune-releases.yml`
  (which scans `<variant>/`) cannot see
- `set-latest.ts` refuses `legacy_root` for any variant whose `appId` is not
  `com.superone.app` — legacy clients are that bundle id and must only ever be
  offered that app's builds
- A manifest fetch that is neither 200 nor 404 **fails the run**. Treating an
  unreachable manifest as "nothing published" would both bypass the semver guard and
  silently skip this bridge

**Pre-R2 clients (built before `v0.28.1-alpha`) are deliberately abandoned.** They
use `PrivateGitHubProvider`, which hardcodes `getDefaultChannelName()` — it looks for
`latest-*.yml` on the newest non-draft **prerelease** GitHub Release and ignores
`autoUpdater.channel` entirely (`PrivateGitHubProvider.js:24,63-65`). Since the R2
switch those releases only carried `alpha-*.yml`, so they have been failing with
`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND` for months.

The alpha variant emits `latest-*.yml` again (explicit `publish.channel: latest`), so
once an alpha-variant release is published these clients WILL match it and be offered
`SuperOne Alpha` — a different appId. macOS Squirrel rejects it (the designated
requirement names `com.superone.app`); Windows and Linux would install the alpha app
beside them. **This is accepted, not a bug to fix**: the affected population is a
handful of long-stale alpha users who have not received an update in months either
way. Do not "fix" it by renaming the alpha ymls unless that decision is revisited.

The old `UPDATER_TOKEN` was embedded in pre-R2 clients. This historical dependency
is not a blanket prohibition on credential rotation; assess any remaining consumers
when performing a credential change.

**`prune-releases.yml`** deletes archived versions manually: inputs `variant`, `mode`
(`single` | `older-than`), `version`, `dry_run` (default true),
`delete_github_release`. It refuses to delete a version any of that variant's three
pointer ymls currently names. Planning is pure (`scripts/prune-releases.ts`,
`planPrune`).

The step-by-step runbook lives in the `release` skill (`.agents/skills/release/SKILL.md`).

### Build & Packaging

The build entry point is **`apps/desktop/electron-builder.config.cjs`**, not the yml —
see **Build Variants** above. `SUPERONE_VARIANT` is required; there is no default,
because a build with the wrong identity is worse than no build.

- Output: `apps/desktop/dist/<variant>/`
- `asarUnpack: "**/*.node"` — required for the `better-sqlite3` native module (harness
  platform binaries are **not** unpacked; they are installed on demand under
  `$SUPERONE_HOME/harness`)
- `publish`: `generic` against `https://dl.super-one.dev/<downloadPrefix>` with an
  explicit `channel: latest`. The explicit channel is what stops electron-builder
  deriving one from the version's prerelease tag, so every variant emits the same
  `latest-*.yml` names and the variant lives in the R2 prefix instead
- `build/afterPack.cjs` clones the per-variant Computer Use helper and rewrites the
  cloned Electron Helper bundle ids to `${appId}.helper.*`
- macOS: DMG + ZIP (ZIP is required for auto-update) · Windows: NSIS (x64 + arm64) ·
  Linux: AppImage (x64 + arm64)

Local builds: `SUPERONE_VARIANT=alpha bun run build:mac`.

### Versioning

`package.json` carries the **base** version — a plain release number, no prerelease
tag. `packaged-version.cjs` (used by `electron-builder.config.cjs` and
`release.yml`'s plan job) appends the variant's `prereleaseTag`, so one base of
`0.63.0` packages as `0.63.0` for stable and `0.63.0-alpha` for alpha. A `build`
bump sets `SUPERONE_PRERELEASE_N=1` (or 2, …) and ships `0.63.0-alpha.1` without
moving the base — that keeps `0.63.1` free for a stable hotfix. Neither normal
path needs an override, and there is no input that expresses "stable build
carrying an -alpha version".

`SUPERONE_VERSION` (and the `version` workflow input) override the **base**, for
cutting a release from an older commit without a bump commit. Passing a base that
already has a prerelease tag is an error. `SUPERONE_PRERELEASE_N` is rejected on
stable.

Note the direction: the variant is authoritative and the version is derived from it.
Nothing at runtime may go the other way and infer the variant from the version string.

The step-by-step release runbook lives in the `release` skill.
