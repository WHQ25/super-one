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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A path token ends where the path would: not before another path character,
 * and not before `.ext` (so `shot.png` is not a mention of `shot.png.bak`),
 * while a sentence-ending `shot.png.` still counts.
 */
function tokenPattern(path: string): RegExp {
  return new RegExp(`${escapeRegExp(path)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`, 'g')
}

function replaceTokens(text: string, from: string, to: string): string {
  return text.replace(tokenPattern(from), () => to)
}

/** Does `text` name `path` as a whole token, raw or JSON-escaped? */
export function mentionsArtifactPath(text: string, path: string): boolean {
  if (!path) return false
  if (tokenPattern(path).test(text)) return true
  const escaped = JSON.stringify(path).slice(1, -1)
  return escaped !== path && tokenPattern(escaped).test(text)
}

function looksLikeJson(text: string): boolean {
  const c = text.trimStart()[0]
  return c === '{' || c === '['
}

/**
 * Rewrite one string: parse it as JSON when it is JSON and rewrite the string
 * values at their own level (so a Windows twin is escaped by the serialiser
 * instead of breaking the document); otherwise replace tokens in the text,
 * raw and — for a desktop path that JSON doubles — escaped.
 */
function rewriteString(text: string, entries: ReadonlyArray<readonly [string, string]>): string {
  if (looksLikeJson(text)) {
    try {
      const value = JSON.parse(text) as unknown
      if (value && typeof value === 'object') return JSON.stringify(rewriteValue(value, entries))
    } catch {
      /* not JSON after all: fall through to text */
    }
  }
  let out = text
  for (const [from, to] of entries) {
    out = replaceTokens(out, from, to)
    const fromJson = JSON.stringify(from).slice(1, -1)
    if (fromJson !== from) out = replaceTokens(out, fromJson, JSON.stringify(to).slice(1, -1))
  }
  return out
}

function rewriteValue(value: unknown, entries: ReadonlyArray<readonly [string, string]>): unknown {
  if (typeof value === 'string') return rewriteString(value, entries)
  if (Array.isArray(value)) return value.map((v) => rewriteValue(v, entries))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = rewriteValue(v, entries)
    return out
  }
  return value
}

/**
 * Replace every whole-token occurrence of each desktop path with its node twin
 * in `text` (§3). JSON text is rewritten value by value and re-serialised;
 * plain text by token. Longest path first, so a registered path that is a
 * prefix of another (`shot.png` / `shot.png.agent.jpg`) cannot eat it.
 * No prefix scan: only the paths in `mapping` are touched.
 */
export function rewriteArtifactPaths(text: string, mapping: ReadonlyMap<string, string>): string {
  const entries = [...mapping.entries()].filter(([from]) => from.length > 0).sort((a, b) => b[0].length - a[0].length)
  if (entries.length === 0) return text
  return rewriteString(text, entries)
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
