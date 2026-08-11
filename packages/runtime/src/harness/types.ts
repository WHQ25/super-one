/**
 * Injection seams for the harness installation kernel.
 *
 * The kernel owns the parts that must never be implemented twice: digest
 * verification, atomic install into immutable version dirs, the state machine,
 * and readiness probing. Everything host-specific — where files live, how bytes
 * are fetched, which binary resolver applies, how auth is checked — arrives
 * through these interfaces.
 *
 * Hosts: `apps/cli` (npm-based fetch, $NODE_HOME) and `apps/desktop`
 * (HTTP tarball fetch, ~/.superone/harness).
 */

import type { HarnessInstallationStatus, NodeHarnessId } from '@superone/shared/environment'
import type { ManagedHarnessId } from './managed-release'

/**
 * Filesystem root for harness runtimes — **one path for CLI + desktop**:
 * `~/.superone/harness` (see `resolveHarnessHomeRoot` / `SUPERONE_HARNESS_HOME`).
 *
 * - Network installs: `<root>/<id>/versions/<runtimeVersion>/` + `current`
 * - Offline SuperOne artifacts: `<root>/releases/<cliVersion>/harnesses/<id>/…`
 * - Partial download cache: `<root>/.download/`
 *
 * Node identity/state (`state.sqlite`, pairing) stays under `~/.superone/node`
 * and is not mixed into this tree.
 */
export interface HarnessHome {
  root: string
}

/** A runtime already present on the host, discovered at enable time. */
export interface ResolvedAutoRuntime {
  command: string
  /** Non-secret provenance label persisted into config_json (e.g. `agent-sdk-optional`). */
  source: string
  runtimeVersion?: string
}

/**
 * Read-only catalog view. This is the minimal surface binary resolvers need —
 * depend on this rather than the concrete `HarnessManager` so resolvers stay
 * usable from any host.
 */
export interface HarnessCatalogReader {
  get(id: NodeHarnessId): HarnessInstallationStatus
}

/**
 * Host-specific binary discovery. The kernel never hardcodes how a harness
 * runtime is found — the CLI consults env vars + PATH, the desktop consults its
 * managed install root.
 */
export interface HarnessRuntimeResolver {
  /** Binary resolvable right now (catalog command, env override, PATH). */
  resolveBinary(id: NodeHarnessId, harnesses: HarnessCatalogReader): string | null
  /**
   * Runtime usable even without a catalog command — a bundled SDK platform
   * package or an env pin. Drives the `needs_auth → ready` host-login path.
   */
  isRunnableWithoutCatalog(id: NodeHarnessId): boolean
  /** Detect an already-installed managed runtime when enabling. */
  autoRuntime(id: ManagedHarnessId): ResolvedAutoRuntime | null
}

/**
 * Provider-credential check. Returns null when the host has no provider store,
 * letting the kernel fall back to host-login heuristics.
 */
export interface HarnessAuthProbe {
  hasCredentialFor(id: NodeHarnessId): { ok: true; reason: string } | null
}

export interface InstalledManagedRuntime {
  command: string
  runtimeVersion: string
  /** Non-secret provenance label (e.g. `official-npm`, `r2-tarball`). */
  source: string
  /** Extra non-secret fields merged into the persisted config_json. */
  detail?: Record<string, string | undefined>
}

/**
 * Fetch + install a pinned managed runtime. Both CLI and desktop use
 * `createManagedTarballInstaller` (R2 → npm tarball). Implementations MUST
 * verify integrity before returning.
 */
export interface ManagedRuntimeInstaller {
  install(
    id: ManagedHarnessId,
    home: HarnessHome,
    onProgress?: (received: number, total: number) => void,
  ): Promise<InstalledManagedRuntime>
}

/** Everything the kernel needs from its host. */
export interface HarnessKernelDeps {
  home: HarnessHome
  /** Pins managed artifact versions; the CLI passes its release version. */
  releaseVersion: string
  resolver: HarnessRuntimeResolver
  installer: ManagedRuntimeInstaller
  auth?: HarnessAuthProbe | null
}
