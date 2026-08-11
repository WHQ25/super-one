/**
 * Renderer-facing view model for the environment management UI.
 *
 * The renderer never holds sockets or credentials (design §5.1), so it receives
 * a flattened projection of KnownEnvironment + supervisor state + descriptor
 * over IPC instead of a gateway handle.
 */

import type { EnvironmentCapabilities } from './capabilities'
import type { EndpointKind, EndpointProfile, InstallationProfile } from './known-environment'
import type { SupervisorState } from './connection-supervisor-core'

export interface EnvironmentListItem {
  /** `local` for the desktop runtime; a UUID for paired remote nodes. */
  connectionId: string
  environmentId: string
  label: string
  kind: 'local' | 'remote'
  /** Local is always `connected`; remote reflects its supervisor. */
  state: SupervisorState
  blockReason?: string
  lastError?: string
  /** Present once an authenticated descriptor exchange has happened. */
  nodePublicKeyFingerprint?: string
  platform?: { os: string; arch: string }
  nodeVersion?: string
  /** SuperOne CLI package version when known (not Node.js runtime). */
  cliVersion?: string
  protocolVersion?: number
  capabilities?: EnvironmentCapabilities
  endpointProfiles: EndpointProfile[]
  preferredEndpointId?: string
  installationProfile?: InstallationProfile
  /** True when the refresh credential lives in memory only (§6.2 fail-closed). */
  credentialInMemoryOnly?: boolean
  /**
   * Set while the node CLI is older than this desktop. `connect` never upgrades
   * a node on its own — it can be shared by other desktops — so this drives an
   * explicit opt-in affordance instead.
   */
  nodeUpgrade?: NodeUpgradeAvailability
  updatedAt?: number
}

export interface NodeUpgradeAvailability {
  /** CLI version currently running on the node. */
  remoteVersion: string
  /** Version this desktop would install. */
  targetVersion: string
  /**
   * False when no ssh-forward endpoint is stored: the desktop reaches the node
   * over a plain socket and cannot run the installer, so the UI must fall back
   * to showing the manual command.
   */
  canUpgradeOverSsh: boolean
}

/**
 * Progress pushed while an environment is being added, upgraded, or repaired
 * over SSH. Optional correlation fields let the renderer ignore cross-talk
 * between concurrent operations (e.g. repair must not drive the Add dialog).
 *
 * `installing` appears when the host has no CLI yet or needs a version upgrade.
 * - `npm` — registry path (`@super-one/cli`)
 * - `upload` / `verify` / `extract` / `activate` — local dist upload path
 */
export type EnvironmentInstallOperation = 'add' | 'upgrade' | 'repair'

type EnvironmentInstallProgressMeta = {
  /** Present for upgrade/repair (known connection). Absent during first-time add. */
  connectionId?: string
  operation?: EnvironmentInstallOperation
}

export type EnvironmentInstallProgress =
  | ({ phase: 'probing' } & EnvironmentInstallProgressMeta)
  | ({
      phase: 'installing'
      step: 'npm' | 'upload' | 'verify' | 'extract' | 'activate'
      detail?: string
    } & EnvironmentInstallProgressMeta)
  | ({ phase: 'starting' } & EnvironmentInstallProgressMeta)
  | ({ phase: 'pairing' } & EnvironmentInstallProgressMeta)

/** Connection parameters for rebuilding an SSH local forward after app restart. */
export interface SshTunnelSpec {
  /** OpenSSH destination: `user@host` or a `~/.ssh/config` Host alias. */
  destination: string
  /** Node loopback port on the remote host. */
  remotePort: number
  sshPort?: number
  identityFile?: string
}

export const DEFAULT_NODE_REMOTE_PORT = 7788

/**
 * Derive tunnel parameters from a stored endpoint profile.
 * Returns null for endpoint kinds that are reachable without a local forward.
 */
export function tunnelSpecFromEndpoint(profile: EndpointProfile): SshTunnelSpec | null {
  if (profile.kind !== 'ssh-forward') return null
  if (!profile.target) return null
  return {
    destination: profile.target,
    remotePort: profile.ssh?.remotePort ?? DEFAULT_NODE_REMOTE_PORT,
    sshPort: profile.ssh?.port,
    identityFile: profile.ssh?.identityFile,
  }
}

/**
 * Pick which ssh-forward profile may be used for **automated** administrative
 * repair (mint pairing token on the host).
 *
 * Policy (deliberately narrow — a stale SSH backup must not steal recovery):
 * - Preferred endpoint is ssh-forward with a target → that profile.
 * - Preferred endpoint is non-SSH (direct-wss / tailscale / …) → null; caller
 *   must use manual token paste instead of probing an arbitrary backup.
 * - No preferred id → first usable ssh-forward profile.
 */
export function selectSshRepairProfile(
  profiles: EndpointProfile[],
  preferredEndpointId?: string,
): EndpointProfile | null {
  const sshProfiles = profiles.filter((p) => p.kind === 'ssh-forward' && Boolean(p.target?.trim()))
  if (sshProfiles.length === 0) return null

  if (preferredEndpointId) {
    const preferred = profiles.find((p) => p.endpointId === preferredEndpointId)
    if (preferred?.kind === 'ssh-forward' && preferred.target?.trim()) {
      return preferred
    }
    // Preferred is something else (or missing from the list): do not fall back
    // to the first SSH row — that backup may be obsolete or a different host.
    if (preferred && preferred.kind !== 'ssh-forward') {
      return null
    }
  }

  return sshProfiles[0] ?? null
}

/** True when automated SSH repair may run for this list-item projection. */
export function canRepairOverSsh(item: {
  endpointProfiles: EndpointProfile[]
  preferredEndpointId?: string
}): boolean {
  return selectSshRepairProfile(item.endpointProfiles, item.preferredEndpointId) != null
}

/** Extra `ssh` argv for a tunnel spec — port and identity file only. */
export function sshArgsForSpec(spec: SshTunnelSpec): string[] {
  const args: string[] = []
  if (spec.sshPort) args.push('-p', String(spec.sshPort))
  if (spec.identityFile) args.push('-i', spec.identityFile)
  return args
}

/** Endpoint kinds the desktop can currently open a connection through. */
export const CONNECTABLE_ENDPOINT_KINDS: EndpointKind[] = [
  'direct-wss',
  'tailscale',
  'ssh-forward',
  'local',
]
