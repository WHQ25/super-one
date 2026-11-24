/**
 * The installed-plugin store: an ordinary npm root the user owns.
 *
 * Layout under `<userData>/dsh-plugins`:
 *
 * ```
 *   package.json     — a plain npm root, so `npm install <pkg>` just works here
 *   node_modules/    — where installed plugins and their own deps land
 *   registry.json    — which of them are enabled, at what version, with what config
 * ```
 *
 * Keeping the store a real npm root (rather than a bespoke per-plugin directory
 * scheme) is what lets any package manager install into it, lets a plugin bring
 * its own non-dsh dependencies, and lets `createRequire` resolve entries with no
 * custom resolution logic. The dsh peers a plugin declares are *not* installed
 * here — the resolver hook redirects them to the app's copies, which is the
 * whole point of `./resolver`.
 *
 * `registry.json` is the enablement record, deliberately separate from
 * `package.json`: a package can be present on disk but disabled, and disabling
 * must not require an uninstall.
 */

import { createRequire } from 'node:module'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, join, posix, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'

/** Current on-disk schema version. */
export const DSH_PLUGIN_REGISTRY_VERSION = 1

/** File name of the enablement record inside the plugin root. */
export const REGISTRY_FILENAME = 'registry.json'

/**
 * One installed plugin, as recorded on disk.
 *
 * The field names follow dsh's own composition-row vocabulary rather than an
 * invented one: a row in a `cordis.patch.yml` is `{ id, name, config, disabled }`,
 * where `id` is the unit later layers override by and `disabled` (absent =
 * enabled) is how a composition turns a row off without removing it. Matching it
 * costs nothing and means a plugin author reading this file is reading a dialect
 * they already know. `version` is ours — dsh rows carry no version because their
 * packages are pinned by the profile's lockfile, and we have no lockfile.
 */
export interface DshPluginRow {
  /** Row identity, the unit of override. Defaults to the package name. */
  id: string
  /** Package name; also the specifier resolved inside the plugin root. */
  name: string
  /** Version recorded at install time, for the lockstep check. */
  version: string
  /** Config object handed to `ctx.plugin(plugin, config)`. */
  config?: Record<string, unknown>
  /** dsh row vocabulary: absent means enabled. */
  disabled?: boolean
}

/** The parsed registry, plus whatever went wrong reading it. */
export interface DshPluginRegistry {
  version: number
  plugins: DshPluginRow[]
  /**
   * Why the on-disk record could not be used, when it could not be.
   *
   * A corrupt registry resolves to an empty roster rather than an exception,
   * because a bad file in the plugin store must not make dsh sessions
   * unstartable — but it is reported rather than swallowed, so the caller can
   * surface it instead of silently running with no plugins.
   */
  problem?: string
}

/** An empty roster, used for both "no file yet" and "file unusable". */
function emptyRegistry(problem?: string): DshPluginRegistry {
  return problem === undefined
    ? { version: DSH_PLUGIN_REGISTRY_VERSION, plugins: [] }
    : { version: DSH_PLUGIN_REGISTRY_VERSION, plugins: [], problem }
}

/** Path of the registry file inside a plugin root. */
export function registryPath(root: string): string {
  return join(root, REGISTRY_FILENAME)
}

/**
 * Keep only entries that carry the fields the loader depends on.
 *
 * A hand-edited registry is expected — this is a user-owned directory — so one
 * malformed row drops itself rather than the whole roster.
 * @param value - the parsed `plugins` member, of unknown shape.
 * @returns the rows that are usable.
 */
function isValidPackageName(name: string): boolean {
  if (!name || name.includes('\\') || name.includes('\0')) return false
  if (name.startsWith('/') || name.endsWith('/')) return false
  const parts = name.split('/')
  if (parts.length > 2) return false
  if (parts.length === 2 && !parts[0]!.startsWith('@')) return false
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
}

function coercePlugins(value: unknown): DshPluginRow[] {
  if (!Array.isArray(value)) return []
  const rows: DshPluginRow[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const { id, name, version, config, disabled } = row as Record<string, unknown>
    if (typeof name !== 'string' || !isValidPackageName(name)) continue
    if (typeof version !== 'string') continue
    rows.push({
      id: typeof id === 'string' && id.length > 0 ? id : name,
      name,
      version,
      ...(config && typeof config === 'object' && !Array.isArray(config)
        ? { config: config as Record<string, unknown> }
        : {}),
      ...(disabled === true ? { disabled: true } : {}),
    })
  }
  return rows
}

/**
 * Read the enablement record. Missing file means "nothing installed yet".
 * @param root - the plugin root directory.
 * @returns the roster, with `problem` set when the file existed but was unusable.
 */
export async function readPluginRegistry(root: string): Promise<DshPluginRegistry> {
  let raw: string
  try {
    raw = await readFile(registryPath(root), 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return emptyRegistry()
    return emptyRegistry(`cannot read ${REGISTRY_FILENAME}: ${String(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return emptyRegistry(`${REGISTRY_FILENAME} is not valid JSON: ${String(error)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return emptyRegistry(`${REGISTRY_FILENAME} is not an object`)
  }
  const { version, plugins } = parsed as Record<string, unknown>
  return {
    version: typeof version === 'number' ? version : DSH_PLUGIN_REGISTRY_VERSION,
    plugins: coercePlugins(plugins),
  }
}

/**
 * Serialize a roster to the exact bytes written to disk.
 * @param registry - the roster to render.
 * @returns pretty-printed JSON with a trailing newline.
 */
export function renderRegistry(registry: DshPluginRegistry): string {
  const { version, plugins } = registry
  return `${JSON.stringify({ version, plugins }, null, 2)}\n`
}

/**
 * Run one read-modify-write cycle against the registry under a writer lock.
 *
 * The lock is what makes concurrent enable/disable and install safe: without it
 * a slow mutation could resurrect a roster another writer just replaced. Readers
 * stay lock-free because the commit is a rename.
 * @param root - the plugin root directory.
 * @param mutate - receives the current roster and returns the next one.
 * @returns the roster that was written.
 */
export async function updatePluginRegistry(
  root: string,
  mutate: (current: DshPluginRegistry) => DshPluginRegistry,
): Promise<DshPluginRegistry> {
  const file = registryPath(root)
  return withFileLock(file, async () => {
    const current = await readPluginRegistry(root)
    const next = mutate(current)
    await writeFileAtomic(file, renderRegistry(next), { mode: 0o600, dirMode: 0o700 })
    return next
  })
}

/**
 * Resolve an installed plugin's entry module to a `file:` URL.
 *
 * The URL form matters: the Loader's `import()` falls back to a bare specifier
 * resolved from inside the app, which can never reach the plugin root. A URL
 * bypasses resolution entirely and is the only form that loads from here.
 * @param root - the plugin root directory.
 * @param name - the installed package name.
 * @returns the entry URL, or `null` when the package is not present.
 */
export function resolvePluginEntryUrl(root: string, name: string): string | null {
  const rootRequire = createRequire(join(root, 'package.json'))
  try {
    return pathToFileURL(rootRequire.resolve(name)).href
  } catch {
    return null
  }
}

/**
 * The rows the tree should mount, in registry order.
 * @param registry - the roster.
 * @returns the rows that are not disabled.
 */
export function enabledPlugins(registry: DshPluginRegistry): DshPluginRow[] {
  return registry.plugins.filter((row) => row.disabled !== true)
}

export const CLIENT_PLUGIN_API_VERSION = 1

export interface ClientPluginEntry {
  id: string
  name: string
  version: string
  apiVersion: 1
  entry: string
  styles: string[]
  rev: string
  entryUrl: string
  styleUrls: string[]
}

export interface ClientPluginProblem {
  id: string
  name: string
  reason: string
}

export interface ClientPluginEntriesResult {
  entries: ClientPluginEntry[]
  problems: ClientPluginProblem[]
  registryProblem?: string
}

const CLIENT_ENTRY_EXTS = new Set(['.js', '.mjs'])
const CLIENT_STYLE_EXTS = new Set(['.css'])

export function normalizePluginRelativePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/\\/g, '/')
  if (!trimmed || trimmed.startsWith('/') || trimmed.includes('\0')) return null
  const clean = trimmed.replace(/^\.\//, '')
  const normalized = posix.normalize(clean)
  if (!normalized || normalized === '.' || normalized.startsWith('..') || normalized.startsWith('/')) {
    return null
  }
  return normalized
}

export function packageDirForName(root: string, name: string): string {
  if (!isValidPackageName(name)) {
    return join(root, 'node_modules', '__invalid_package_name__')
  }
  const parts = name.split('/')
  return join(root, 'node_modules', ...parts)
}

export async function resolveContainedFile(
  pkgDir: string,
  relPath: string,
  allowedExts: ReadonlySet<string>,
): Promise<{ absPath: string; mtimeMs: number; normalized: string } | null> {
  const normalized = normalizePluginRelativePath(relPath)
  if (!normalized) return null
  const ext = extname(normalized).toLowerCase()
  if (!allowedExts.has(ext)) return null
  let pkgRoot: string
  let targetReal: string
  try {
    pkgRoot = await realpath(pkgDir)
    targetReal = await realpath(join(pkgRoot, ...normalized.split('/')))
  } catch {
    return null
  }
  if (!targetReal.startsWith(pkgRoot + sep)) return null
  try {
    const info = await stat(targetReal)
    if (!info.isFile()) return null
    return { absPath: targetReal, mtimeMs: info.mtimeMs, normalized }
  } catch {
    return null
  }
}

export function buildPluginAssetUrl(pluginId: string, relPath: string, rev: string): string {
  const encodedId = encodeURIComponent(pluginId)
  const encodedPath = relPath.split('/').map(encodeURIComponent).join('/')
  return `superone-plugin://pkg/${encodedId}/${encodedPath}?v=${encodeURIComponent(rev)}`
}

export async function readClientPluginEntries(pluginRoot: string): Promise<ClientPluginEntriesResult> {
  const registry = await readPluginRegistry(pluginRoot)
  const entries: ClientPluginEntry[] = []
  const problems: ClientPluginProblem[] = []

  for (const row of enabledPlugins(registry)) {
    const pkgDir = packageDirForName(pluginRoot, row.name)
    let rawPkg: string
    try {
      rawPkg = await readFile(join(pkgDir, 'package.json'), 'utf8')
    } catch {
      problems.push({ id: row.id, name: row.name, reason: `missing package.json for ${row.name}` })
      continue
    }

    let parsedPkg: unknown
    try {
      parsedPkg = JSON.parse(rawPkg)
    } catch {
      problems.push({ id: row.id, name: row.name, reason: `invalid package.json for ${row.name}` })
      continue
    }

    if (!parsedPkg || typeof parsedPkg !== 'object' || Array.isArray(parsedPkg)) {
      problems.push({ id: row.id, name: row.name, reason: `package.json for ${row.name} is not an object` })
      continue
    }

    const superoneField = (parsedPkg as Record<string, unknown>).superone
    if (superoneField === undefined) continue
    if (!superoneField || typeof superoneField !== 'object' || Array.isArray(superoneField)) {
      problems.push({ id: row.id, name: row.name, reason: `invalid superone manifest field in ${row.name}` })
      continue
    }

    const clientField = (superoneField as Record<string, unknown>).client
    if (clientField === undefined) continue
    if (!clientField || typeof clientField !== 'object' || Array.isArray(clientField)) {
      problems.push({ id: row.id, name: row.name, reason: `invalid superone.client manifest field in ${row.name}` })
      continue
    }

    const { entry, styles, apiVersion } = clientField as Record<string, unknown>
    if (apiVersion !== CLIENT_PLUGIN_API_VERSION) {
      problems.push({
        id: row.id,
        name: row.name,
        reason: `unsupported superone.client.apiVersion in ${row.name}: expected ${CLIENT_PLUGIN_API_VERSION}, got ${String(apiVersion)}`,
      })
      continue
    }

    const resolvedEntry = await resolveContainedFile(pkgDir, String(entry ?? ''), CLIENT_ENTRY_EXTS)
    if (!resolvedEntry) {
      problems.push({
        id: row.id,
        name: row.name,
        reason: `invalid or missing superone.client.entry in ${row.name}`,
      })
      continue
    }

    const rawStyles = styles === undefined ? [] : Array.isArray(styles) ? styles : [styles]
    const resolvedStyles: string[] = []
    const styleUrls: string[] = []
    let styleFailed = false
    for (const rawStyle of rawStyles) {
      if (typeof rawStyle !== 'string') {
        problems.push({ id: row.id, name: row.name, reason: `invalid superone.client.styles entry in ${row.name}` })
        styleFailed = true
        break
      }
      const resolvedStyle = await resolveContainedFile(pkgDir, rawStyle, CLIENT_STYLE_EXTS)
      if (!resolvedStyle) {
        problems.push({
          id: row.id,
          name: row.name,
          reason: `missing or disallowed stylesheet ${rawStyle} in ${row.name}`,
        })
        styleFailed = true
        break
      }
      resolvedStyles.push(resolvedStyle.normalized)
      const styleRev = `${row.version}-${Math.trunc(resolvedStyle.mtimeMs)}`
      styleUrls.push(buildPluginAssetUrl(row.id, resolvedStyle.normalized, styleRev))
    }
    if (styleFailed) continue

    const rev = `${row.version}-${Math.trunc(resolvedEntry.mtimeMs)}`
    entries.push({
      id: row.id,
      name: row.name,
      version: row.version,
      apiVersion: CLIENT_PLUGIN_API_VERSION,
      entry: resolvedEntry.normalized,
      styles: resolvedStyles,
      rev,
      entryUrl: buildPluginAssetUrl(row.id, resolvedEntry.normalized, rev),
      styleUrls,
    })
  }

  return registry.problem === undefined
    ? { entries, problems }
    : { entries, problems, registryProblem: registry.problem }
}
