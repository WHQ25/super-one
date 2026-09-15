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
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { lstatSync, realpathSync } from 'node:fs'

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
 * Where a path may begin and end in prose — stated as the delimiters that
 * *can* surround one, not as the characters that cannot be in one. A file
 * name can hold a letter in any script, a backslash, an opening bracket; a
 * list of "path characters" is always one script short. So anything that is
 * not a delimiter continues the path, and a registered path is never found
 * inside a longer one: `/other/tmp/a.png`, `a.png副本`, `a.png\child`,
 * `a.png(1)` name other files. A path that is the whole string needs no
 * delimiter at all.
 */
const OPENS_PATH = '\\s"\'`([{<,;:=|，。；：！？、（「『【《〈“‘'
const CLOSES_PATH = '\\s"\'`)\\]}>,;:!?|，。、；：！？）」』】》〉”’'

/** Does the string start the way an absolute path does? POSIX root, drive letter, UNC. */
function looksLikePath(text: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(text)
}

function tokenPattern(path: string): RegExp {
  // Ends at a closing delimiter, the end of the text, or a full stop that
  // ends the sentence — `shot.png.` counts, `shot.png.bak` does not.
  return new RegExp(
    `(?<![^${OPENS_PATH}])${escapeRegExp(path)}(?![^${CLOSES_PATH}.])(?!\\.(?!\\s|$))`,
    'g',
  )
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
 * Rewrite one text block: parse it as JSON when it is JSON and rewrite the
 * string values at their own level (so a Windows twin is escaped by the
 * serialiser instead of breaking the document); otherwise treat it as prose.
 */
function rewriteString(text: string, entries: ReadonlyArray<readonly [string, string]>): string {
  const asJson = rewriteJson(text, entries)
  return asJson ?? rewriteProse(text, entries)
}

/** The JSON branch of `rewriteString` and `rewriteScalar`; null when `text` is not a JSON document. */
function rewriteJson(text: string, entries: ReadonlyArray<readonly [string, string]>): string | null {
  if (!looksLikeJson(text)) return null
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value === 'string' || (value && typeof value === 'object')) {
      return JSON.stringify(rewriteValue(value, entries))
    }
  } catch {
    /* not JSON after all */
  }
  return null
}

/**
 * A decoded JSON string value. Two kinds, and the contract differs: a value
 * that *is* a path is compared whole and never searched — `/tmp/a.png copy.png`
 * and `/other:/tmp/a.png` are other files, and a space or a colon is a legal
 * file-name character — while a value that is prose is scanned for a
 * delimited token like any other text. (A nested document is a document.)
 */
function rewriteScalar(value: string, entries: ReadonlyArray<readonly [string, string]>): string {
  const asJson = rewriteJson(value, entries)
  if (asJson !== null) return asJson
  if (looksLikePath(value)) {
    for (const [from, to] of entries) if (value === from) return to
    return value
  }
  return rewriteProse(value, entries)
}

/** Replace delimited tokens in prose, raw and — for a path that JSON doubles — escaped. */
function rewriteProse(text: string, entries: ReadonlyArray<readonly [string, string]>): string {
  let out = text
  for (const [from, to] of entries) {
    if (out === from) return to
    out = replaceTokens(out, from, to)
    const fromJson = JSON.stringify(from).slice(1, -1)
    if (fromJson !== from) out = replaceTokens(out, fromJson, JSON.stringify(to).slice(1, -1))
  }
  return out
}

function rewriteValue(value: unknown, entries: ReadonlyArray<readonly [string, string]>): unknown {
  if (typeof value === 'string') return rewriteScalar(value, entries)
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
  /**
   * Every top-level argument the path appeared under. One path can be named
   * twice in one call with different roles — a destination and a source —
   * and it then has to satisfy both.
   */
  keys: string[]
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
  /**
   * Top-level arguments whose contents are another tool's arguments (or become
   * one's after expansion) and are mapped there, by that tool's own roles.
   * Left exactly as written here — not mapped, not checked.
   */
  deferKeys: ReadonlySet<string> = new Set(),
): { args: unknown; refs: ZoneArgRef[] } {
  const refs: ZoneArgRef[] = []
  const byPath = new Map<string, ZoneArgRef>()
  // The top-level argument names travel with the ref: whether a file has to
  // exist already depends on which parameters named it, and only the caller
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
      let ref = byPath.get(desktopPath)
      if (!ref) {
        ref = { ...parsed, desktopPath, keys: [] }
        byPath.set(desktopPath, ref)
        refs.push(ref)
      }
      if (key !== null && !ref.keys.includes(key)) ref.keys.push(key)
      return desktopPath
    }
    if (Array.isArray(value)) return value.map((inner) => walk(inner, key))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, inner] of Object.entries(value as Record<string, unknown>)) {
        out[k] = key === null && deferKeys.has(k) ? inner : walk(inner, key ?? k)
      }
      return out
    }
    return value
  }
  return { args: walk(args, null), refs }
}

/**
 * The canonical path of `path` with every symlink on the way resolved, or —
 * when it does not exist yet — the nearest existing ancestor resolved and the
 * remaining segments kept as written, so a link planted on the way out is
 * still followed. Shared by the download store and the directory mirror: any
 * code about to *create under* or *delete within* a session zone has to reason
 * about the real location, not the spelling.
 */
export function realOrSelf(path: string): string {
  const resolved = resolve(path)
  try {
    return realpathSync(resolved)
  } catch {
    let parent = dirname(resolved)
    while (parent !== dirname(parent)) {
      try {
        return join(realpathSync(parent), relative(parent, resolved))
      } catch {
        parent = dirname(parent)
      }
    }
    return resolved
  }
}

/** This session's zone root, or null when the zone directory is itself a link (never ours to write through). */
/**
 * One spelling for a zone file's path, so every table that keys on it agrees.
 *
 * Only the directory is resolved. The file itself may not exist yet — a
 * reservation is an empty `wx` create that a stream then fills — and
 * `realpath` on a missing path throws. A delivery filed under one spelling
 * and looked up under another silently protects nothing.
 */
export function canonicalClaimPath(path: string): string {
  const abs = resolve(path)
  return resolve(realOrSelf(dirname(abs)), basename(abs))
}

export function canonicalSessionZone(sessionId: string): string | null {
  const dir = sessionZoneDir(sessionId)
  try {
    if (lstatSync(dir).isSymbolicLink()) return null
  } catch {
    /* not there yet; it will be created as a real directory */
  }
  return realOrSelf(dir)
}

/**
 * Is `path` inside *this* session's zone, once every symlink on the way has
 * been resolved? The zone root is not the boundary — another session's
 * directory is inside it, and a link planted in this one leads out of it. The
 * one operation a link can redirect is the dangerous one (create, delete), so
 * this is checked before either, on the path and every ancestor up to the
 * session root.
 */
export function withinSessionZone(sessionId: string, path: string): boolean {
  const root = canonicalSessionZone(sessionId)
  if (root === null) return false
  const target = realOrSelf(path)
  return target === root || target.startsWith(root + sep)
}
