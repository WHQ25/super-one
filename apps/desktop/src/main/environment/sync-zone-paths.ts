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
  // On Windows a backslash cannot appear in a file name, so `/` is always a
  // separator too — and it has to be accepted, because anything that carries
  // the path through a URL or JSON normalises it (`encodeRemoteMediaUrl`
  // does). On POSIX a backslash is an ordinary character and stays one.
  const windows = zone.os === 'windows'
  const normalise = (value: string) => (windows ? value.replace(/\\/g, '/') : value)
  const isSep = (ch: string) => ch === sep || (windows && ch === '/')
  const root = trimTrailing(zone.syncRoot, sep)
  const cmp = windows
    ? (a: string, b: string) => normalise(a).toLowerCase() === normalise(b).toLowerCase()
    : (a: string, b: string) => a === b
  if (path.length <= root.length + 1 || !cmp(path.slice(0, root.length), root) || !isSep(path[root.length]!)) return null
  const rest = normalise(path.slice(root.length + 1)).split(windows ? '/' : sep).filter((part) => part.length > 0)
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
 * A path token has a path on neither side of it. Both boundaries matter and
 * for different reasons: without the left one the match is a substring search,
 * so `/tmp/a.png` "occurs" inside `/other/tmp/a.png` and rewriting it splices
 * a node path into the middle of somebody else's; the right one is what keeps
 * `shot.png` from matching `shot.png.bak`, `shot.png/child` or `shot.png(1)`,
 * while a sentence-ending `shot.png.` still counts.
 */
const PATH_BEFORE = '[A-Za-z0-9_~./\\-]'
const PATH_AFTER = '[A-Za-z0-9_~/\\([{-]'

function tokenPattern(path: string): RegExp {
  return new RegExp(`(?<!${PATH_BEFORE})${escapeRegExp(path)}(?!${PATH_AFTER}|\\.[A-Za-z0-9])`, 'g')
}

function replaceTokens(text: string, from: string, to: string): string {
  return text.replace(tokenPattern(from), () => to)
}

/** Stands in for the node twin while probing; cannot occur in a real path. */
const MENTION_PROBE = '\u0000mention\u0000'

/**
 * Does `text` name `path`? Asked of the rewriter rather than answered
 * separately: whatever it would replace is a mention and whatever it would
 * not is not. Rewriting twice — once to itself, once to a probe — cancels out
 * any re-serialisation the JSON walk does, so only a real substitution shows.
 * The two used to be independent, and the reply that nested a Windows path two
 * JSON levels deep was rewritten by one and called unmentioned by the other,
 * which skipped the upload and left the agent a path the node never received.
 */
export function mentionsArtifactPath(text: string, path: string): boolean {
  if (!path) return false
  return rewriteString(text, [[path, MENTION_PROBE] as const]) !== rewriteString(text, [[path, path] as const])
}

/**
 * Could this string be a JSON document? A quoted scalar counts: a tool that
 * embeds a serialised result as a string value nests the escaping, and a
 * text-level replace there writes a Windows twin's backslashes in unescaped
 * and breaks the document.
 */
function looksLikeJson(text: string): boolean {
  const c = text.trimStart()[0]
  return c === '{' || c === '[' || c === '"'
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
      if (typeof value === 'string' || (value && typeof value === 'object')) {
        return JSON.stringify(rewriteValue(value, entries))
      }
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
export interface ZoneArgRef {
  sessionId: string
  relativePath: string
  desktopPath: string
  /** Top-level argument the path came from, or null when it is not under one. */
  key: string | null
}

export function mapNodeZoneArgs(
  zone: NodeSyncZone,
  args: unknown,
  /**
   * The session this Host Action is running for. A path under any *other*
   * session's zone is refused rather than mapped: a tool call for one session
   * must not be handed a file from another (§3.1).
   */
  sessionId?: string,
): { args: unknown; refs: ZoneArgRef[] } {
  const refs: ZoneArgRef[] = []
  const seen = new Set<string>()
  // The top-level argument name travels with the ref: whether a file has to
  // exist already depends on which parameter named it, and only the caller
  // knows which of a tool's parameters are destinations (§3.1).
  const walk = (value: unknown, key: string | null): unknown => {
    if (typeof value === 'string') {
      const parsed = parseNodeZonePath(zone, value)
      if (!parsed) return value
      if (sessionId && parsed.sessionId !== sessionId) {
        throw Object.assign(
          new Error(`${value} belongs to another session's directory`),
          { code: 'forbidden' },
        )
      }
      const desktopPath = desktopMirrorPath(parsed.sessionId, parsed.relativePath)
      if (!seen.has(desktopPath)) {
        seen.add(desktopPath)
        refs.push({ ...parsed, desktopPath, key })
      }
      return desktopPath
    }
    if (Array.isArray(value)) return value.map((inner) => walk(inner, key))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, inner] of Object.entries(value as Record<string, unknown>)) out[k] = walk(inner, key ?? k)
      return out
    }
    return value
  }
  return { args: walk(args, null), refs }
}
