/**
 * Harness installation kernel.
 *
 * Owns digest verification, atomic install into immutable version dirs, the
 * installation state machine, and readiness probing. Host-specific concerns
 * (paths, byte fetching, binary discovery, auth) are injected — see `types.ts`.
 *
 * Hosts: `apps/cli` (npm installer, $NODE_HOME) and `apps/desktop`
 * (tarball installer, ~/.superone/harness).
 */

export * from './types'
export * from './manager'
export * from './managed-release'
export * from './managed-official'
export * from './runtime-ready'
export * from './enable'
