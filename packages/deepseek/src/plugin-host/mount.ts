/**
 * Mounting installed third-party plugins onto a running tree.
 *
 * Mounting goes through `ctx.loader` — the same runtime entry tree dsh's own
 * Loader drives and the same seam `DeepseekMcpServers` uses — rather than a bare
 * `ctx.plugin()`. That is what makes a row addable, updatable and removable
 * while the tree runs: installing a plugin reaches the live process instead of
 * waiting for a restart, and disabling one takes its effects back out.
 *
 * Two things are easy to get wrong and are handled here:
 *
 * 1. **The plugin root is registered before the first import.** `registerHooks`
 *    rewrites *resolution*; it cannot re-point a module record that already
 *    resolved. Registering after an import would leave the plugin holding its
 *    own `Context` class, and every service injection would silently miss.
 * 2. **Entries load by `file:` URL, never by bare specifier.** The Loader's
 *    `import()` falls back to a bare `await import(name)` resolved from inside
 *    the app, which can never reach the plugin root.
 *
 * A plugin that fails is reported, never thrown: one bad third-party package
 * must not take the whole dsh runtime down with it.
 */

import type { Context } from '@deepseek-ai/cordis'
// Side-effect type import: merges `loader` onto `Context` so the store read in
// `loader()` is typed by upstream instead of by a local structural shape.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { LoaderEntries } from '../cordis-loader'
import { enabledPlugins, readPluginRegistry, resolvePluginEntryUrl, type DshPluginRow } from './registry'
import { registerDshPluginRoot } from './resolver'

/** Why a row did not reach the tree, or that it did. */
export type MountStatus = 'mounted' | 'unresolved' | 'failed'

/** The fate of one registry row. */
export interface PluginMountOutcome {
  row: DshPluginRow
  status: MountStatus
  /** Present for `unresolved` and `failed`. */
  reason?: string
}

/** Everything one sync pass produced. */
export interface MountReport {
  outcomes: PluginMountOutcome[]
  /** Carried through from the registry read, so a bad file is not swallowed. */
  registryProblem?: string
}

/** One live mount, and the config fingerprint that decides whether it must restart. */
interface Mount {
  entryId: string
  fingerprint: string
}

/** Loader entry id for a row — stable, and readable in a tree dump. */
function entryIdFor(row: DshPluginRow): string {
  return `plugin-${row.id}`
}

/**
 * The installed-plugin registrar: reconciles the tree against `registry.json`.
 *
 * One instance per runtime, mirroring `DeepseekMcpServers`. `sync()` is the only
 * mutation path, so installing, enabling, disabling, reconfiguring and removing
 * all reduce to "write the registry, then sync" — there is no second code path
 * that could drift from it.
 */
export class DeepseekPlugins {
  /** Keyed by row id. */
  private readonly mounts = new Map<string, Mount>()

  constructor(
    private readonly ctx: Context,
    /** The writable plugin root, or undefined to run with none. */
    private readonly root: string | undefined,
  ) {}

  /**
   * Reconcile the tree against the registry: mount what is newly enabled,
   * restart what changed config, remove what is gone or disabled.
   * @returns what each enabled row's mount produced.
   */
  async sync(): Promise<MountReport> {
    if (this.root === undefined) return { outcomes: [] }
    // Before any import from the root — see the module note.
    registerDshPluginRoot(this.root)

    const loader = this.loader()
    if (!loader) {
      return { outcomes: [], registryProblem: 'no `loader` service in the tree; plugins not mounted' }
    }

    const registry = await readPluginRegistry(this.root)
    const wanted = enabledPlugins(registry)
    const wantedIds = new Set(wanted.map((row) => row.id))

    for (const [id, mount] of [...this.mounts]) {
      if (wantedIds.has(id)) continue
      this.mounts.delete(id)
      try {
        await loader.remove(mount.entryId)
      } catch {
        // A row that will not unmount is worse left half-tracked than forgotten;
        // the next sync re-derives from the registry either way.
      }
    }

    const outcomes: PluginMountOutcome[] = []
    for (const row of wanted) {
      const url = this.root === undefined ? null : resolvePluginEntryUrl(this.root, row.name)
      if (url === null) {
        outcomes.push({ row, status: 'unresolved', reason: `${row.name} is not present in the plugin root` })
        continue
      }
      const fingerprint = JSON.stringify({ url, config: row.config ?? null })
      const mount = this.mounts.get(row.id)
      if (mount?.fingerprint === fingerprint) {
        outcomes.push({ row, status: 'mounted' })
        continue
      }
      try {
        if (mount) {
          // Config-only change: an in-place restart of that row, the same reason
          // `DeepseekMcpServers` prefers update over dispose-then-remount.
          await loader.update(mount.entryId, { config: row.config })
          mount.fingerprint = fingerprint
        } else {
          const entryId = await loader.create({ id: entryIdFor(row), name: url, config: row.config })
          this.mounts.set(row.id, { entryId, fingerprint })
        }
        outcomes.push({ row, status: 'mounted' })
      } catch (error) {
        this.mounts.delete(row.id)
        outcomes.push({ row, status: 'failed', reason: String(error) })
      }
    }

    // Entries import and start asynchronously; settle them so a caller that
    // creates an agent next sees the full tool surface.
    try {
      await loader.await()
    } catch {
      // Individual failures are already reported per row above.
    }

    return registry.problem === undefined
      ? { outcomes }
      : { outcomes, registryProblem: registry.problem }
  }

  /** Take every mounted plugin back out. */
  async dispose(): Promise<void> {
    const loader = this.loader()
    for (const [id, mount] of [...this.mounts]) {
      this.mounts.delete(id)
      if (!loader) continue
      try {
        await loader.remove(mount.entryId)
      } catch {
        // Disposal is best-effort; the tree is going away regardless.
      }
    }
  }

  /**
   * `ctx.loader` throws for a consumer that did not declare `inject: ['loader']`;
   * this registrar is constructed against a bare context, so it asks the store.
   */
  private loader(): LoaderEntries | undefined {
    return this.ctx.get('loader')
  }
}
