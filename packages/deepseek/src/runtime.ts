import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
// Side-effect type import: declaration-merges the approval waterfall we answer below.
import type {} from '@deepseek-ai/dsh-user-approval'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekEventMapper } from './event-map'
import {
  createDeepseekTree,
  deepseekAdapterPlugin,
  type DeepseekAdapterOptions,
  type DeepseekTreeOptions,
} from './tree'

export type ApprovalDecision = 'allowed-once' | 'rejected' | 'cancelled'

export interface DeepseekApprovalRequest {
  sessionId: string
  toolName: string
  callId?: string
  reason?: string
  /** Aborts when dsh withdraws the question; settle promptly after it fires. */
  signal?: AbortSignal
}

export interface DeepseekRuntimeOptions extends DeepseekTreeOptions {
  /**
   * Answer one HITL approval question (SuperOne's permission popover).
   * Absent handler = delegate to dsh's default policy (fail-closed under
   * `policy: 'ask'` with no other answerer mounted).
   */
  onApproval?: (request: DeepseekApprovalRequest) => Promise<ApprovalDecision>
}

export interface CreateDeepseekAgentOptions {
  sessionId: string
  cwd: string
  provider: string
  model: string
  maxTokens?: number
  onEvent: (event: AgentEvent) => void
  /** Resume a persisted dsh session instead of creating a fresh one. */
  resume?: boolean
}

export interface DeepseekAgentHandle {
  readonly sessionId: string
  sendText(text: string): void
  cancel(): void
  /**
   * Change the route for subsequent requests without rebuilding the agent.
   * `AgentOptions` is create-time and readonly, so the switch rides the
   * documented `agent/request` waterfall instead.
   */
  setRoute(route: { provider?: string; model?: string; reasoningEffort?: string }): void
  whenIdle(): Promise<void>
  status(): 'idle' | 'running'
  dispose(): Promise<void>
}

interface RouteOverride {
  provider?: string
  model?: string
  reasoningEffort?: string
}

interface AgentRecord {
  agent: Agent
  mapper: DeepseekEventMapper
  onEvent: (event: AgentEvent) => void
  route: RouteOverride
  dispose: () => Promise<void>
}

/**
 * The embedded dsh runtime: one Cordis tree per app lifetime hosting N agents,
 * driven exclusively through documented seams (`ctx.agents`, `session/event`,
 * `approval/request`) — the production descendant of the validated spike
 * (docs/draft/deepseek-harness-spike.mjs).
 */
export class DeepseekRuntime {
  private records = new Map<string, AgentRecord>()
  private adapterFiber: { dispose: () => Promise<void> } | null = null

  private constructor(
    private readonly root: Context,
    private readonly bridge: Context,
  ) {}

  /**
   * The bridge plugin's scoped context — the mount point for additional
   * SuperOne-owned dsh plugins (native tools, MCP client, adapters) and the
   * seam tests use to register mock adapters. Everything reachable from here
   * is a documented dsh extension point; loop internals stay private to dsh.
   */
  get context(): Context {
    return this.bridge
  }

  static async create(options: DeepseekRuntimeOptions): Promise<DeepseekRuntime> {
    const root = await createDeepseekTree(options)

    const bridge = await new Promise<Context>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('deepseek runtime: bridge plugin never activated (missing services)')),
        10_000,
      )
      root.plugin({
        name: 'superone-bridge',
        inject: ['agents', 'llm', 'tools', 'sessions'],
        apply(pluginCtx: Context) {
          clearTimeout(timeout)
          resolve(pluginCtx)
        },
      })
    })

    const runtime = new DeepseekRuntime(root, bridge)

    bridge.on('session/event', (session: { header: { id: string } }, event: SessionEvent) => {
      const record = runtime.records.get(String(session.header.id))
      record?.mapper.handle(event)
    })

    bridge.on('agent/status', ({ agent, status }: { agent: Agent; status: 'idle' | 'running' }) => {
      const record = runtime.records.get(String(agent.id))
      if (!record) return
      record.onEvent({ type: 'status_change', status: status === 'running' ? 'streaming' : 'idle' })
    })

    // In-place route switching: AgentOptions is create-time and readonly, so a
    // model/effort change rides this waterfall instead of forcing a rebuild.
    bridge.on('agent/request', async (payload, next) => {
      const config = await next()
      const route = runtime.records.get(String(payload.agent.id))?.route
      if (!route) return config
      return {
        ...config,
        ...(route.provider !== undefined ? { provider: route.provider } : {}),
        ...(route.model !== undefined ? { model: route.model } : {}),
        ...(route.reasoningEffort !== undefined
          ? { reasoningEffort: route.reasoningEffort as typeof config.reasoningEffort }
          : {}),
      }
    })

    if (options.onApproval) {
      const onApproval = options.onApproval
      bridge.on('approval/request', (request: {
        agent: Agent
        toolName: string
        callId?: unknown
        reason?: string
        signal?: AbortSignal
      }, next: () => Promise<ApprovalDecision>) => {
        const record = runtime.records.get(String(request.agent.id))
        if (!record) return next()
        return onApproval({
          sessionId: String(request.agent.id),
          toolName: request.toolName,
          ...(request.callId !== undefined ? { callId: String(request.callId) } : {}),
          ...(request.reason !== undefined ? { reason: request.reason } : {}),
          ...(request.signal !== undefined ? { signal: request.signal } : {}),
        })
      })
    }

    return runtime
  }

  /**
   * Mount (or re-mount) the official DeepSeek adapter. Cordis registrations are
   * reversible effects, so a changed credential or model list swaps the adapter
   * fiber in place — no tree restart, no session loss.
   */
  configureProvider(options: DeepseekAdapterOptions): void {
    this.adapterFiber?.dispose()
    const { plugin, config } = deepseekAdapterPlugin(options)
    this.adapterFiber = this.bridge.plugin(plugin, config) as { dispose: () => Promise<void> }
  }

  /** Live model catalog for pickers, straight from the adapter registries. */
  async listModels(): Promise<Array<{ provider: string; id: string; name: string }>> {
    const llm = (this.bridge as Context & { llm: {
      listProviders(): Array<{ id: string }>
      listModels(provider: string): Promise<ReadonlyArray<{ provider: string; id: string; name: string }>>
    } }).llm
    const models: Array<{ provider: string; id: string; name: string }> = []
    for (const provider of llm.listProviders()) {
      const list = await llm.listModels(provider.id)
      models.push(...list.map((m) => ({ provider: m.provider, id: m.id, name: m.name })))
    }
    return models
  }

  async createAgent(options: CreateDeepseekAgentOptions): Promise<DeepseekAgentHandle> {
    const agents = (this.bridge as Context & { agents: {
      create(opts: unknown): Promise<{ agent: Agent; dispose(): Promise<void> }>
      resume(opts: unknown): Promise<{ agent: Agent; dispose(): Promise<void> }>
    } }).agents

    const agentOptions = {
      provider: options.provider,
      model: options.model,
      ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    }
    const handle = options.resume
      ? await agents.resume({ resumeSessionId: SessionId(options.sessionId), agentOptions })
      : await agents.create({
          sessionId: SessionId(options.sessionId),
          meta: { cwd: options.cwd },
          agentOptions,
        })

    const record: AgentRecord = {
      agent: handle.agent,
      mapper: new DeepseekEventMapper({ sessionId: options.sessionId, emit: options.onEvent }),
      onEvent: options.onEvent,
      route: {},
      dispose: () => handle.dispose(),
    }
    this.records.set(options.sessionId, record)

    const runtime = this
    return {
      sessionId: options.sessionId,
      sendText(text) {
        // followup() queues and wakes; input landing between turn/end and idle
        // can park until the next wake (integration plan §3 footgun 2) — the
        // queued-message chip covers that surface until steering lands.
        record.agent.followup(createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }))
      },
      cancel() {
        record.agent.cancel({ kind: 'user' })
      },
      setRoute(route) {
        Object.assign(record.route, route)
      },
      whenIdle: () => record.agent.whenIdle(),
      status: () => record.agent.status,
      async dispose() {
        runtime.records.delete(options.sessionId)
        await record.dispose()
      },
    }
  }

  async dispose(): Promise<void> {
    for (const [sessionId, record] of [...this.records]) {
      this.records.delete(sessionId)
      await record.dispose()
    }
    await (this.root as Context & { stop?: () => Promise<void> }).stop?.()
  }
}
