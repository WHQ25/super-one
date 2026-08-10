# Harness Hot-Swap & On-Demand Runtime Delivery

Status: **P0–P4 on `refactor/harness-kernel-runtime`** · P5 next
Last updated: 2026-08-11
Related: `packages/shared/src/environment/harness-installation.ts`, `packages/runtime/src/harness/`, `apps/cli/src/session/harness-*.ts`, `apps/desktop/src/main/harness/`, `apps/desktop/electron-builder.yml`, `apps/desktop/CLAUDE.md` (Environment API migration)

---

## 1. Decision

Users opt into each harness. Enabling one downloads its runtime on demand; nothing
ships inside the installer. The CLI's existing harness installation kernel is lifted
into `@superone/runtime/harness` and consumed by both the CLI node and the desktop
local environment.

Three decisions are fixed:

| Question | Decision |
|---|---|
| Artifact source | **R2 primary (`dl.super-one.dev`), npm registry fallback** |
| Installer baseline | **Nothing bundled** — first-run guided install |
| Code reuse | **Whole kernel moves to `packages/runtime/harness/`**; CLI and desktop become thin hosts |

### Why

Bundle size is the entire motivation. Measured, single platform, uncompressed:

| Dependency | Size |
|---|---|
| `@anthropic-ai/claude-agent-sdk-darwin-arm64/claude` | 267 MB |
| `@openai/codex-darwin-arm64/vendor` | 309 MB |
| `@agentclientprotocol/sdk` | 3.1 MB |
| `@opencode-ai/sdk` + `@opencode-ai/models` | 4.5 MB |

Two managed binaries account for ~576 MB; every harness adapter combined is under
10 MB. The value is concentrated entirely in `claude` and `codex`.

Secondary wins: harness runtimes decouple from app releases (a Codex bump no longer
requires an app build), and auto-update deltas shrink to the shell.

### Non-goals

**Adapter TypeScript stays statically compiled.** Only runtime *assets* are hot-swapped.
Dynamically loading adapter code would buy under 2% of the size while immediately
hitting ASAR packaging, macOS notarization (downloaded executable code is not covered
by the app's signature), and type-boundary erosion. Revisit only if third-party
community harness plugins become a product goal — that changes the L1 boundary.

Also out of scope: replacing the ACP external-command model. ACP agents (Grok) and
OpenCode already resolve from PATH; they gain the enable/disable switch and status
surface but no managed download.

---

## 2. Existing ground

`packages/shared/src/environment/harness-installation.ts` already defines the contract:

- `HarnessInstallState`: `disabled | missing | installing | needs_auth | ready | incompatible | error`
- `enabled` and `state` are **orthogonal facts** — administrator intent vs. runtime readiness
- `readySessionHarnessIds()` — only `enabled && ready` harnesses are advertised
- Allowlisted diagnostic codes with secret redaction (`buildHarnessDiagnostic`)

`apps/cli/src/session/` already implements the kernel:

| Module | Responsibility |
|---|---|
| `harness-manager.ts` | State persistence + transitions (SQLite-backed) |
| `harness-enable.ts` | enable/disable orchestration, managed vs. external branch |
| `managed-harness-release.ts` | Version pinning, SHA-256 verification, atomic install into immutable version dirs, `current` pointer |
| `managed-harness-official.ts` | Official npm package pull, platform package resolution |
| `harness-runtime-ready.ts` | Readiness probe, `needs_auth` → `ready` promotion |

Desktop, by contrast, is fully static: binaries are forced in via `asarUnpack`, and
`apps/desktop/src/main/agent/claude-binary.ts` / `apps/desktop/src/main/codex/app-server-connection.ts`
call `require.resolve` directly. The only adjacent control is `experimentalAgentsEnabled`,
a pure UI-visibility flag with no runtime meaning.

### Upstream binaries are already signed

```
claude → Identifier=com.anthropic.claude-code   Team=Q6L2SF6YDW  flags=0x10000(runtime)
codex  → Identifier=codex                       Team=2DC432GLL2  flags=0x10000(runtime)
```

Both ship with Developer ID signatures and hardened runtime. A downloaded binary can
be spawned directly on macOS — no re-signing, and the app's own hardened runtime does
not block spawning a separately-signed executable (library validation governs dylib
loading, not child processes).

**This dictates the artifact format.** R2 must host a **byte-exact mirror of the npm
tarball**, not a repackaged zip:

1. Any byte change invalidates the Mach-O signature.
2. `.tgz` preserves the executable bit and symlinks. `codex` vendor contains nested
   executables (`codex-path/rg`, `codex-resources/zsh/bin/zsh`) that a zip round-trip
   easily strips.
3. R2 and the npm fallback serve identical bytes, so **one SHA-256 validates both paths**.

---

## 3. Layers

```
L0  Contract        packages/shared/src/environment/harness-installation.ts
                    Already exists. Desktop reuses as-is; no new types.

L1  Kernel          packages/runtime/src/harness/
                    Lifted from apps/cli/src/session/harness-*.ts.
                    Pure Node. No Electron, no direct better-sqlite3 import.

L2  Host adapters   desktop: fetch + tar + userData paths + Electron db
                    cli:     existing spawn('npm') + $NODE_HOME
                    Both satisfy the same injected interfaces.

L3  Gate            resolveHarnessRuntime(id) is the single spawn-time entry.
                    Replaces scattered require.resolve calls; throws structured
                    HarnessNotReadyError that the renderer turns into an install prompt.

L4  Surface         Settings → Harnesses panel; first-run Setup step.
                    The enabled set drives HarnessPreferencePicker and new-session menus.
```

### L1 seams

The kernel's only external couplings, and how each is inverted:

| Coupling | Site | Injected as |
|---|---|---|
| `NodeDatabase` | `harness-manager.ts` | `SqliteDatabase` (already in `packages/runtime/src/sqlite.ts`; add `transaction`) |
| `resolveNodeHome()` | `harness-enable.ts` | `HarnessHome { root: string }` |
| `resolveCliReleaseVersion()` | `managed-harness-release.ts` | `releaseVersion: string` |
| `claude-/codex-turn-runner` resolvers | `harness-runtime-ready.ts`, `harness-enable.ts` | `RuntimeResolver` |
| `ProviderStore` + `consumerForHarness` | `harness-runtime-ready.ts` | `AuthProbe` |
| `spawn('npm')` | `managed-harness-official.ts` | `ArtifactFetcher` |

None require changing kernel algorithms. `SqliteDatabase` already exists for exactly
this purpose ("Hosts pass their real Database instance"), and desktop already owns a
`better-sqlite3` handle via `getDb()` — no new storage abstraction is needed.

```ts
// packages/runtime/src/harness/types.ts
export interface ArtifactFetcher {
  /** Resolve a pinned artifact to a local file. Must verify digest before returning. */
  fetch(pin: ManagedArtifactPin, onProgress: (bytes: number, total: number) => void):
    Promise<{ path: string; cleanup: () => void }>
}

export interface RuntimeResolver {
  claudeBinary(installRoot: string): string | undefined
  codexBinary(installRoot: string): string | undefined
}

export interface AuthProbe {
  hasCredentials(id: NodeHarnessId): boolean
}

export interface HarnessKernelDeps {
  db: SqliteDatabase
  home: HarnessHome
  releaseVersion: string
  fetcher: ArtifactFetcher
  resolver: RuntimeResolver
  auth: AuthProbe
}
```

---

## 4. Distribution

### R2 layout

Alongside the existing `super-one-releases` bucket, under the same `dl.super-one.dev`:

```
harness/manifest/<channel>.json
harness/artifacts/anthropic-ai--claude-agent-sdk/0.3.226.tgz
harness/artifacts/anthropic-ai--claude-agent-sdk-darwin-arm64/0.3.226.tgz
harness/artifacts/openai--codex-darwin-arm64/0.146.1.tgz
...
```

Manifest reuses the existing `HarnessReleaseManifest` shape with a `url` added per
artifact. Channel-keyed (`alpha`/`beta`/`stable`) so harness pins can advance
independently of app releases while still being channel-gated.

### Platform package naming differs per vendor

The two vendors encode platform differently, and the desktop fetcher must handle both
explicitly — the CLI currently avoids this by delegating os/cpu resolution to npm:

| Harness | Spec | Shape |
|---|---|---|
| claude | `@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.226` | platform in the **package name** |
| codex | `@openai/codex@0.146.1-darwin-arm64` | platform in the **version** |

`@openai/codex-darwin-arm64` does **not** exist on npm — it is a local alias declared in
`@openai/codex`'s `optionalDependencies` (`npm:@openai/codex@0.146.1-darwin-arm64`).
Querying the alias name returns 404. Claude additionally needs its main package
(`@anthropic-ai/claude-agent-sdk`) alongside the platform package; codex needs the main
package only for the `bin/codex.js` launcher, which the desktop does not use (it drives
the vendored binary directly over the app-server protocol).

### Actual download sizes

Compressed tarballs are far smaller than the unpacked footprint, which materially
changes the first-run experience:

| Artifact | Tarball | Unpacked |
|---|---|---|
| `claude-agent-sdk-darwin-arm64` | **80.4 MB** | 279 MB |
| `codex@…-darwin-arm64` | **125.8 MB** | 324 MB |

### CI

One short workflow — no build step, no signing step:

```
npm pack <pinned-spec>  →  sha256sum  →  aws s3 cp  →  patch manifest → upload
```

Pins come from the constants that already exist: `OFFICIAL_CLAUDE_SDK_VERSION`,
`OFFICIAL_CODEX_NPM_VERSION` in `managed-harness-official.ts`. The workflow reads them
rather than accepting free-form input, so the manifest cannot drift from the code.

### Fetch order

1. R2 `harness/artifacts/...` (CDN, fast in CN)
2. `registry.npmjs.org` tarball for the same version
3. Offline `--artifact` upload (CLI air-gapped path, already implemented)

All three verify against the same manifest digest. A digest mismatch is a hard failure,
never a warning.

---

## 5. Desktop host

**Install root**: `~/.superone/harness/`, mirroring the existing `~/.superone/mcpb/`
and `~/.superone/apps/` conventions, and structurally identical to the CLI's
`$NODE_HOME/releases/<version>/harnesses/<id>/` (immutable version dirs + atomic
`current` pointer).

**Fetcher**: Electron `net.fetch` (respects system proxy) → stream to temp →
verify digest → extract `.tgz` preserving mode and symlinks → `rename` into place.
Note `zip-utils.ts` (`unzipper`) is **not** reusable here — it is zip-only and the
tarball path must preserve POSIX modes.

**Gate**: `claude-binary.ts` and `app-server-connection.ts` stop calling `require.resolve`
and route through the kernel's resolver. Not-ready spawns throw `HarnessNotReadyError`,
which the renderer surfaces as an install prompt rather than a generic failure.

**Progress**: reuse the `UPDATER_EVENT` push shape — main pushes
`harness:install-progress` to the renderer; store holds per-harness progress.

---

## 6. Migration for existing users

Removing bundled binaries makes an in-place update brick every existing session
unless handled. The upgrade path:

1. On first launch of the new build, read distinct `harnessId` values from the
   `sessions` table.
2. Mark those harnesses `enabled` (preserving user intent implicitly — they were
   using them) with state `missing`.
3. Kick off a **background, non-blocking** install with visible progress. The user can
   browse and read history immediately; sending a turn on a not-yet-ready harness shows
   the progress state instead of an error.
4. Fresh installs skip this and go through the Setup step.

Per project convention (breaking refactors switch wholesale in alpha), there is no
feature flag and no dual-path period — the alpha channel absorbs it.

---

## 7. Phases

| Phase | Content | Gate |
|---|---|---|
| **P0** | Spike: download a `.tgz`, extract, spawn on macOS / Windows / Linux packaged builds | ✅ **macOS PASS** (see §7.1) · Windows / Linux pending |
| **P1** | Lift kernel to `packages/runtime/src/harness/`, invert the 6 seams, CLI becomes a thin host, existing CLI tests stay green | ✅ **Done** (see §7.2) — 262 CLI + 286 runtime tests green |
| **P2** | Desktop host adapter: fetcher, install root, db wiring, `resolveHarnessRuntime` gate | ✅ **Done** (see §7.3) — npm tarball install + spawn smoke for Claude |
| **P3** | CI workflow + R2 manifest + channel wiring | ✅ **Done** (see §7.4) — R2-first fetch + sha256, publish workflow |
| **P4** | UI: Setup first-run step, Settings → Harnesses panel, enabled-set drives pickers | ✅ **Done** (see §7.5) — Settings panel + nested tabs + Storybook; setup wizard & picker hard-filter deferred to P5 |
| **P5** | Drop `asarUnpack` entries and the heavy deps from `apps/desktop/package.json` | Measure actual DMG delta |

P1 touches `packages/*`, so it runs on a dedicated branch. Note the worktree
cross-package resolution footgun: changes under `packages/` resolve to the main repo's
files at runtime until `bun install` runs inside the worktree.

### 7.1 P0 result — macOS (2026-08-11)

Reproduce with `apps/desktop/scripts/harness-spike.cjs` (throwaway; keep until P2 lands):

```
ELECTRON_RUN_AS_NODE=1 /Applications/SuperOne.app/Contents/MacOS/SuperOne \
  apps/desktop/scripts/harness-spike.cjs <spikeDir>
```

The parent process was the **notarized, hardened-runtime production app**
(`flags=0x10000(runtime)`, `TeamIdentifier=T527W5ADUG`, `spctl: source=Notarized Developer ID`),
which is exactly the production spawn context.

| Check | Result |
|---|---|
| npm `dist.integrity` (sha512) matches downloaded bytes, both artifacts | PASS |
| `tar -xzf` preserves exec bit (`-rwxr-xr-x`) on all 4 codex nested binaries | PASS |
| codex tarball contains **zero symlinks** — one less failure mode | PASS |
| `codesign -v --strict` after extraction: "valid on disk" + "satisfies its Designated Requirement" | PASS |
| File written by Electron main via `fetch` → `writeFileSync`: xattr is `com.apple.provenance` only, **no `com.apple.quarantine`** | PASS |
| hardened-runtime parent spawns binary **outside** the app bundle: `claude --version` → `2.1.226`, `codex --version` → `0.146.1`, bundled `rg` → `15.2.0` | PASS |

Two incidental findings worth keeping:

- `tar -xzf` of a 279 MB payload takes **~0.4 s** — extraction is not a UX concern; the
  network transfer dominates entirely.
- `apps/desktop/dist/mac-arm64/` (a `build:mac-dev` artifact) fails to launch with
  `different Team IDs` on the Electron Framework — its adhoc signature is internally
  inconsistent. Unrelated to this design, but it means `build:mac-dev` output cannot be
  used to validate runtime signing behavior; use the installed notarized app instead.

**P0 still unverified — must run before shipping to those platforms:**

- **Windows**: SmartScreen / Mark-of-the-Web. Programmatically written files do not get
  a `Zone.Identifier` ADS (only browsers set it), so the expectation is PASS, but the
  vendor binaries' Authenticode status is unconfirmed.
- **Linux**: lowest risk — only the exec bit matters, and tar preserves it. Confirm
  inside a packaged AppImage.

### 7.2 P1 result — kernel lift (branch `refactor/harness-kernel-runtime`)

Files moved with `git mv` (history preserved), CLI keeps the historical import
paths as thin wrappers so **all 53 pre-existing harness tests ran unchanged** —
they became the equivalence check rather than needing rewrites.

| From (`apps/cli/src/session/`) | To (`packages/runtime/src/harness/`) |
|---|---|
| `harness-manager.ts` | `manager.ts` |
| `managed-harness-release.ts` | `managed-release.ts` |
| `managed-harness-official.ts` | `managed-official.ts` |
| `harness-runtime-ready.ts` | `runtime-ready.ts` |
| `harness-enable.ts` | `enable.ts` |
| — | `types.ts` (seam interfaces), `index.ts` |

CLI host wiring lives in the new `apps/cli/src/session/harness-host.ts`
(`cliHarnessResolver` / `cliHarnessAuthProbe` / `cliHarnessDeps`); the five
original paths remain as wrappers that inject it, preserving every public
signature.

Seam resolutions, as implemented:

| Seam | Resolution |
|---|---|
| `NodeDatabase` | `TransactionalSqliteDatabase` in `packages/runtime/src/sqlite.ts` |
| `resolveNodeHome()` | `HarnessHome.root` via `HarnessKernelDeps` |
| `resolveCliReleaseVersion()` | `setHarnessReleaseVersionProvider()`, `SUPERONE_CLI_VERSION` fallback |
| turn-runner binary resolvers | `HarnessRuntimeResolver` (3 methods) |
| `ProviderStore` + `consumerForHarness` | `HarnessAuthProbe.hasCredentialFor` |
| `spawn('npm')` | `ManagedRuntimeInstaller`; `createOfficialNpmInstaller()` is the CLI's |

Verification:

| Check | Result |
|---|---|
| CLI suite | 46 files / **262 tests green** |
| runtime suite | 33 files / **286 tests green** |
| runtime typecheck | Only 7 pre-existing errors (`llm-proxy`, `shared`), confirmed identical on a stashed clean tree |
| CLI typecheck | 28 pre-existing errors, **none** in any touched file |
| Kernel purity | Only upward import is `../sqlite`; no CLI, Electron, `@superone/claude`, or `better-sqlite3` import |

Two incidental changes worth noting:

- `resolveClaudeBinaryPath` / `resolveCodexBinaryPath` had their `harnesses`
  param narrowed from the concrete `HarnessManager` to `HarnessCatalogReader`
  (they only ever called `.get()`), so resolvers work from any host.
- `resolveExternalCommand` (PATH search) is now exported from the kernel rather
  than duplicated per host.

### 7.3 P2 result — desktop host adapter (branch `refactor/harness-kernel-runtime`)

Desktop consumes the kernel as a thin host. New module tree:

| File | Role |
|---|---|
| `apps/desktop/src/main/harness/home.ts` | `~/.superone/harness` root |
| `apps/desktop/src/main/harness/tarball-installer.ts` | `ManagedRuntimeInstaller` over npm tarball + system `tar` |
| `apps/desktop/src/main/harness/host.ts` | resolver / auth probe / `desktopHarnessDeps` |
| `apps/desktop/src/main/harness/service.ts` | singleton `HarnessManager` + enable/disable/ensure |
| `apps/desktop/src/main/harness/resolve-runtime.ts` | `resolveHarnessRuntime` + `HarnessNotReadyError` |

| Seam | Desktop resolution |
|---|---|
| `HarnessHome.root` | `~/.superone/harness` |
| `releaseVersion` | `app.getVersion()` via `setHarnessReleaseVersionProvider` |
| `ManagedRuntimeInstaller` | npm registry metadata → fetch tarball → sha512 integrity → `tar -xzf` → `managed-npm/<id>/` |
| `HarnessRuntimeResolver` | env → catalog command → managed install → bundled SDK / platform package → PATH |
| `HarnessAuthProbe` | desktop `chat:claude` / `chat:codex` provider bindings |
| DB | `harness_installations` table added in `database-migrations.ts` |

Binary gates:

- `claude-binary.ts` prefers managed install over bundled `require.resolve`
- `app-server-connection.ts` prefers managed Codex native binary over bundled platform package

Package pins (desktop fetcher, no host `npm`):

| Harness | npm fetch target |
|---|---|
| claude | platform package only (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>@ver`) — TS SDK stays in the app |
| codex | `@openai/codex@<ver>-<platform>-<arch>` (platform in **version**, not package name) |

Verification:

| Check | Result |
|---|---|
| Unit: tarball installer + resolve-runtime | **10 tests green** |
| Unit: codex app-server-connection (regression) | **25 tests green** |
| Live smoke: npm fetch claude platform tarball → integrity → extract → spawn `--version` | **PASS** — `2.1.226 (Claude Code)`, mode `755`, 80.4 MB tarball |
| Desktop node typecheck (touched files) | No new errors (pre-existing unrelated failures only) |

P2 deliberately leaves:

- **R2 primary path** to P3 (installer is npm-only today; integrity still hard-fails)
- **Settings UI / first-run Setup** to P4
- **Dropping asarUnpack + deps** to P5 (bundled binaries remain as dev/fallback until then)
- **IPC surface** for enable/progress (main-process API is ready; renderer wiring is P4)

### 7.4 P3 result — R2 mirror + channel manifest

CDN layout under the existing `super-one-releases` bucket / `dl.super-one.dev`:

```
harness/manifest/<alpha|beta|stable>.json
harness/artifacts/<npm-name-sanitized>/<version>.tgz
```

Examples:

- `harness/artifacts/anthropic-ai--claude-agent-sdk-darwin-arm64/0.3.226.tgz`
- `harness/artifacts/openai--codex/0.146.1-darwin-arm64.tgz`

| Piece | Location |
|---|---|
| Path helpers + `fetchHarnessChannelManifest` | `packages/runtime/src/harness/cdn.ts` |
| Optional pin fields `url` / `npmName` / `npmVersion` | `ManagedArtifactPin` in `managed-release.ts` |
| Publish script | `scripts/publish-harness-artifacts.ts` (`bun run publish:harness -- --channel alpha`) |
| CI | `.github/workflows/publish-harness.yml` (workflow_dispatch; dry_run supported) |
| Desktop fetch order | R2 pin URL → npm registry; pin SHA-256 validates both |

Channel selection on desktop: `SUPERONE_HARNESS_CHANNEL` → `channelFromVersion(app version)` → `alpha`.

Pins always come from `OFFICIAL_CLAUDE_SDK_VERSION` / `OFFICIAL_CODEX_NPM_VERSION` in source — the workflow accepts only a channel, never free-form package versions.

Verification:

| Check | Result |
|---|---|
| runtime `cdn.test.ts` | **7 tests green** |
| desktop harness suite (incl. R2-first / npm fallback / sha256) | **15 tests green** |
| CLI `managed-harness-release` (pin parse compat) | green (optional CDN fields backward-compatible) |

Operational note: first production publish is a manual `workflow_dispatch` on `publish-harness` with `channel=alpha`. Until that runs, desktop continues to install from npm (manifest fetch soft-fails → npm path).

P3 leaves:

- **Settings UI / first-run Setup** to P4
- **Dropping asarUnpack + deps** to P5
- **Windows/Linux packaged spawn** still open from P0

### 7.5 P4 result — Settings → Harnesses

| Piece | Status |
|---|---|
| IPC `harness:list/enable/disable/probe/ensure` + `harness:installProgress` | ✅ |
| Main service progress listener + `installing` state | ✅ |
| Preload `window.app.listHarnesses` / enable / progress | ✅ |
| Settings tab **Harnesses** (list + detail, enable switch, progress) | ✅ |
| Nested Claude/Codex config as **tabs** (preferences / skills / MCP / …) | ✅ |
| Brand titles: LobeHub Text + one-line Claude Code wordmark | ✅ |
| Meta: version for SDK harnesses; command for ACP; single error surface | ✅ |
| Storybook install/progress/error mocks (`HarnessesSettingsPage.stories`) | ✅ |
| i18n en/zh | ✅ |
| Release skill harness publish step | ✅ (earlier) |
| First-run Setup wizard step | ⏳ deferred — still use Settings enable; existing `SETUP_*` claude install remains separate |
| Hard-filter HarnessPreferencePicker to enabled+ready only | ⏳ deferred to **P5** — while platform packages remain bundled, catalog-disabled would incorrectly empty pickers |

Until P5 drops bundles, enable in Settings is the path for on-demand install; pickers still list all harnesses (bundled binaries keep current sessions working).

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| ~~**Spawn blocked on macOS** despite upstream signing~~ | **Retired** — P0 verified under the notarized hardened-runtime app (§7.1) |
| ~~**Nested executables lose mode**~~ (`rg`, `zsh` under codex vendor) | **Retired** — P0 verified all 4 codex binaries keep `-rwxr-xr-x` through `tar -xzf` |
| **Windows SmartScreen** on downloaded executables | Still open. Verify on a packaged NSIS build before shipping Windows |
| **Platform-package naming drift** (codex uses version-suffixed aliases) | Fetcher maps specs explicitly per vendor (§4); a bare alias name 404s on npm |
| **267 MB download fails midway** in CN | Resumable ranged fetch + atomic rename means a partial download never activates. R2/CDN is the primary path specifically for this |
| **Manifest drifts from pinned constants** | CI reads the constants from source; never free-form input |
| **Two install kernels diverge** | Eliminated by the whole-kernel lift — this was the reason to prefer it over a desktop-local implementation |
| **Offline first run** | Setup step states the requirement explicitly; no silent failure mode |
