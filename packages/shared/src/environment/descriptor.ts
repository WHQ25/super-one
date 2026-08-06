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
}

/** Well-known constant for the in-process desktop environment before identity is persisted. */
export const LOCAL_ENVIRONMENT_LABEL = 'This computer'
