/**
 * Client-local connection metadata. Not authoritative runtime state.
 */

export type EndpointKind = 'direct-wss' | 'tailscale' | 'ssh-forward' | 'relay' | 'local'

export type InstallationProfile =
  | 'systemd-user'
  | 'systemd-system'
  | 'container'
  /** Explicit degraded install: nohup / foreground without OS service supervision. */
  | 'nohup'
  | 'manual'
  | 'local-electron'

export interface EndpointProfile {
  endpointId: string
  kind: EndpointKind
  /** Display label, e.g. hostname or "SSH: user@host". */
  label: string
  /**
   * Connection target depending on kind:
   * - direct-wss / tailscale / relay: wss URL or host:port
   * - ssh-forward: OpenSSH destination (user@host or Host alias)
   * - local: empty / unused
   */
  target: string
  /** Optional SSH-specific fields for ssh-forward endpoints. */
  ssh?: {
    port?: number
    identityFile?: string
    /** Remote node loopback port after install (default 7788). */
    remotePort?: number
  }
  /** Last successful connection timestamp (ms), client-local. */
  lastSuccessAt?: number
}

/**
 * A manually entered endpoint before the first authenticated descriptor
 * exchange binds it to a verified environment identity.
 */
export interface PendingConnectionProfile {
  connectionId: string
  label: string
  endpointProfiles: EndpointProfile[]
  preferredEndpointId?: string
  installationProfile?: InstallationProfile
}

/**
 * After authentication, the profile is atomically bound to a node identity.
 * Secrets are stored separately and referenced by connectionId.
 */
export interface KnownEnvironment {
  connectionId: string
  environmentId: string
  nodePublicKeyFingerprint: string
  label: string
  endpointProfiles: EndpointProfile[]
  preferredEndpointId?: string
  installationProfile?: InstallationProfile
  /**
   * Whether the desktop should keep this connection up automatically.
   * - `true` / omitted (legacy migration): auto-connect on startup and wake
   * - `false`: user explicitly disconnected; stay down until Connect
   */
  desired?: boolean
  /** Client-local presentation only. */
  createdAt: number
  updatedAt: number
}

/** Synthetic known-environment entry for the local desktop runtime. */
export interface LocalKnownEnvironment {
  connectionId: 'local'
  environmentId: string
  label: string
  endpointProfiles: Array<EndpointProfile & { kind: 'local' }>
  installationProfile: 'local-electron'
  createdAt: number
  updatedAt: number
}
