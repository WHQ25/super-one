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
  protocolVersion?: number
  capabilities?: EnvironmentCapabilities
  endpointProfiles: EndpointProfile[]
  preferredEndpointId?: string
  installationProfile?: InstallationProfile
  /** True when the refresh credential lives in memory only (§6.2 fail-closed). */
  credentialInMemoryOnly?: boolean
  updatedAt?: number
}

/**
 * Progress pushed while an environment is being added over SSH.
 * `installing` only appears when the host had no `superone` yet.
 * - `npm` — registry path (`@super-one/cli`)
 * - `upload` / `verify` / `extract` / `activate` — local dist upload path
 */
export type EnvironmentInstallProgress =
  | { phase: 'probing' }
  | {
      phase: 'installing'
      step: 'npm' | 'upload' | 'verify' | 'extract' | 'activate'
      detail?: string
    }
  | { phase: 'starting' }
  | { phase: 'pairing' }

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
