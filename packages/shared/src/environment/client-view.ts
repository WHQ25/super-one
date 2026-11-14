/**
 * Renderer-facing view model for the environment management UI.
 *
 * The renderer never holds sockets or credentials (design §5.1), so it receives
 * a flattened projection of KnownEnvironment + supervisor state + descriptor
 * over IPC instead of a gateway handle.
 */

import type { EnvironmentCapabilities } from './capabilities'
import type { EnvironmentMachine } from './descriptor'
import type { EndpointKind, EndpointProfile, InstallationProfile } from './known-environment'
import type { SupervisorState } from './connection-supervisor-core'
import type { NodeLinkPath } from './node-route'

export interface EnvironmentListItem {
  /** `local` for the desktop runtime; a UUID for paired remote nodes. */
  connectionId: string
  environmentId: string
  /** Earlier ids references may carry (`ExecutionEnvironmentDescriptor.environmentAliases`). */
  environmentAliases?: string[]
  label: string
  kind: 'local' | 'remote'
  /** Local is always `connected`; remote reflects its supervisor. */
  state: SupervisorState
  /**
   * `false` after an explicit disconnect: stay down until the user connects.
   * Omitted (legacy records) or `true`: callers may dial on their own.
   * Do not auto-connect when this is `false`.
   */
  desired?: boolean
  blockReason?: string
  lastError?: string
  /** Present once an authenticated descriptor exchange has happened. */
  nodePublicKeyFingerprint?: string
  /** How the live connection reaches the node (LAN, Tailscale, relay, …); absent while not connected. */
  activePath?: NodeLinkPath
  platform?: { os: string; arch: string }
  nodeVersion?: string
  /** SuperOne CLI package version when known (not Node.js runtime). */
  cliVersion?: string
  protocolVersion?: number
  capabilities?: EnvironmentCapabilities
  /**
   * Chip, installed memory, and OS. Remote keeps the last connected descriptor
   * so those lines stay up while offline. Local is read in-process.
   */
  machine?: EnvironmentMachine
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

/**
 * Pair with a node. Either a single known `baseUrl` (SSH bootstrap, local lab),
 * or the routes from a desktop node's pairing code, from which main picks LAN
 * (also found by mDNS for `environmentId`), then Tailscale, then the relay.
 */
export interface PairRemoteInput {
  baseUrl?: string
  environmentId?: string
  endpointProfiles?: EndpointProfile[]
  pairingToken: string
  /** Name this computer stores for the node. */
  label: string
  /** Name the node shows for this computer ("Started from …"); defaults to `label`. */
  deviceLabel?: string
  /** Encrypted-channel credential carried by the node's pairing code. */
  channel?: { keyId: string; secretHex: string }
}

/**
 * Re-pair a known connection with a fresh token. With `baseUrl` the exchange
 * goes there (an SSH node's tunnel is rebuilt first); without it, main picks
 * the route like any dial, using a fresh pairing code's routes when given.
 */
export interface RepairPairingInput {
  connectionId: string
  baseUrl?: string
  pairingToken: string
  channel?: { keyId: string; secretHex: string }
  endpointProfiles?: EndpointProfile[]
}

export interface NodeUpgradeAvailability {
  /**
   * CLI version currently running on the node; null when the node refused
   * this desktop's protocol generation before it could report one.
   */
  remoteVersion: string | null
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
      step: 'build' | 'npm' | 'upload' | 'verify' | 'extract' | 'activate'
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

/**
 * Side-by-side node installations on one host user. Each channel owns its data
 * root, loopback port, command link and systemd unit, so a dev node never
 * touches alpha or stable state.
 */
export type NodeChannel = 'stable' | 'alpha' | 'dev'

export const DEFAULT_NODE_REMOTE_PORT = 7788
const NODE_CHANNEL_PORTS: Record<NodeChannel, number> = { stable: DEFAULT_NODE_REMOTE_PORT, alpha: 7790, dev: 7792 }

/** Unknown or missing variants are stable, matching `resolveSuperoneHome`. */
export function nodeChannelForVariant(variant: string | undefined): NodeChannel {
  return variant === 'alpha' || variant === 'dev' ? variant : 'stable'
}

export function defaultNodeRemotePort(channel: NodeChannel): number {
  return NODE_CHANNEL_PORTS[channel]
}

/** Command link name in `~/.local/bin`; the systemd unit is `<name>.service`. */
export function nodeCliName(channel: NodeChannel): string {
  return channel === 'stable' ? 'superone' : `superone-${channel}`
}

/**
 * Another channel whose default install a node target points at, or null.
 * Paths may be absolute or `~/`-relative; homes and launchers are matched by
 * their channel-specific suffix, so the remote `$HOME` is not needed.
 */
export function otherNodeChannelOf(
  own: NodeChannel,
  target: { nodeHome?: string; port?: number; remoteExec?: string },
): NodeChannel | null {
  const nodeHome = target.nodeHome?.trim().replace(/\/+$/, '')
  const exec = target.remoteExec?.trim()
  for (const channel of Object.keys(NODE_CHANNEL_PORTS) as NodeChannel[]) {
    if (channel === own) continue
    const root = channel === 'stable' ? '/.superone' : `/.superone/${channel}`
    const ownsExec = exec !== undefined && (
      exec.endsWith(`/.local/bin/${nodeCliName(channel)}`)
      || ['npm', 'current', 'versions'].some((dir) => exec.includes(`${root}/${dir}/`))
    )
    if (nodeHome?.endsWith(`${root}/node`) || target.port === NODE_CHANNEL_PORTS[channel] || ownsExec) return channel
  }
  return null
}

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

/**
 * A dev desktop redeploys its build over the repair SSH profile, and only to a
 * node outside the stable and alpha installs (main enforces the same rule).
 */
export function canRedeployDevNode(item: {
  endpointProfiles: EndpointProfile[]
  preferredEndpointId?: string
}): boolean {
  const profile = selectSshRepairProfile(item.endpointProfiles, item.preferredEndpointId)
  const spec = profile ? tunnelSpecFromEndpoint(profile) : null
  return spec != null && otherNodeChannelOf('dev', { nodeHome: profile!.ssh?.remoteNodeHome, port: spec.remotePort }) === null
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
  'relay',
  'local',
]

/** Whether `environmentId` names this environment, by its id or an alias. */
export function isEnvironment(item: Pick<EnvironmentListItem, 'environmentId' | 'environmentAliases'>, environmentId: string): boolean {
  return item.environmentId === environmentId || (item.environmentAliases?.includes(environmentId) ?? false)
}
