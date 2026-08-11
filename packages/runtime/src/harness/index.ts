/**
 * Harness installation kernel.
 *
 * Owns digest verification, atomic install into immutable version dirs, the
 * installation state machine, and readiness probing. Host-specific concerns
 * (paths, byte fetching, binary discovery, auth) are injected — see `types.ts`.
 *
 * Hosts: `apps/cli` (npm installer) and `apps/desktop` (tarball installer).
 * Both use the same harness root: `~/.superone/harness`
 * (`resolveHarnessHomeRoot` / `SUPERONE_HARNESS_HOME`).
 *
 * Network install layout (`managed-layout.ts`):
 * `<id>/versions/<runtimeVersion>/` + `current` pointer under the harness root.
 */

export * from './types'
export * from './manager'
export * from './home-path'
export * from './managed-layout'
export * from './managed-release'
export * from './managed-official'
export * from './tarball-fetch'
export * from './resumable-download'
export * from './managed-tarball-installer'
export * from './runtime-ready'
export * from './enable'
export * from './cdn'
