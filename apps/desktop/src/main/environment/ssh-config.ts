/**
 * Read local OpenSSH client config (~/.ssh/config) for the Add Environment UI.
 *
 * Not a full OpenSSH parser — enough Host / HostName / User / Port / IdentityFile
 * / Include to list concrete Host aliases the user can pick. Wildcards (`*`, `?`)
 * are skipped because they are not usable destinations.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

export interface SshConfigHost {
  /** Host alias for `ssh <alias>` (OpenSSH resolves the rest). */
  alias: string
  hostName?: string
  user?: string
  port?: number
  identityFile?: string
  /** Short label for the UI, e.g. `user@hostname:2222`. */
  display: string
}

export interface ListSshConfigHostsOptions {
  /** Override config path (tests). Default: ~/.ssh/config */
  configPath?: string
  /** Max Include depth. */
  maxIncludeDepth?: number
}

const DEFAULT_MAX_INCLUDE = 5

/** True when the Host token is not a concrete alias (glob / negate). */
export function isWildcardHostToken(token: string): boolean {
  return token.startsWith('!') || token.includes('*') || token.includes('?')
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2))
  }
  return path
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

/** Build a human-readable secondary line for the host list. */
export function formatSshHostDisplay(host: Omit<SshConfigHost, 'display'>): string {
  const target = host.hostName ?? host.alias
  const userHost = host.user ? `${host.user}@${target}` : target
  if (host.port && host.port !== 22) return `${userHost}:${host.port}`
  return userHost
}

interface HostBlock {
  aliases: string[]
  hostName?: string
  user?: string
  port?: number
  identityFile?: string
}

/**
 * Parse OpenSSH config text into concrete host entries.
 * Later blocks with the same alias overwrite earlier ones (OpenSSH first-match
 * is more nuanced; for a picker, last-write is acceptable and simpler).
 */
export function parseSshConfig(content: string): SshConfigHost[] {
  const blocks: HostBlock[] = []
  let current: HostBlock | null = null
  // Track Match blocks so we ignore keywords inside them.
  let inMatch = false

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue

    const space = line.search(/\s+/)
    const keyword = (space === -1 ? line : line.slice(0, space)).toLowerCase()
    const value = space === -1 ? '' : line.slice(space).trim()

    if (keyword === 'match') {
      inMatch = true
      current = null
      continue
    }

    if (keyword === 'host') {
      inMatch = false
      const aliases = value.split(/\s+/).filter(Boolean).map(stripQuotes)
      current = { aliases }
      blocks.push(current)
      continue
    }

    if (inMatch || !current) continue

    const v = stripQuotes(value)
    if (keyword === 'hostname') current.hostName = v
    else if (keyword === 'user') current.user = v
    else if (keyword === 'port') {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) current.port = n
    } else if (keyword === 'identityfile') current.identityFile = expandHome(v)
  }

  const byAlias = new Map<string, SshConfigHost>()
  for (const block of blocks) {
    for (const alias of block.aliases) {
      if (isWildcardHostToken(alias)) continue
      const entry: SshConfigHost = {
        alias,
        hostName: block.hostName,
        user: block.user,
        port: block.port,
        identityFile: block.identityFile,
        display: '',
      }
      entry.display = formatSshHostDisplay(entry)
      byAlias.set(alias, entry)
    }
  }

  return [...byAlias.values()].sort((a, b) => a.alias.localeCompare(b.alias))
}

/** Collect Include paths from a config file body (relative to the file's dir). */
export function collectIncludePaths(content: string, configDir: string): string[] {
  const paths: string[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const space = line.search(/\s+/)
    const keyword = (space === -1 ? line : line.slice(0, space)).toLowerCase()
    if (keyword !== 'include') continue
    const value = space === -1 ? '' : stripQuotes(line.slice(space).trim())
    if (!value) continue
    for (const token of value.split(/\s+/)) {
      paths.push(isAbsolute(token) || token.startsWith('~') ? expandHome(token) : resolve(configDir, token))
    }
  }
  return paths
}

/** Expand a path that may contain a single * glob in the basename. */
async function expandGlobPath(path: string): Promise<string[]> {
  if (!path.includes('*')) return [path]
  const dir = dirname(path)
  const pattern = basename(path)
  // Only support simple * in the filename (e.g. config.d/*).
  if (pattern !== '*' && !/^[^*]*\*[^*]*$/.test(pattern)) return [path]
  try {
    const names = await readdir(dir)
    const re = new RegExp(
      `^${pattern
        .split('*')
        .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`,
    )
    return names.filter((n) => re.test(n)).map((n) => join(dir, n))
  } catch {
    return []
  }
}

async function readConfigTree(
  path: string,
  depth: number,
  maxDepth: number,
  seen: Set<string>,
): Promise<string[]> {
  const abs = resolve(expandHome(path))
  if (seen.has(abs) || depth > maxDepth) return []
  seen.add(abs)

  let content: string
  try {
    const st = await stat(abs)
    if (!st.isFile()) return []
    content = await readFile(abs, 'utf8')
  } catch {
    return []
  }

  const chunks = [content]
  const includes = collectIncludePaths(content, dirname(abs))
  for (const inc of includes) {
    const expanded = await expandGlobPath(inc)
    for (const p of expanded) {
      chunks.push(...(await readConfigTree(p, depth + 1, maxDepth, seen)))
    }
  }
  return chunks
}

/**
 * Load ~/.ssh/config (and Includes) and return selectable Host aliases.
 * Missing config → empty list (caller falls back to manual entry).
 */
export async function listSshConfigHosts(
  options: ListSshConfigHostsOptions = {},
): Promise<SshConfigHost[]> {
  const configPath = options.configPath ?? join(homedir(), '.ssh', 'config')
  const maxDepth = options.maxIncludeDepth ?? DEFAULT_MAX_INCLUDE
  const chunks = await readConfigTree(configPath, 0, maxDepth, new Set())
  if (chunks.length === 0) return []

  // Merge: later files win for the same alias (Includes are usually more specific).
  const byAlias = new Map<string, SshConfigHost>()
  for (const chunk of chunks) {
    for (const host of parseSshConfig(chunk)) {
      byAlias.set(host.alias, host)
    }
  }
  return [...byAlias.values()].sort((a, b) => a.alias.localeCompare(b.alias))
}
