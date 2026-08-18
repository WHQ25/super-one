import type { Context } from '@deepseek-ai/cordis'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'

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

interface Mount {
  dispose: () => void
  serverName: string
}

/**
 * Third-party MCP servers for the embedded dsh tree.
 *
 * Placement follows dsh's own model rather than SuperOne's other harnesses:
 * dsh composes per deployment, its servers live in one profile patch layer
 * (`~/.dsh/profiles/<profile>/cordis.patch.yml`), and `serverName` is a
 * process-wide reservation. So every server mounts once in the tree's global
 * layer and every session sees the same set — which is exactly what that file
 * says. Identity is the whole connection tuple, so re-reading the config after
 * an edit re-mounts only what actually changed.
 */
export class DeepseekMcpServers {
  private readonly mounts = new Map<string, Mount>()

  constructor(
    private readonly ctx: Context,
    /** Plugin used for one server. Injectable so tests can mount without a live server. */
    private readonly plugin: unknown = McpClient,
  ) {}

  /** Mount anything in `specs` that is not up yet, and drop what is gone. */
  sync(specs: readonly DeepseekMcpServerSpec[]): void {
    const wanted = new Map(specs.map((spec) => [identityOf(spec), spec] as const))
    for (const [identity, mount] of [...this.mounts]) {
      if (wanted.has(identity)) continue
      mount.dispose()
      this.mounts.delete(identity)
    }
    for (const [identity, spec] of wanted) {
      if (this.mounts.has(identity)) continue
      const mount = this.mount(spec)
      if (mount) this.mounts.set(identity, mount)
    }
  }

  dispose(): void {
    for (const mount of this.mounts.values()) mount.dispose()
    this.mounts.clear()
  }

  private mount(spec: DeepseekMcpServerSpec): Mount | null {
    const serverName = spec.name.replace(SERVER_NAME_PATTERN, '_').slice(0, MAX_SERVER_NAME_LENGTH)
    if (!serverName) return null
    try {
      // The plugin is chosen at construction, so its config type is only known
      // at runtime; dsh validates it with schemastery at activation.
      const mount = this.ctx.plugin as (plugin: unknown, config: unknown) => { dispose?: () => void }
      const fiber = mount.call(this.ctx, this.plugin, {
        ...configFor(spec),
        serverName,
        // An unreachable server costs its own tools and nothing else.
        failOnStartupError: false,
      })
      return { serverName, dispose: () => void fiber.dispose?.() }
    } catch (error) {
      logger(this.ctx)?.warn(`superone-mcp: server "${spec.name}" failed to mount: ${String(error)}`)
      return null
    }
  }
}

/** Two configs are the same server when every connection field matches. */
function identityOf(spec: DeepseekMcpServerSpec): string {
  return JSON.stringify([
    spec.name,
    spec.transport,
    spec.command ?? '',
    spec.args ?? [],
    spec.env ?? {},
    spec.cwd ?? '',
    spec.url ?? '',
    spec.headers ?? {},
  ])
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

function logger(ctx: Context): { warn(message: string): void } | undefined {
  return (ctx as Context & { logger?: { warn(message: string): void } }).logger
}
