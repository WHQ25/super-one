import type { Context } from '@deepseek-ai/cordis'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'

export interface DeepseekMcpServerSpec {
  /** SuperOne's server name; also the model-facing namespace when available. */
  name: string
  /**
   * Where the config came from. `user` servers belong to every session, so they
   * mount once in the tree's global layer; `project` servers mount in a scope
   * only that project's agents are chained to.
   */
  scope: 'user' | 'project'
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

export interface DeepseekMcpAcquisition {
  /** Scope to chain the agent to, or undefined when this project adds nothing. */
  scopeKey?: ScopeKey
  release: () => void
}

/** dsh's function-name contract for the namespace segment. */
const SERVER_NAME_PATTERN = /[^A-Za-z0-9_-]/g
const MAX_SERVER_NAME_LENGTH = 32

interface Mount {
  dispose: () => void
  serverName: string
}

interface ProjectScope {
  key: ScopeKey
  ctx: Context
  disposeScope: () => void
  mounts: Mount[]
  refs: number
}

/**
 * Third-party MCP servers, mapped onto dsh's scope chain.
 *
 * dsh treats MCP servers as deployment-level composition entries: one instance
 * per `serverName`, reserved process-globally, shared by every agent in the
 * Host. SuperOne's servers are configured per user *and* per project, so the
 * two models meet at dsh's own scoping mechanism — the one `agent-presets`
 * uses. User-scope servers mount in the global layer; project-scope servers
 * mount in a standing scope per cwd, and each session's agent binds that scope
 * as its parent so registrations inherit down the chain to it alone.
 *
 * Only a genuine clash — one name, two different configs — costs a server its
 * plain name, because the reservation is still process-wide.
 */
export class DeepseekMcpServers {
  private readonly globalMounts = new Map<string, Mount>()
  private readonly projects = new Map<string, ProjectScope>()
  /** serverName → identity that holds it, across both layers. */
  private readonly takenNames = new Map<string, string>()

  constructor(
    private readonly ctx: Context,
    /** Plugin used for one server. Injectable so tests can mount without a real server. */
    private readonly plugin: unknown = McpClient,
  ) {}

  /**
   * Mount everything one session needs and hand back the scope to chain its
   * agent to. `release` drops this session's claim; the project's servers stay
   * up while another session in the same cwd still holds one.
   */
  acquire(cwd: string, specs: readonly DeepseekMcpServerSpec[]): DeepseekMcpAcquisition {
    for (const spec of specs.filter((s) => s.scope === 'user')) {
      const identity = identityOf(spec)
      if (this.globalMounts.has(identity)) continue
      const mount = this.mount(this.ctx, spec, identity)
      if (mount) this.globalMounts.set(identity, mount)
    }

    const projectSpecs = specs.filter((s) => s.scope === 'project')
    if (projectSpecs.length === 0) return { release: () => {} }

    let project = this.projects.get(cwd)
    if (!project) {
      const key: ScopeKey = {}
      const scope = createScope(this.ctx, key)
      project = { key, ctx: scope.ctx, disposeScope: () => void scope.dispose(), mounts: [], refs: 0 }
      for (const spec of projectSpecs) {
        const mount = this.mount(project.ctx, spec, identityOf(spec))
        if (mount) project.mounts.push(mount)
      }
      this.projects.set(cwd, project)
    }
    project.refs += 1

    let released = false
    return {
      scopeKey: project.key,
      release: () => {
        if (released) return
        released = true
        const live = this.projects.get(cwd)
        if (!live) return
        live.refs -= 1
        if (live.refs > 0) return
        this.projects.delete(cwd)
        for (const mount of live.mounts) {
          this.takenNames.delete(mount.serverName)
          mount.dispose()
        }
        live.disposeScope()
      },
    }
  }

  dispose(): void {
    for (const mount of this.globalMounts.values()) mount.dispose()
    this.globalMounts.clear()
    for (const project of this.projects.values()) {
      for (const mount of project.mounts) mount.dispose()
      project.disposeScope()
    }
    this.projects.clear()
    this.takenNames.clear()
  }

  private mount(ctx: Context, spec: DeepseekMcpServerSpec, identity: string): Mount | null {
    const serverName = this.allocateName(spec.name, identity)
    if (!serverName) return null
    try {
      // The plugin is chosen at construction, so its config type is only known
      // at runtime; dsh validates it with schemastery at activation.
      const mount = ctx.plugin as (plugin: unknown, config: unknown) => { dispose?: () => void }
      const fiber = mount.call(ctx, this.plugin, {
        ...configFor(spec),
        serverName,
        // Never fail the mount: an unreachable server costs its own tools, and
        // inside `setup` a rejection would roll the whole session back.
        failOnStartupError: false,
      })
      return { serverName, dispose: () => void fiber.dispose?.() }
    } catch (error) {
      this.takenNames.delete(serverName)
      logger(ctx)?.warn(`superone-mcp: server "${spec.name}" failed to mount: ${String(error)}`)
      return null
    }
  }

  /**
   * The plain name when it is free or already ours, a numbered variant when a
   * different config holds it. Returns null when even that cannot be minted.
   */
  private allocateName(rawName: string, identity: string): string | null {
    const base = rawName.replace(SERVER_NAME_PATTERN, '_').slice(0, MAX_SERVER_NAME_LENGTH)
    if (!base) return null
    const holder = this.takenNames.get(base)
    if (holder === undefined || holder === identity) {
      this.takenNames.set(base, identity)
      return base
    }
    for (let suffix = 2; suffix < 100; suffix++) {
      const candidate = `${base.slice(0, MAX_SERVER_NAME_LENGTH - 3)}-${suffix}`
      const taken = this.takenNames.get(candidate)
      if (taken === undefined || taken === identity) {
        this.takenNames.set(candidate, identity)
        return candidate
      }
    }
    return null
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
