import type { UpdateChannel } from '@superone/shared/agent-types'
import {
  UPDATE_CHANNEL_TO_YML,
  channelFromVersion,
  type YmlChannel,
} from '@superone/shared/update-channels'

// Stability order, most stable first. A release on channel N is also offered to
// every less-stable channel after it (cascade), so alpha users still receive
// beta/stable builds and beta users still receive stable builds.
export const YML_CHANNELS_BY_STABILITY: readonly YmlChannel[] = ['latest', 'beta', 'alpha']

export const YML_TO_UPDATE_CHANNEL: Record<YmlChannel, UpdateChannel> = {
  latest: 'stable',
  beta: 'beta',
  alpha: 'alpha',
}

export function nativeYmlChannel(version: string): YmlChannel {
  return UPDATE_CHANNEL_TO_YML[channelFromVersion(version)]
}

export function cascadeTargets(channel: YmlChannel): YmlChannel[] {
  return YML_CHANNELS_BY_STABILITY.slice(YML_CHANNELS_BY_STABILITY.indexOf(channel))
}

interface ParsedVersion {
  core: [number, number, number]
  pre: string[]
}

function parseVersion(version: string): ParsedVersion {
  const clean = version.trim().replace(/^v/i, '').split('+')[0]
  const dash = clean.indexOf('-')
  const coreStr = dash === -1 ? clean : clean.slice(0, dash)
  const preStr = dash === -1 ? '' : clean.slice(dash + 1)
  const parts = coreStr.split('.').map((n) => Number(n) || 0)
  return {
    core: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0],
    pre: preStr ? preStr.split('.') : [],
  }
}

// SemVer precedence: returns -1 | 0 | 1. A release with a prerelease tag ranks
// below the same core version without one (1.0.0-alpha < 1.0.0).
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1
  if (pb.pre.length === 0) return -1
  const n = Math.min(pa.pre.length, pb.pre.length)
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
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

// Whether `next` should overwrite a channel currently pointing at `current`.
// Equal versions re-publish (idempotent); older versions never clobber newer.
export function shouldPublish(next: string, current: string | null): boolean {
  return current === null || compareVersions(next, current) >= 0
}

// Prefix every `url:` / `path:` value in a channel manifest with `v${version}/`,
// matching the R2 layout (binaries live under the version subdir). Leaves values
// already prefixed or absolute untouched. Relocates the flat manifests archived
// on the GitHub Release onto R2's versioned layout.
export function prefixVersionPaths(ymlText: string, version: string): string {
  const prefix = `v${version}/`
  return ymlText.replace(/^(\s*-?\s*(?:url|path):\s+)(.+?)\s*$/gm, (_m, head: string, value: string) => {
    if (value.startsWith(prefix) || /^https?:\/\//.test(value)) return `${head}${value}`
    return `${head}${prefix}${value}`
  })
}

// Strip the version token (and its leading separator) from an artifact filename
// to produce a stable, version-less "latest" download name.
// "SuperOne-0.40.0-alpha-arm64.dmg" -> "SuperOne-arm64.dmg"
// "SuperOne Setup 0.40.1-alpha.exe" -> "SuperOne Setup.exe"
export function fixedLinkName(filename: string, version: string): string {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const withoutVersion = filename.replace(new RegExp(`[ ._-]?${escaped}`), '')
  if (!withoutVersion.toLowerCase().endsWith('.exe')) return withoutVersion
  const stem = withoutVersion.slice(0, -'.exe'.length).replaceAll('.', ' ')
  return `${stem}.exe`
}

// Stable, version-less download URL path for a channel's newest build, e.g.
// fixedDownloadPath('alpha', 'SuperOne.dmg') -> 'alpha/latest/SuperOne.dmg'.
export function fixedDownloadPath(channel: UpdateChannel, fileName: string): string {
  return `${channel}/latest/${fileName}`
}

// GitHub normalizes spaces in release asset names to dots. Releases archived
// through the legacy GitHub bridge can therefore have a dotted Windows binary
// on R2 even though electron-builder's manifest still contains spaces.
export function artifactPathCandidates(path: string): string[] {
  if (!path.toLowerCase().endsWith('.exe')) return [path]
  const slash = path.lastIndexOf('/') + 1
  const dotted = `${path.slice(0, slash)}${path.slice(slash).replaceAll(' ', '.')}`
  return dotted === path ? [path] : [path, dotted]
}
