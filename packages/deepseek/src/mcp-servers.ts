import type { Context } from '@deepseek-ai/cordis'

/** The official dsh MCP client. One entry per configured server. */
export const DSH_MCP_CLIENT_SPECIFIER = '@deepseek-ai/dsh-mcp-client'

export interface DeepseekMcpServerSpec {
  /** Model-facing namespace: tools arrive as `mcp__<name>__<tool>`. */
  name: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

/** dsh's function-name contract for the namespace segment. */
const SERVER_NAME_PATTERN = /[^A-Za-z0-9_-]/g
const MAX_SERVER_NAME_LENGTH = 32

/** The slice of `ctx.loader` this registrar drives. */
interface LoaderEntries {
  create(options: { id?: string; name: string; config?: unknown }): Promise<string>
  update(id: string, options: { config?: unknown }): Promise<void>
  remove(id: string): Promise<void>
  await(): Promise<void>
}

interface Mount {
  entryId: string
  /** Serialized config; a change is what turns a create into an update. */
  fingerprint: string
}

/**
 * Third-party MCP servers for the embedded dsh tree.
 *
 * Placement follows dsh's own model rather than SuperOne's other harnesses:
 * dsh composes per deployment, its servers live in one profile patch layer
 * (`~/.dsh/profiles/<profile>/cordis.patch.yml`), and `serverName` is a
 * process-wide reservation. So every server mounts once in the tree's global
 * layer and every session sees the same set — which is exactly what that file
 * says.
 *
 * The mounting itself goes through `ctx.loader`, the same runtime entry tree
 * dsh's own Loader drives. That buys the one thing a hand-rolled diff cannot:
 * a config-only change is `loader.update(id, …)`, an in-place restart of that
 * row, instead of dispose-then-remount — which would briefly release the
 * process-wide `serverName` reservation and could lose the race to re-take it.
 * Entry ids match dsh's own patch-file convention (`mcp-<serverName>`), so a
 * running tree reads the same as the file the user edits.
 */
export class DeepseekMcpServers {
  /** Keyed by sanitized server name — the identity dsh itself reserves. */
  private readonly mounts = new Map<string, Mount>()

  constructor(
    private readonly ctx: Context,
    /**
     * Module specifier for one server's plugin. Tests pass a `cordis:<key>`
     * builtin so they can exercise the real loader without a live server.
     */
    private readonly specifier: string = DSH_MCP_CLIENT_SPECIFIER,
  ) {}

  /** Mount anything in `specs` that is not up yet, restart what changed, drop what is gone. */
  async sync(specs: readonly DeepseekMcpServerSpec[]): Promise<void> {
    const loader = this.loader()
    if (!loader) {
      if (specs.length) this.warn('no `loader` service in the tree; MCP servers not mounted')
      return
    }

    const wanted = new Map<string, Record<string, unknown>>()
    for (const spec of specs) {
      const serverName = spec.name.replace(SERVER_NAME_PATTERN, '_').slice(0, MAX_SERVER_NAME_LENGTH)
      if (!serverName) continue
      wanted.set(serverName, {
        ...configFor(spec),
        serverName,
        // An unreachable server costs its own tools and nothing else.
        failOnStartupError: false,
      })
    }

    for (const [serverName, mount] of [...this.mounts]) {
      if (wanted.has(serverName)) continue
      this.mounts.delete(serverName)
      await this.guard(serverName, () => loader.remove(mount.entryId))
    }

    for (const [serverName, config] of wanted) {
      const fingerprint = JSON.stringify(config)
      const mount = this.mounts.get(serverName)
      if (mount?.fingerprint === fingerprint) continue
      if (mount) {
        const ok = await this.guard(serverName, () => loader.update(mount.entryId, { config }))
        if (ok) mount.fingerprint = fingerprint
        continue
      }
      await this.guard(serverName, async () => {
        // `create()`'s type omits `id` because callers usually do not care;
        // `EntryTree.ensureId` only mints one when the options carry none, so a
        // stable id survives. The returned id stays authoritative either way.
        const entryId = await loader.create({ id: `mcp-${serverName}`, name: this.specifier, config })
        this.mounts.set(serverName, { entryId, fingerprint })
      })
    }

    // Entries import and start asynchronously; settle them so a caller that
    // creates an agent next sees the full tool surface.
    await this.guard('*', () => loader.await())
  }

  async dispose(): Promise<void> {
    const loader = this.loader()
    for (const [serverName, mount] of [...this.mounts]) {
      this.mounts.delete(serverName)
      if (loader) await this.guard(serverName, () => loader.remove(mount.entryId))
    }
  }

  private loader(): LoaderEntries | undefined {
    // `ctx.loader` throws for a consumer that did not declare `inject: ['loader']`;
    // this registrar is constructed against the bare root, so it asks the store.
    return (this.ctx as Context & { get(name: string): unknown }).get('loader') as
      | LoaderEntries
      | undefined
  }

  /** One bad server must not stop the rest of the sync. */
  private async guard(serverName: string, run: () => Promise<unknown>): Promise<boolean> {
    try {
      await run()
      return true
    } catch (error) {
      this.warn(`server "${serverName}" failed: ${String(error)}`)
      return false
    }
  }

  private warn(message: string): void {
    const logger = (this.ctx as Context & { logger?: { warn(message: string): void } }).logger
    logger?.warn(`superone-mcp: ${message}`)
  }
}

function configFor(spec: DeepseekMcpServerSpec): Record<string, unknown> {
  if (spec.transport === 'stdio') {
    return {
      transport: 'stdio',
      command: spec.command ?? '',
      args: spec.args ?? [],
      env: spec.env ?? {},
      ...(spec.cwd ? { cwd: spec.cwd } : {}),
    }
  }
  return {
    transport: 'streamable-http',
    url: spec.url ?? '',
    headers: spec.headers ?? {},
  }
}
