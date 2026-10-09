import type { EnvironmentCapabilities } from './capabilities'
import type { HandshakeGenerations } from './protocol'

export type EnvironmentOs = 'darwin' | 'linux' | 'windows'

export interface ExecutionEnvironmentPlatform {
  os: EnvironmentOs
  arch: string
}

/**
 * Authoritative descriptor for one SuperOne execution environment
 * (local desktop runtime or remote superone instance).
 */
export interface ExecutionEnvironmentDescriptor {
  environmentId: string
  label: string
  platform: ExecutionEnvironmentPlatform
  /**
   * JavaScript runtime version on the node (`process.version`), not the SuperOne
   * CLI package version. See `cliVersion` for the product release string.
   */
  nodeVersion: string
  /**
   * SuperOne CLI release version (lockstep with desktop, e.g. `0.49.5-alpha`).
   * Optional for older nodes; clients treat missing as unknown.
   */
  cliVersion?: string
  protocolVersion: number
  capabilities: EnvironmentCapabilities
  /** Optional handshake ranges; older peers may omit these. */
  generations?: HandshakeGenerations
  /** Node instance public-key fingerprint (hex). Local may omit until keying is wired. */
  nodePublicKeyFingerprint?: string
  /**
   * Absolute root of this environment's session sync zone, in its own path
   * separator (`<nodeHome>/sync`). Present iff `capabilities.syncZone`. The
   * desktop compares foreign paths against it textually and never resolves
   * it locally (`docs/architecture/session-sync-zone.md` §2).
   */
  syncRoot?: string
  /**
   * Hardware and OS, collected once per node process (so refreshed by a
   * restart or upgrade). Older nodes omit it.
   */
  machine?: EnvironmentMachine
}

/** Static facts an agent uses to pick a machine. Fields a host cannot read are omitted. */
export interface EnvironmentMachine {
  /** Human-readable OS name and version, e.g. `macOS 26.0`, `Ubuntu 24.04.1 LTS`. */
  os: string
  cpuModel?: string
  cpuCores: number
  memoryBytes: number
  /** GPU model names. */
  gpus?: string[]
}

/** What changes while a node runs, read on demand through `environment.status`. */
export interface EnvironmentLiveStatus {
  freeMemoryBytes: number
}

/** Well-known constant for the in-process desktop environment before identity is persisted. */
export const LOCAL_ENVIRONMENT_LABEL = 'This computer'
