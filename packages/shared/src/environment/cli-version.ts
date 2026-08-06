/**
 * SuperOne CLI / desktop version comparison for remote-node install policy.
 *
 * Compatibility product rules:
 * - No remote CLI → install desktop-pinned version
 * - Desktop == node → reuse
 * - Desktop > node → upgrade node to desktop version (never silent downgrade)
 * - Desktop < node → block; user must upgrade the desktop app first
 *
 * Protocol/schema generations remain the runtime handshake floor; this layer is
 * the user-facing version gate for multi-client nodes.
 */

export type CliVersionRelation = 'equal' | 'desktop_newer' | 'desktop_older' | 'unknown'

export type CliVersionDecision =
  | { action: 'install'; targetVersion: string }
  | { action: 'reuse'; remoteVersion: string | null }
  | { action: 'upgrade_node'; targetVersion: string; remoteVersion: string }
  | {
      action: 'upgrade_desktop'
      desktopVersion: string
      remoteVersion: string
      message: string
      code: 'desktop_upgrade_required'
    }
  /**
   * Remote binary exists but its SuperOne version could not be read.
   * Prefer upgrading to the desktop pin (install/replace) so old installs
   * without a version command still converge; never treat as "newer node".
   */
  | { action: 'upgrade_node_unknown'; targetVersion: string; remotePath: string }

/** Error code thrown when desktop is older than the remote node CLI. */
export const DESKTOP_UPGRADE_REQUIRED = 'desktop_upgrade_required' as const

interface ParsedVersion {
  core: [number, number, number]
  pre: string[]
}

function parseVersion(version: string): ParsedVersion {
  const clean = version.trim().replace(/^v/i, '').split('+')[0] ?? ''
  const dash = clean.indexOf('-')
  const coreStr = dash === -1 ? clean : clean.slice(0, dash)
  const preStr = dash === -1 ? '' : clean.slice(dash + 1)
  const parts = coreStr.split('.').map((n) => Number(n) || 0)
  return {
    core: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0],
    pre: preStr ? preStr.split('.') : [],
  }
}

/**
 * SemVer-ish compare: -1 | 0 | 1.
 * Prerelease ranks below the same core without prerelease (1.0.0-alpha < 1.0.0).
 * Matches release channel ordering used by set-latest.
 */
export function compareCliVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i]! < pb.core[i]! ? -1 : 1
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1
  if (pb.pre.length === 0) return -1
  const n = Math.min(pa.pre.length, pb.pre.length)
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i]!
    const y = pb.pre[i]!
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const dx = Number(x)
      const dy = Number(y)
      if (dx !== dy) return dx < dy ? -1 : 1
    } else if (xn !== yn) {
      return xn ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  if (pa.pre.length !== pb.pre.length) return pa.pre.length < pb.pre.length ? -1 : 1
  return 0
}

export function relationDesktopToRemote(
  desktopVersion: string,
  remoteVersion: string | null | undefined,
): CliVersionRelation {
  const d = desktopVersion?.trim()
  const r = remoteVersion?.trim()
  if (!d || !r) return 'unknown'
  const cmp = compareCliVersions(d, r)
  if (cmp === 0) return 'equal'
  if (cmp > 0) return 'desktop_newer'
  return 'desktop_older'
}

export function desktopUpgradeRequiredMessage(
  desktopVersion: string,
  remoteVersion: string,
): string {
  return (
    `This remote node runs SuperOne CLI ${remoteVersion}, which is newer than ` +
    `this desktop app (${desktopVersion}). Upgrade SuperOne on this computer ` +
    `to ${remoteVersion} or later before connecting. The node will not be downgraded.`
  )
}

/**
 * Decide install/reuse/upgrade for SSH bootstrap when discovering a remote host.
 *
 * @param desktopVersion pinned desktop / registry target version
 * @param remotePath absolute path to superone on the host, or null if missing
 * @param remoteVersion SuperOne CLI version if known
 */
export function decideRemoteCliAction(input: {
  desktopVersion: string
  remotePath: string | null
  remoteVersion: string | null
}): CliVersionDecision {
  const desktopVersion = input.desktopVersion.trim()
  if (!desktopVersion || desktopVersion === 'latest') {
    throw new Error('desktopVersion must be a concrete SuperOne version, not latest')
  }

  if (!input.remotePath) {
    return { action: 'install', targetVersion: desktopVersion }
  }

  const remoteVersion = input.remoteVersion?.trim() || null
  if (!remoteVersion) {
    return {
      action: 'upgrade_node_unknown',
      targetVersion: desktopVersion,
      remotePath: input.remotePath,
    }
  }

  const rel = relationDesktopToRemote(desktopVersion, remoteVersion)
  if (rel === 'equal') {
    return { action: 'reuse', remoteVersion }
  }
  if (rel === 'desktop_newer') {
    return {
      action: 'upgrade_node',
      targetVersion: desktopVersion,
      remoteVersion,
    }
  }
  // desktop_older (or unknown with both set — treated via compare)
  return {
    action: 'upgrade_desktop',
    desktopVersion,
    remoteVersion,
    message: desktopUpgradeRequiredMessage(desktopVersion, remoteVersion),
    code: DESKTOP_UPGRADE_REQUIRED,
  }
}

/** True when connect/list should refuse because the node CLI is newer than desktop. */
export function shouldBlockDesktopForNewerNode(
  desktopVersion: string,
  remoteCliVersion: string | null | undefined,
): boolean {
  return relationDesktopToRemote(desktopVersion, remoteCliVersion) === 'desktop_older'
}
