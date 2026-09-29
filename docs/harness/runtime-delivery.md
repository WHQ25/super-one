# Harness runtime delivery

How harness runtimes reach a machine and how a spawn finds them, for both the
desktop app and the headless CLI node.

Related code: `packages/shared/src/environment/harness-installation.ts`,
`packages/runtime/src/harness/`, `apps/desktop/src/main/harness/`,
`apps/cli/src/session/harness-host.ts`, `apps/desktop/electron-builder.yml`.

---

## 1. Decision

Users opt into each harness. Enabling Claude or Codex downloads its native runtime
on demand; the installer ships neither binary. One harness installation kernel in
`@superone/runtime/harness` serves both the CLI node and the desktop.

| Question | Decision |
|---|---|
| Artifact source | R2 primary (`dl.super-one.dev`), npm registry fallback |
| Installer baseline | No managed binary bundled; first-run onboarding installs what the user picks |
| Code reuse | One kernel in `packages/runtime/src/harness/`; CLI and desktop are thin hosts |

### Why

Bundle size. Measured on one platform, uncompressed:

| Dependency | Size |
|---|---|
| `@anthropic-ai/claude-agent-sdk-darwin-arm64/claude` | 267 MB |
| `@openai/codex-darwin-arm64/vendor` | 309 MB |
| `@agentclientprotocol/sdk` | 3.1 MB |
| `@opencode-ai/sdk` + `@opencode-ai/models` | 4.5 MB |

The two managed binaries are ~576 MB; every adapter together is under 10 MB.
Compressed tarballs are ~80 MB (Claude) and ~126 MB (Codex), so the network
transfer dominates install time; extraction is sub-second.

Secondary wins: a harness bump no longer needs an app build, and auto-update
deltas shrink to the shell.

### Non-goals

- **Adapter TypeScript stays statically compiled.** Only runtime assets are
  delivered on demand. Loading adapter code dynamically buys under 2% of the size
  and collides with ASAR packaging, macOS notarization (downloaded code is not
  covered by the app signature), and type boundaries. Revisit only if third-party
  harness plugins become a product goal.
- **External harnesses are not downloaded.** Grok and OpenCode are user-installed;
  SuperOne resolves them and gives them the same enable/disable switch and status
  surface (§6).

---

## 2. Contract and kernel

`packages/shared/src/environment/harness-installation.ts` is the contract:

- `NodeHarnessId`: `claude | codex | opencode | cursor | acp-grok | dsh`, each with a
  `runtimeSource` (`managed | external`) and the session `HarnessId` it maps to
  (`acp-grok` → `acp`).
- `HarnessInstallState`: `disabled | missing | installing | needs_auth | ready | incompatible | error`.
- `enabled` and `state` are orthogonal: administrator intent vs. runtime readiness.
- `readySessionHarnessIds()` advertises only `enabled && ready` harnesses.
- Diagnostics use allowlisted codes with secret redaction (`buildHarnessDiagnostic`).

The kernel in `packages/runtime/src/harness/`:

| Module | Responsibility |
|---|---|
| `manager.ts` | Catalog state and transitions, persisted in the host's SQLite `harness_installations` table |
| `enable.ts` | enable/disable orchestration, managed vs. external branch, `resolveExternalCommand` (PATH search) |
| `managed-official.ts` | Pinned upstream versions (`OFFICIAL_CLAUDE_SDK_VERSION`, `OFFICIAL_CODEX_NPM_VERSION`) and platform package naming |
| `managed-release.ts` | Release-manifest pins, SHA-256 verification, offline `releases/` installs |
| `managed-layout.ts`, `home-path.ts` | Install root and versioned layout (§5) |
| `managed-tarball-installer.ts`, `tarball-fetch.ts`, `resumable-download.ts` | R2 → npm tarball acquisition, Range-resumable download, extraction |
| `cdn.ts`, `app-harness-pins.ts` | R2 object keys, channel manifests, per-app-version pins (§4) |
| `runtime-ready.ts` | Readiness probe, `needs_auth` → `ready` promotion |
| `grok-runtime.ts`, `cursor-availability.ts` | Grok command resolution; Cursor SDK presence |

The kernel imports no Electron, no CLI module and no `better-sqlite3`; its only
upward import is `../sqlite`.

---

## 3. Layers and seams

```
L0  Contract        packages/shared/src/environment/harness-installation.ts
L1  Kernel          packages/runtime/src/harness/   (pure Node)
L2  Host adapters   desktop: apps/desktop/src/main/harness/
                    cli:     apps/cli/src/session/harness-host.ts
L3  Gate            desktop resolveHarnessRuntime(id) → path or HarnessNotReadyError
L4  Surface         Settings → Harnesses, first-run onboarding, harness-align gate;
                    the enabled set filters HarnessPreferencePicker and ChatSuggestions
```

Hosts inject the kernel's couplings through `HarnessKernelDeps`
(`packages/runtime/src/harness/types.ts`):

| Seam | Injected as | Desktop | CLI |
|---|---|---|---|
| Database | `TransactionalSqliteDatabase` (`packages/runtime/src/sqlite.ts`) | app DB (`database-migrations.ts`) | node `state.sqlite` |
| Install root | `HarnessHome.root` | `apps/desktop/src/main/harness/home.ts` | `resolveHarnessHomeRoot()` |
| Release version | `releaseVersion` / `setHarnessReleaseVersionProvider()` | `app.getVersion()` | CLI release version |
| Binary discovery | `HarnessRuntimeResolver` | `desktopHarnessResolver` (`host.ts`) | `cliHarnessResolver` |
| Credentials | `HarnessAuthProbe` | desktop provider bindings | node `ProviderStore` |
| Download | `ManagedRuntimeInstaller` | `createManagedTarballInstaller` over Chromium `net.fetch` (system proxy) | same installer over `fetch` |

---

## 4. Distribution

### Artifacts are byte-exact npm tarballs

Upstream binaries ship with Developer ID signatures and hardened runtime
(Claude: Team `Q6L2SF6YDW`; Codex: Team `2DC432GLL2`). A downloaded binary is
spawned as-is; the app's hardened runtime does not block spawning a separately
signed executable outside the bundle, and files written by the app do not get
`com.apple.quarantine`. This fixes the artifact format: R2 hosts a byte-exact
mirror of the npm tarball, not a repackaged zip.

1. Any byte change invalidates the Mach-O signature.
2. `.tgz` preserves the executable bit and symlinks; Codex vendors nested
   executables (`codex-path/rg`, `codex-resources/zsh/bin/zsh`).
3. R2 and npm serve identical bytes, so one SHA-256 validates both paths.

### R2 layout

Under the `super-one-releases` bucket, served at `https://dl.super-one.dev`
(`packages/runtime/src/harness/cdn.ts`):

```
harness/manifest/<alpha|stable>.json
harness/artifacts/<npm-name-sanitized>/<npm-version>.tgz
app/harness-pins/<appVersion>.json
```

e.g. `harness/artifacts/anthropic-ai--claude-agent-sdk-darwin-arm64/0.3.284.tgz`,
`harness/artifacts/openai--codex/0.155.1-darwin-arm64.tgz`.

The channel manifest is a `HarnessReleaseManifest` with optional `url`, `npmName`
and `npmVersion` per artifact pin (`ManagedArtifactPin` in `managed-release.ts`).
Channels are `alpha` and `stable`, one per app variant. `app/harness-pins/<version>.json`
records the pins a given app version expects, so an updating client can fetch
the target version's runtimes before restart (§7).

Desktop selects its channel with `SUPERONE_HARNESS_CHANNEL`, else the build variant
(`harnessManifestChannelForVariant()` in `apps/desktop/src/main/variant.ts`: stable →
`stable`, everything else → `alpha`). The CLI, which has no variant, derives the
channel from its version (`resolveHarnessManifestChannel`).

### Platform package naming differs per vendor

`managedPackagePins` in `managed-tarball-installer.ts`:

| Harness | npm spec | Platform encoded in |
|---|---|---|
| claude | `@anthropic-ai/claude-agent-sdk-<platform>-<arch>@<ver>` (Linux musl: `-linux-<arch>-musl`) | package name |
| codex | `@openai/codex@<ver>-<platform>-<arch>` | version |

`@openai/codex-darwin-arm64` does not exist on npm; it is an alias declared in
`@openai/codex`'s `optionalDependencies` and 404s when queried. Only the platform
package is fetched: the Claude TS SDK and Codex JS packages stay in the app as
adapter dependencies, and the desktop drives the vendored Codex binary directly
over the app-server protocol.

### Publishing

`.github/workflows/publish-harness.yml` (`workflow_dispatch`: `channel` alpha|stable,
optional `app_version`, `dry_run`, `ref`) runs `scripts/publish-harness-artifacts.ts`
(`bun run publish:harness -- --channel <c> [--app-version <v>] [--upload]`):
`npm pack` each pinned spec → SHA-256 → upload to R2 → write the channel manifest
and `app/harness-pins/<version>.json`. No build or signing step.

Pins come only from `OFFICIAL_CLAUDE_SDK_VERSION` / `OFFICIAL_CODEX_NPM_VERSION`
in `managed-official.ts`; the workflow never takes free-form versions, so the
manifest cannot drift from the code. `managed-official-lockstep.test.ts` keeps
those constants equal to the SDK dependency pins in `packages/claude`,
`apps/desktop` and `apps/cli`.

### Fetch order

1. R2 URL from the pin (`harness/artifacts/...`).
2. `registry.npmjs.org` tarball for the same version.
3. Offline artifact file (`--artifact` on the CLI; also accepted by the desktop
   enable IPC) matched against a `release-manifest.json` pin.

Every path verifies against the pin digest (npm path also checks `dist.integrity`).
A mismatch is a hard failure, never a warning. If the channel manifest cannot be
fetched, installs continue from npm.

---

## 5. Install root and gate

### Install root

Both hosts use `<personal root>/harness`: `~/.superone/harness` for stable,
`~/.superone/alpha/harness` for alpha (`home-path.ts`, `apps/desktop/src/main/harness/home.ts`).
`SUPERONE_HARNESS_HOME` overrides it for tests and labs. Node state (SQLite,
pairing) stays in `<personal root>/node`; only runtime binaries share this root.

```
<harness root>/
  claude|codex/versions/<runtimeVersion>/   # immutable, one per pin
  claude|codex/current                      # { runtimeVersion, installRoot?, updatedAt }
  releases/<cliVersion>/harnesses/<id>/     # offline --artifact installs
  .download/                                # Range-resumable partial downloads
  release-manifest.json                     # optional offline pins
```

Install stages to a temp dir, verifies the digest, extracts with modes and
symlinks preserved, renames into `versions/<v>/`, then atomically rewrites
`current`. A partial download never activates. `MANAGED_VERSION_KEEP` (2) versions
are retained after a switch.

### Gate

Desktop spawn sites (`apps/desktop/src/main/agent/claude-binary.ts`,
`apps/desktop/src/main/codex/app-server-connection.ts`) go through
`resolveHarnessRuntime(id)` (`apps/desktop/src/main/harness/resolve-runtime.ts`),
which returns an absolute path or throws `HarnessNotReadyError`
(`code: 'HARNESS_NOT_READY'`). The renderer turns that error into an install
prompt, not a generic spawn failure.

Resolution order for managed harnesses (`desktopHarnessResolver` in `host.ts`):

1. Disabled harness → nothing.
2. `SUPERONE_CLAUDE_BINARY` / `SUPERONE_CODEX_BINARY`.
3. Catalog command from a prior enable (`ready` or `needs_auth`).
4. Managed install under the harness root.
5. Local platform package — dev only; `allowBundledHarnessPlatformPackages()` is
   false in packaged apps (`bundled-fallback.ts`).
6. `codex` on PATH (Codex only).

### Desktop surface

IPC channels (`AgentIpcChannels` in `packages/shared/src/agent-types.ts`):
`harness:list`, `harness:enable`, `harness:disable`, `harness:probe`,
`harness:ensure`, `harness:scanCli`, `harness:alignEnabled`, `harness:needsAlign`,
and the push channel `harness:installProgress` for per-harness download progress.
Remote-node catalogs use the `environment:harness*` channels.

### Packaging

`apps/desktop/electron-builder.yml` excludes `@anthropic-ai/claude-agent-sdk-{darwin,linux,win32}-*`
and `@openai/codex-{darwin,linux,win32}-*` from `files`. `asarUnpack` holds
`**/*.node`, the Cursor platform helpers (`@cursor/sdk-*`) and sharp's libvips,
none of them harness binaries. Dev builds still resolve the local optional
dependencies.

---

## 6. Runtime resolution by harness

Desktop `HarnessId` is `claude | codex | acp | opencode | cursor | dsh`; the catalog
calls Grok `acp-grok`.

| Harness | Source | Resolution |
|---|---|---|
| `claude` | Managed download | §5 gate; TS SDK bundled, native binary downloaded |
| `codex` | Managed download | §5 gate, plus `codex` on PATH as a last resort |
| `cursor` | Bundled, in-process | `@cursor/sdk` ships in the app (`isCursorSdkAvailable`); no binary path |
| `dsh` | Bundled, in-process | `@deepseek-ai/dsh-*` via `packages/deepseek`; always runnable |
| `opencode` | External | `SUPERONE_OPENCODE_BINARY` or the catalog command resolved on enable (`enable.ts` `resolveExternalCommand`) |
| `acp` / `acp-grok` | External | `resolveGrokRuntime` (`packages/runtime/src/harness/grok-runtime.ts`): explicit override or `SUPERONE_ACP_BINARY` or configured command, else `grok` on PATH, else `~/.grok/bin/grok` or `~/.local/bin/grok`; default args `agent stdio`. An invalid explicit command fails closed |

`cursor` and `dsh` carry `runtimeSource: 'managed'` in the catalog because SuperOne
owns their runtime, but they are not on the CDN pin chain; their runtime ships
with the app. Onboarding scans PATH (`scan-cli.ts`) to pre-check detected CLIs;
detection never installs, upgrades or removes an external executable.

---

## 7. Onboarding and app updates

Removing bundled binaries would break every existing session on an in-place
update unless each client installs its runtimes first. Three mechanisms cover it:

1. **Epoch onboarding.** `CURRENT_ONBOARDING_EPOCH` (`packages/shared/src/onboarding.ts`)
   forces every install through Welcome → Discover once when bumped; completion
   records `onboardingEpoch`. Users pick harnesses (PATH scan pre-checks detected
   CLIs; Claude is pre-checked when nothing is detected). Enabling Claude/Codex
   installs the SuperOne pin even when a CLI exists on PATH (`forcePin`).
2. **Update pre-fetch.** After the app update downloads, the updater
   (`apps/desktop/src/main/updater.ts`, `prefetchEnabledHarnessesForAppUpdate` in
   `harness/service.ts`) fetches the enabled Claude/Codex pins of the *target*
   version from `app/harness-pins/<version>.json`, falling back to the running
   app's pins. Restart stays blocked until this succeeds: failure emits
   `harness-error` with retry (`updater:retryHarness`), and
   `autoInstallOnAppQuit` stays false until the package is fully ready.
3. **Startup pin-alignment gate.** If any enabled managed harness is not at the
   running app's pin (forced restart, wiped install, missing pins file), the
   blocking `harness-align` view (`HarnessAlignPage`) installs it before the main
   UI. When already aligned the gate is skipped without a flash.

External harnesses are never downloaded by onboarding, pre-fetch or alignment.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| macOS blocks spawning a downloaded binary | Verified not to: a notarized hardened-runtime parent spawns the extracted binaries; no quarantine xattr is set on app-written files |
| Nested executables lose their mode | `.tgz` extraction keeps `rwx` on Codex's vendored binaries |
| Windows SmartScreen / Authenticode on downloaded executables | Not verified on a packaged NSIS build; programmatic writes get no Mark-of-the-Web, but vendor Authenticode status is unconfirmed |
| Linux packaged spawn | Low risk (only the exec bit matters, tar keeps it); not verified inside an AppImage |
| Platform package naming drift | Pins map specs explicitly per vendor (§4); a bare Codex alias name 404s |
| Large download fails midway | Range-resumable download and atomic rename; R2 is primary for CN reachability |
| Manifest drifts from pinned constants | Publisher reads pins from source; lockstep test ties them to package pins |
| Two install kernels diverge | One kernel in `@superone/runtime/harness` for both hosts |
| Offline first run | Onboarding states the network requirement; install failures surface in the harness UI |
