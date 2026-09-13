/**
 * Prefix mapping between the desktop's sync zone and a node's
 * (`docs/design/session-sync-zone.md` §2).
 *
 * Each side canonicalises only its *own* root. A foreign path is compared
 * textually against the foreign root exactly as the node reported it, split
 * on the foreign OS's separator, and never `path.resolve`d here — a Windows
 * node's `C:\Users\…` must not be normalised by a macOS desktop.
 */
import type { EnvironmentOs } from '@superone/shared/environment'
import { sessionZoneDir, zoneRelativePath } from '../media-output-paths'
import { join } from 'node:path'

export interface NodeSyncZone {
  syncRoot: string
  os: EnvironmentOs
}

function foreignSep(os: EnvironmentOs): string {
  return os === 'windows' ? '\\' : '/'
}

function trimTrailing(path: string, sep: string): string {
  let end = path.length
  while (end > 1 && path[end - 1] === sep) end--
  return path.slice(0, end)
}

/** `<syncRoot><sep><sessionId><sep><relative…>` in the node's separator. */
export function nodeZonePath(zone: NodeSyncZone, sessionId: string, relativePath: string): string {
  const sep = foreignSep(zone.os)
  const rel = relativePath.split('/').join(sep)
  return `${trimTrailing(zone.syncRoot, sep)}${sep}${sessionId}${sep}${rel}`
}

/**
 * Split a node path under the node zone into `{ sessionId, relativePath }`
 * (relative in POSIX form), or null when it is not inside the zone.
 */
export function parseNodeZonePath(zone: NodeSyncZone, path: string): { sessionId: string; relativePath: string } | null {
  const sep = foreignSep(zone.os)
  const root = trimTrailing(zone.syncRoot, sep)
  const cmp = zone.os === 'windows' ? (a: string, b: string) => a.toLowerCase() === b.toLowerCase() : (a: string, b: string) => a === b
  if (path.length <= root.length + 1 || !cmp(path.slice(0, root.length), root) || path[root.length] !== sep) return null
  const rest = path.slice(root.length + 1).split(sep).filter((part) => part.length > 0)
  if (rest.length < 2 || rest.some((part) => part === '.' || part === '..')) return null
  const [sessionId, ...tail] = rest
  return { sessionId, relativePath: tail.join('/') }
}

/** Desktop twin of a node zone path: `<userData>/sync/<sessionId>/<relative>`. */
export function desktopMirrorPath(sessionId: string, relativePath: string): string {
  return join(sessionZoneDir(sessionId), ...relativePath.split('/'))
}

/** Node twin of a desktop zone path, or null when the path is not in this desktop's zone. */
export function nodeTwinOf(zone: NodeSyncZone, desktopPath: string): string | null {
  const parsed = zoneRelativePath(desktopPath)
  if (!parsed) return null
  return nodeZonePath(zone, parsed.sessionId, parsed.relativePath)
}

/**
 * Replace every exact occurrence of each desktop path with its node twin in
 * `text`. Both the raw form and the JSON-escaped form are replaced, because
 * the executor sees serialised JSON where a Windows desktop path carries
 * doubled backslashes. Exact string match only — no prefix scan (§3).
 */
export function rewriteArtifactPaths(text: string, mapping: ReadonlyMap<string, string>): string {
  let out = text
  for (const [from, to] of mapping) {
    if (!from) continue
    out = out.split(from).join(to)
    const fromJson = JSON.stringify(from).slice(1, -1)
    if (fromJson !== from) out = out.split(fromJson).join(JSON.stringify(to).slice(1, -1))
  }
  return out
}

/**
 * §3.1 — walk structured args and map every string under the node zone to
 * its desktop mirror path. Returns the mapped args and the zone refs that
 * were touched so the caller can make sure each one is mirrored first.
 */
export function mapNodeZoneArgs(
  zone: NodeSyncZone,
  args: unknown,
): { args: unknown; refs: { sessionId: string; relativePath: string; desktopPath: string }[] } {
  const refs: { sessionId: string; relativePath: string; desktopPath: string }[] = []
  const seen = new Set<string>()
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const parsed = parseNodeZonePath(zone, value)
      if (!parsed) return value
      const desktopPath = desktopMirrorPath(parsed.sessionId, parsed.relativePath)
      if (!seen.has(desktopPath)) {
        seen.add(desktopPath)
        refs.push({ ...parsed, desktopPath })
      }
      return desktopPath
    }
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = walk(inner)
      return out
    }
    return value
  }
  return { args: walk(args), refs }
}
