/**
 * The peer-resolution seam: how a plugin installed *outside* the app tree
 * mounts on the app's own dsh runtime.
 *
 * A third-party dsh plugin lives under a writable root (`<userData>/dsh-plugins`),
 * which Node resolves independently of the app's `node_modules`. Left alone, its
 * `import { Context } from '@deepseek-ai/cordis'` finds either nothing or a
 * *second* copy — and a second copy means a second `Context` class, so every
 * `ctx.plugin()`, service injection and `instanceof` silently fails. That is the
 * dual-package hazard, and it is the whole reason this module exists.
 *
 * The fix is a resolve hook that redirects dsh-family specifiers back to the
 * copies the app already loaded. Verified in Electron 43 / Node 24.18: the
 * redirected module is the *same module record* the app's own static imports
 * hold (`external.Context === app.Context`), and a plugin imported this way
 * mounts on a real app-side `Context`.
 *
 * Scope is narrow on both axes, because `registerHooks` is process-global and
 * fires on every ESM resolve in the main process:
 *
 * - **By specifier** — only `@deepseek-ai/*`. The whole family is scoped
 *   (`cordis`, `cosmokit`, `schemastery` included), so this is one prefix rather
 *   than a list of bare names that could collide with unrelated packages.
 * - **By importer** — only modules under a registered plugin root. The app's own
 *   imports never enter the redirect path: they already resolve to the copies we
 *   would redirect *to*, so intercepting them buys nothing and costs a hook frame
 *   on every resolve in the process. Measured: redirecting indiscriminately took
 *   4370 hook hits to load one plugin; scoping by importer makes it one per
 *   external import site.
 *
 * What this module deliberately does NOT do is check versions. A plugin built
 * against a different dsh major still gets the app's copy, and dsh's family
 * versions move in lockstep — so the compatibility gate belongs at install time,
 * where it can refuse the plugin and say why, not here, where the only options
 * are a silent mismatch or a crash mid-turn.
 */

import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve as resolvePath, sep } from 'node:path'
import { realpathSync } from 'node:fs'

/** Specifiers this hook may redirect. The whole dsh family is scoped. */
export const DSH_FAMILY_PREFIX = '@deepseek-ai/'

/** Resolve dsh-family specifiers exactly as this package itself would. */
const appRequire = createRequire(import.meta.url)

/**
 * Plugin roots whose modules get their dsh peers redirected. Registering a root
 * is what opts its contents into the app's module graph.
 */
const pluginRoots = new Set<string>()

/** Memoized specifier -> app-side file URL. `null` records a known miss. */
const resolvedFamily = new Map<string, string | null>()

/** Installed once per process; `registerHooks` has no uninstall. */
let hookInstalled = false

/**
 * Normalize to an absolute, symlink-resolved path with a trailing separator.
 *
 * The realpath step is load-bearing, not hygiene: `require.resolve` hands back
 * realpaths, so a root registered through a symlink would never prefix-match the
 * importers under it and the redirect would silently never fire. macOS makes
 * this the default case for anything under a temp dir (`/var` -> `/private/var`).
 * A root that does not exist yet keeps its lexical form — it can hold no
 * importers, so it cannot mis-match either.
 * @param dir - the directory to normalize.
 * @returns the prefix used for importer tests.
 */
function asDirPrefix(dir: string): string {
  const absolute = resolvePath(dir)
  let canonical: string
  try {
    canonical = realpathSync(absolute)
  } catch {
    canonical = absolute
  }
  return canonical.endsWith(sep) ? canonical : canonical + sep
}

/**
 * Whether an importer sits under a registered plugin root.
 *
 * A parent-less resolve (an entry point, or a specifier the runtime resolves on
 * nobody's behalf) counts as in-app: nothing outside a plugin root should be
 * rewritten, and defaulting the unknown case to "leave it alone" keeps the
 * failure mode a plain module-not-found rather than a redirect nobody asked for.
 * @param parentURL - the importing module's URL, when the runtime knows one.
 * @returns whether its dsh imports should be redirected.
 */
export function importerIsExternal(parentURL: string | undefined): boolean {
  if (!parentURL || !parentURL.startsWith('file:')) return false
  if (pluginRoots.size === 0) return false
  let parentPath: string
  try {
    parentPath = fileURLToPath(parentURL)
  } catch {
    return false
  }
  for (const root of pluginRoots) {
    if (parentPath.startsWith(root)) return true
  }
  return false
}

/**
 * Resolve one dsh-family specifier against the app's own tree.
 * @param specifier - the bare specifier the external module imported.
 * @returns the app-side `file:` URL, or `null` when the app does not carry it.
 */
function appSideUrl(specifier: string): string | null {
  const cached = resolvedFamily.get(specifier)
  if (cached !== undefined) return cached
  let url: string | null
  try {
    url = pathToFileURL(appRequire.resolve(specifier)).href
  } catch {
    // The app does not bundle this row. Falling through lets the plugin's own
    // copy answer, which is correct for a package that is genuinely the
    // plugin's own dependency rather than a shared dsh peer.
    url = null
  }
  resolvedFamily.set(specifier, url)
  return url
}

/**
 * The whole redirect decision, separated from the hook so it can be tested
 * without installing anything process-global.
 * @param specifier - the specifier being resolved.
 * @param parentURL - the importing module's URL.
 * @returns the app-side URL to redirect to, or `null` to leave resolution alone.
 */
export function redirectTarget(specifier: string, parentURL: string | undefined): string | null {
  if (!specifier.startsWith(DSH_FAMILY_PREFIX)) return null
  if (!importerIsExternal(parentURL)) return null
  return appSideUrl(specifier)
}

/**
 * Register a directory whose plugins should share the app's dsh runtime.
 *
 * Idempotent, and safe to call before or after the hook is installed — the hook
 * reads the root set on every resolve rather than capturing it.
 * @param root - absolute path to a writable plugin root.
 */
export function registerDshPluginRoot(root: string): void {
  pluginRoots.add(asDirPrefix(root))
  installDshPeerResolver()
}

/**
 * Install the process-global resolve hook. Idempotent.
 *
 * Call before importing anything from a plugin root. Modules already resolved
 * keep the URL they were resolved with — the hook rewrites resolution, it cannot
 * retroactively re-point a live module record.
 */
export function installDshPeerResolver(): void {
  if (hookInstalled) return
  hookInstalled = true
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = redirectTarget(specifier, context.parentURL)
      if (url === null) return nextResolve(specifier, context)
      return { url, shortCircuit: true }
    },
  })
}

/** Test seam: the roots currently redirected, as directory prefixes. */
export function dshPluginRoots(): string[] {
  return [...pluginRoots]
}

/** Test seam: drop all registered roots. The installed hook itself stays. */
export function resetDshPluginRoots(): void {
  pluginRoots.clear()
}
