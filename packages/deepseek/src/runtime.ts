import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
// Side-effect type import: declaration-merges the approval waterfall we answer below.
import type {} from '@deepseek-ai/dsh-user-approval'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekEventMapper } from './event-map'
import {
  installPermissionGate,
  mountToolPlane,
  type DeepseekToolPermissionRequest,
  type DeepseekToolPlaneOptions,
  type ToolApprovalDecision,
} from './tool-plane'
import { DeepseekMcpServers, type DeepseekMcpServerSpec } from './mcp-servers'
import type { DshPermissionPreset } from './permission-presets'
import { projectTrajectory } from './trajectory/project'
import type { TrajectoryProjection } from '@superone/shared/trajectory-types'
import {
  presetRoster,
  sessionIsBlank,
  storedSessionPreset,
  type DeepseekPresetRoster,
} from './presets'
import {
  createDeepseekTree,
  deepseekAdapterPlugin,
  type DeepseekAdapterOptions,
  type DeepseekTreeOptions,
  type DisposableFiber,
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
  /**
   * The preset composing this agent's tools and prompt. Omitted takes the
   * roster's default; ignored entirely when no roster is mounted.
   */
  agentPreset?: string
  cwd: string
  provider: string
  model: string
  maxTokens?: number
  onEvent: (event: AgentEvent) => void
  /** Resume a persisted dsh session instead of creating a fresh one. */
  resume?: boolean
  /**
   * This session's half of the tool plane: SuperOne's own tools and the
   * permission answerer its calls (and its delegated children's) are parked on.
   * dsh's file/shell/search/todo rows are mounted for the whole tree, so
   * omitting this leaves them available but ungated — every mutating call is
   * refused instead.
   */
  toolPlane?: DeepseekToolPlaneOptions
  /**
   * Third-party MCP servers from dsh's own profile patch layer. Deployment
   * level, like dsh itself treats them: mounted once for the whole tree.
   */
  mcpServers?: readonly DeepseekMcpServerSpec[]
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

/**
 * One picker-facing catalog row. Effort ids stay in dsh's own opaque
 * vocabulary; translating them to SuperOne's `EffortLevel` is the boundary's
 * job (`./reasoning-effort`), not this seam's.
 */
export interface DeepseekCatalogEntry {
  provider: string
  id: string
  name: string
  /** Adapter-advertised effort ids in adapter display order; empty when none. */
  reasoningEfforts: string[]
  /** The effort the adapter materializes when a request omits one. */
  defaultReasoningEffort?: string
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
  /** This session's permission answerer, also used by its delegated children. */
  requestPermission?: (request: DeepseekToolPermissionRequest) => Promise<ToolApprovalDecision>
  dispose: () => Promise<void>
}

/** How far up a delegation chain the permission gate will look for an owner. */
const MAX_DELEGATION_LOOKUP_DEPTH = 8

/** dsh's model-facing delegation tools, before the mapper renames them to `Task`. */
const DELEGATION_TOOLS = new Set(['subagent', 'subagent_fork'])

/** One live child, rendered inside its parent's `Task` block. */
interface SubagentRun {
  owner: AgentRecord
  /** The parent's `subagent` tool call — the key SuperOne's Task state uses. */
  toolUseId: string
  runId: string
  description: string
  startedAt: number
  mapper: DeepseekEventMapper
}

/**
 * The delegation call a child is being started from.
 *
 * `subagent/start` carries the child's id and a run id — and nothing else that
 * a host can use. Its declared `parent: Agent` argument never reaches a
 * listener: dsh's contained emitter dispatches with the parent as the scope
 * *carrier* and then invokes each callback as `callback(info)`. So both halves
 * of the link have to come from our side.
 *
 * A "last delegation wins" variable would not do it either — a parent may run
 * several delegations in one assistant message. This rides the async context of
 * the `tools/execute` span, which is exactly the span `provider.start()` is
 * awaited inside, so sibling delegations each see their own.
 */
const delegationSpan = new AsyncLocalStorage<{
  toolUseId: string
  description: string
  agentSessionId: string
}>()

/** Child-session events worth a Task-chip refresh; the rest are stream noise. */
const TASK_PROGRESS_EVENTS = new Set(['tool/call', 'tool/result', 'assistant/message', 'step/end'])

/**
 * The embedded dsh runtime: one Cordis tree per app lifetime hosting N agents,
 * driven exclusively through documented seams (`ctx.agents`, `session/event`,
 * `approval/request`) — the production descendant of the validated spike
 * (docs/draft/deepseek-harness-spike.mjs).
 */
export class DeepseekRuntime {
  private records = new Map<string, AgentRecord>()
  /** Live delegated children, keyed by the child's own dsh session id. */
  private subagentRuns = new Map<string, SubagentRun>()
  private adapterFiber: { dispose: () => Promise<void> } | null = null
  private readonly mcpServers: DeepseekMcpServers

  private constructor(
    private readonly root: Context,
    private readonly bridge: Context,
  ) {
    this.mcpServers = new DeepseekMcpServers(bridge)
  }

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
      const id = String(session.header.id)
      const record = runtime.records.get(id)
      if (record) {
        record.mapper.handle(event)
        return
      }
      // A delegated child has its own session and is absent from `records`; its
      // events render inside the parent's Task block through a nested mapper.
      const run = runtime.subagentRuns.get(id)
      if (!run) return
      run.mapper.handle(event)
      // The chip shows tool count, tokens and elapsed time; refreshing it on
      // every chunk would be one store write per streamed token.
      if (TASK_PROGRESS_EVENTS.has(event.type)) runtime.emitTaskProgress(run)
    })

    // Carry the delegating call and agent into everything the tool awaits, so
    // `subagent/start` can name both — it carries neither.
    bridge.on('tools/execute', ((
      exec: {
        name: string
        arguments?: unknown
        callId?: unknown
        agent?: { session: { header: { id: unknown } } }
      },
      next: () => Promise<unknown>,
    ) => {
      const agentSessionId = exec.agent?.session.header.id
      if (!DELEGATION_TOOLS.has(exec.name) || exec.callId === undefined || agentSessionId === undefined) {
        return next()
      }
      const args = exec.arguments as { description?: unknown } | undefined
      return delegationSpan.run(
        {
          toolUseId: String(exec.callId),
          description: typeof args?.description === 'string' ? args.description : 'subagent',
          agentSessionId: String(agentSessionId),
        },
        next,
      )
    }) as never)

    bridge.on('subagent/start', ((info: { runId: string; id: unknown }) => {
      runtime.beginSubagentRun(info)
    }) as never)

    bridge.on('subagent/end', ((info: {
      runId: string
      id: unknown
      stopReason: { kind?: string } | string
    }) => {
      runtime.endSubagentRun(info)
    }) as never)

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

    // One gate for every agent in the tree, including delegated children — the
    // per-session answerer is looked up per call, not captured per mount.
    installPermissionGate(bridge, (request) => runtime.answerPermission(request))


    return runtime
  }

  /**
   * Route one tool-permission question to the SuperOne session that owns the
   * calling agent.
   *
   * A delegated child has its own dsh session, so it is absent from `records`;
   * its durable header names its parent, and walking that chain lands on the
   * top-level session the user is actually looking at.
   *
   * The two ways that walk can come up empty are not the same thing. A session
   * that simply configured no answerer keeps dsh's own approval waterfall
   * (`undefined` defers). An agent that resolves to no SuperOne session at all
   * is refused: an effect nobody can attribute is an effect nobody can approve.
   */
  private async answerPermission(
    request: DeepseekToolPermissionRequest,
  ): Promise<ToolApprovalDecision | undefined> {
    const owner = request.agentSessionId
      ? this.ownerOf(request.agentSessionId)
      : undefined
    if (!owner) return 'rejected'
    if (!owner.requestPermission) return undefined
    return owner.requestPermission(request)
  }

  /**
   * Open a Task block for one delegated child and start routing its session
   * events into the parent's transcript.
   *
   * Both halves of the link come from the delegation span, because the event
   * carries neither: the tool call id, and the delegating agent — walked to its
   * owning SuperOne session, since a child may itself delegate. Without the
   * span there is nothing to attach the child to, so the run is left unrendered
   * rather than attached to a guess.
   */
  private beginSubagentRun(info: { runId: string; id: unknown }): void {
    const span = delegationSpan.getStore()
    if (!span) return
    const owner = this.ownerOf(span.agentSessionId)
    if (!owner) return

    const childSessionId = String(info.id)
    const run: SubagentRun = {
      owner,
      toolUseId: span.toolUseId,
      runId: String(info.runId),
      description: span.description,
      startedAt: Date.now(),
      mapper: new DeepseekEventMapper({
        sessionId: childSessionId,
        emit: owner.onEvent,
        nested: {
          parentToolUseId: span.toolUseId,
          resolveMessageId: () => owner.mapper.currentMessageId(),
        },
      }),
    }
    this.subagentRuns.set(childSessionId, run)
    owner.onEvent({
      type: 'task_started',
      taskId: run.runId,
      toolUseId: run.toolUseId,
      description: run.description,
      taskType: 'subagent',
    })
  }

  /** Refresh the parent's Task chip from what the child has done so far. */
  private emitTaskProgress(run: SubagentRun): void {
    const stats = run.mapper.stats()
    run.owner.onEvent({
      type: 'task_progress',
      taskId: run.runId,
      toolUseId: run.toolUseId,
      description: run.description,
      usage: {
        totalTokens: stats.totalTokens,
        toolUses: stats.toolUses,
        durationMs: Date.now() - run.startedAt,
      },
    })
  }

  /** Close the Task block. dsh's stop reason decides completed vs failed. */
  private endSubagentRun(info: {
    runId: string
    id: unknown
    stopReason: { kind?: string } | string
  }): void {
    const childSessionId = String(info.id)
    const run = this.subagentRuns.get(childSessionId)
    if (!run) return
    this.subagentRuns.delete(childSessionId)

    const kind = typeof info.stopReason === 'string' ? info.stopReason : info.stopReason?.kind
    const stats = run.mapper.stats()
    run.owner.onEvent({
      type: 'task_notification',
      taskId: run.runId,
      toolUseId: run.toolUseId,
      taskStatus: kind === 'completed' ? 'completed' : kind === 'aborted' ? 'stopped' : 'failed',
      // dsh keeps the child's transcript in its own JSONL session log, which is
      // not a path SuperOne's "open full view" can read yet. The reducer treats
      // an empty path as absent and keeps whatever it already had.
      outputFile: '',
      usage: {
        totalTokens: stats.totalTokens,
        toolUses: stats.toolUses,
        durationMs: Date.now() - run.startedAt,
      },
    })
  }

  /**
   * Forget a disposed session's children. Their own teardown is dsh's — this
   * only stops routing their events into a transcript that is going away.
   */
  private dropSubagentRunsOf(owner: AgentRecord): void {
    for (const [childSessionId, run] of [...this.subagentRuns]) {
      if (run.owner === owner) this.subagentRuns.delete(childSessionId)
    }
  }

  /** The record for this dsh session, or the nearest ancestor that has one. */
  private ownerOf(agentSessionId: string): AgentRecord | undefined {
    const sessions = (this.bridge as Context & {
      get(name: string): unknown
    }).get('sessions') as {
      get(id: unknown): { header: { parentSession?: unknown } } | undefined
    } | undefined

    let id: string | undefined = agentSessionId
    for (let depth = 0; depth < MAX_DELEGATION_LOOKUP_DEPTH && id; depth += 1) {
      const record = this.records.get(id)
      if (record) return record
      const parent: unknown = sessions?.get(SessionId(id))?.header.parentSession
      id = parent === undefined ? undefined : String(parent)
    }
    return undefined
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
  async listModels(): Promise<DeepseekCatalogEntry[]> {
    const llm = (this.bridge as Context & { llm: {
      listProviders(): Array<{ id: string }>
      listModels(provider: string): Promise<ReadonlyArray<{ provider: string; id: string; name: string }>>
      resolveModelInfo(provider: string, model: string): Promise<{
        reasoning?: {
          efforts: ReadonlyArray<{ id: string }>
          defaultEffort?: string
        }
      }>
    } }).llm
    const listed: Array<{ provider: string; id: string; name: string }> = []
    for (const provider of llm.listProviders()) {
      const list = await llm.listModels(provider.id)
      listed.push(...list.map((m) => ({ provider: m.provider, id: m.id, name: m.name })))
    }
    // `listModels` is the *advisory* catalog and carries no reasoning metadata
    // by design — only `resolveModelInfo` asks the adapter that owns one exact
    // route what that route can actually do. Hence one resolve per model, run
    // concurrently. A model whose resolve fails still belongs in the picker; it
    // just offers no efforts, which is what an unknown capability means here.
    return Promise.all(listed.map(async (model) => {
      try {
        const info = await llm.resolveModelInfo(model.provider, model.id)
        return {
          ...model,
          reasoningEfforts: info.reasoning?.efforts.map((effort) => effort.id) ?? [],
          ...(info.reasoning?.defaultEffort !== undefined
            ? { defaultReasoningEffort: info.reasoning.defaultEffort }
            : {}),
        }
      } catch {
        return { ...model, reasoningEfforts: [] }
      }
    }))
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
    // Mounted before the agent exists, in the tree's global layer: dsh's MCP
    // servers are deployment-level, so re-syncing here just picks up an edit to
    // the profile patch layer since the last session started.
    if (options.mcpServers) await this.mcpServers.sync(options.mcpServers)

    // Creation-time composition: everything `setup` mounts exists before the
    // first prompt assembly, and it unwinds with the agent.
    const toolPlane = options.toolPlane
    const presets = presetRoster(this.bridge)
    // A resumed session recomposes with the preset its history was PRODUCED
    // under, read from its own log — never the caller's pick and never the
    // roster default. Restoring a different composition would replay tool calls
    // the new catalog cannot make, which is the hazard the blank-only switch
    // lock exists to prevent in the first place.
    const preset = options.resume && presets
      ? await storedSessionPreset(this.bridge, options.sessionId) ?? options.agentPreset
      : options.agentPreset
    // Resolved to its canonical id BEFORE creation, because the header is a
    // creation fact: `mount()` runs inside `setup`, by which point the header
    // is already frozen. `mount()` returning the preset "for the caller to
    // record" is exactly this — without it a resumed session has nothing to
    // read and silently falls back to the roster default.
    const createdPreset = presets && !options.resume
      ? (await presets.resolve(preset)).id
      : undefined
    // `setup` is the one supported call site for a preset mount: only here is
    // the join installed while the agent is still unpublished, so a rejected
    // composition rolls the whole creation back instead of leaving a session
    // half-composed. SuperOne's own tools go on the agent's scope after it, so
    // a preset can never shadow them.
    const setup = {
      setup: async (agentCtx: Context) => {
        if (presets) await presets.mount(agentCtx, preset)
        if (toolPlane) await mountToolPlane(agentCtx, toolPlane)
      },
    }
    const handle = options.resume
      ? await agents.resume({ resumeSessionId: SessionId(options.sessionId), agentOptions, ...setup })
      : await agents.create({
          sessionId: SessionId(options.sessionId),
          meta: { cwd: options.cwd, ...(createdPreset ? { agentPreset: createdPreset } : {}) },
          agentOptions,
          ...setup,
        })

    const record: AgentRecord = {
      agent: handle.agent,
      mapper: new DeepseekEventMapper({ sessionId: options.sessionId, emit: options.onEvent }),
      onEvent: options.onEvent,
      route: {},
      ...(toolPlane ? { requestPermission: toolPlane.requestPermission } : {}),
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
        runtime.dropSubagentRunsOf(record)
        await record.dispose()
      },
    }
  }

  /**
   * Fork a persisted session into a new one, through `boundary` inclusive.
   *
   * Copies at the persistence layer rather than through `ctx.sessions.fork`.
   * That API needs a LIVE source — the usual fork is cold — and it publishes
   * the child, which then cannot be resumed in the same process ("cannot
   * prepare session while it is live"). Writing the prefix as a new log leaves
   * nothing live and lets the child start through the ordinary resume path,
   * the same shape as Claude's fork.
   *
   * @param sourceSessionId - dsh session id of the source.
   * @param childSessionId - id to mint for the fork.
   * @param boundary - inclusive source event seq; omitted forks the whole log.
   */
  async forkSession(
    sourceSessionId: string,
    childSessionId: string,
    boundary?: number,
  ): Promise<string> {
    const persistence = (this.bridge as Context & {
      get(name: string): unknown
    }).get('sessionPersistence') as {
      load(id: unknown): Promise<{ meta: Record<string, unknown>; events: readonly { seq: number }[] }>
      create(meta: Record<string, unknown>): Promise<void>
      append(id: unknown, events: readonly unknown[]): Promise<void>
    } | undefined
    if (!persistence) {
      throw new Error('deepseek fork: session persistence is not configured')
    }

    const source = await persistence.load(SessionId(sourceSessionId))
    const prefix = boundary === undefined
      ? source.events
      : source.events.filter((event) => event.seq <= boundary)
    if (prefix.length === 0) {
      throw new Error(`deepseek fork: nothing to fork before seq ${String(boundary)}`)
    }

    await persistence.create({
      ...source.meta,
      id: SessionId(childSessionId),
      // Lineage dsh reads back: where this branched and how much of it is seed.
      parentSession: SessionId(sourceSessionId),
      seedLength: prefix.length,
      createdAt: Date.now(),
    })
    await persistence.append(SessionId(childSessionId), prefix)
    return childSessionId
  }

  /**
   * Project one session's raw dsh log onto the trajectory wire model.
   *
   * A live session answers from `session.events`: the in-memory log is
   * authoritative and already holds work the persistence backend has not
   * flushed. Everything else loads the durable transcript, which is the same
   * log — `assistant/chunk` frames included — so a closed session projects
   * identically to how it looked while it ran.
   *
   * The projection is what crosses the process boundary, never the raw events:
   * a real session's chunk frames outnumber its records by three orders of
   * magnitude, and none of them survive the fold.
   * @param sessionId - the dsh session to project.
   * @returns the projection, or `null` when this session has no dsh log at all.
   */
  async trajectory(sessionId: string): Promise<TrajectoryProjection | null> {
    const bridge = this.bridge as Context & { get(name: string): unknown }
    const sessions = bridge.get('sessions') as {
      get(id: unknown): { events: readonly SessionEvent[] } | undefined
    } | undefined
    const live = sessions?.get(SessionId(sessionId))
    if (live) return projectTrajectory(sessionId, live.events, true)

    const persistence = bridge.get('sessionPersistence') as {
      load(id: unknown): Promise<{ events: readonly SessionEvent[] }>
      list(signal?: AbortSignal): Promise<readonly { id: unknown }[]>
    } | undefined
    if (!persistence) {
      throw new Error('deepseek trajectory: session persistence is not configured')
    }

    // A SuperOne session exists from the moment the user opens it, but its dsh
    // session only exists once a turn has run. `list` omits a
    // created-but-never-appended session, so this separates "nothing has
    // happened yet" from "the log is there and unreadable" without matching on
    // a backend error string.
    const known = await persistence.list()
    if (!known.some((header) => String(header.id) === sessionId)) return null

    const stored = await persistence.load(SessionId(sessionId))
    return projectTrajectory(sessionId, stored.events, false)
  }

  /**
   * The preset one LIVE session is composed from.
   * @param sessionId - the session to read.
   * @returns the preset id, or `undefined` without a roster or a live agent.
   */
  sessionPreset(sessionId: string): string | undefined {
    const record = this.records.get(sessionId)
    if (!record) return undefined
    // Read off the agent's scope chain rather than its session: this is the
    // only answer available while a durable header is still being built.
    return presetRoster(this.bridge)?.composedPreset(record.agent.ctx)
  }

  /**
   * Whether one live session has produced nothing yet.
   * @param sessionId - the session to check.
   * @returns whether no turn has opened; `true` for a session with no agent.
   */
  sessionIsBlank(sessionId: string): boolean {
    const sessions = (this.bridge as Context & { get(name: string): unknown })
      .get('sessions') as { get(id: unknown): { events: readonly SessionEvent[] } | undefined } | undefined
    const session = sessions?.get(SessionId(sessionId))
    return session === undefined || sessionIsBlank(session.events)
  }

  /**
   * Re-link a blank session to a different preset's standing composition.
   *
   * Refused once the session has produced anything. That is a product rule, not
   * a mechanical one — swapping the tool catalog mid-conversation would leave
   * logged tool calls the new composition cannot make — and dsh leaves the
   * check to the caller, so it lives here.
   * @param sessionId - the session to switch.
   * @param presetId - the preset to compose it from.
   */
  async switchPreset(sessionId: string, presetId: string): Promise<void> {
    const record = this.records.get(sessionId)
    if (!record) throw new Error(`deepseek preset: no live agent for session ${sessionId}`)
    const roster = presetRoster(this.bridge)
    if (!roster) throw new Error('deepseek preset: no roster is composed')

    const sessions = (this.bridge as Context & { get(name: string): unknown })
      .get('sessions') as { get(id: unknown): { events: readonly SessionEvent[] } | undefined } | undefined
    const session = sessions?.get(SessionId(sessionId))
    if (session && !sessionIsBlank(session.events)) {
      throw new Error('deepseek preset: this session has already run a turn')
    }

    await roster.recompose(record.agent.ctx, presetId)
  }

  /**
   * Switch one session's permission preset.
   *
   * The preset is dsh's own vocabulary — it bundles the sandbox mode the shell
   * and filesystem run under with whether approval questions are asked at all —
   * and the switch IS a durable `sandbox/mode` + `approval/policy` pair on that
   * session's log, so it survives resume by replay and never leaks into a
   * sibling session. Selecting the effective preset again appends nothing.
   */
  setPermissionPreset(sessionId: string, preset: DshPermissionPreset): void {
    const record = this.records.get(sessionId)
    if (!record) return
    const presets = (this.bridge as Context & { get(name: string): unknown })
      .get('permissionPresets') as {
        set(session: unknown, name: string): void
      } | undefined
    if (!presets) return
    presets.set((record.agent as unknown as { session: unknown }).session, preset)
  }


  /**
   * Compact one session's history now, on the user's explicit request.
   *
   * Automatic compaction needs no seam — `compaction-basic` mounts its own
   * step-boundary pressure listener. This is the manual path, and it goes
   * straight to `ctx.compaction.compactNow()` rather than through
   * `dsh-command-compact`, because SuperOne owns the slash surface.
   *
   * The whole bracket (`compaction/start` … `compaction/end`) lands on the
   * session log, so the transcript-facing events come from the mapper like any
   * other dsh activity. What this returns is only whether the request itself
   * got that far: `compactNow` resolves without writing when no useful span
   * exists, and rejects with `ManualCompactionError` for `busy`/`changed`/
   * `summary`/`commit`/`persistence`.
   */
  async compactSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    const record = this.records.get(sessionId)
    if (!record) throw new Error(`deepseek compact: no live agent for session ${sessionId}`)

    // Through the command registry, not the engine directly. A preset puts its
    // compaction engine behind an entry-local `isolate` realm, so the ONLY
    // context that can resolve `ctx.compaction` is one inside that same group —
    // which is exactly where the preset also puts `command-compact`. Reaching
    // for the service from out here resolves the outer realm and finds nothing.
    const commands = (this.bridge as Context & { get(name: string): unknown })
      .get('commands') as {
        execute(agent: Agent, line: string, signal: AbortSignal): Promise<{
          result: { kind: 'success' | 'error'; text?: string }
        } | undefined>
      } | undefined
    if (!commands) throw new Error('deepseek compact: command registry is not mounted')

    const execution = await commands.execute(
      record.agent,
      '/compact',
      signal ?? new AbortController().signal,
    )
    // `execute` answers `undefined` for a line no composed command claims —
    // which for `/compact` means this session's preset composes no compaction
    // engine at all, not that the compaction failed.
    if (execution === undefined) {
      throw new Error('deepseek compact: this session\'s preset composes no compaction engine')
    }
    // A command handler normalizes its failure into the result rather than
    // throwing — a second compaction racing the first comes back as `error`,
    // not a rejection — so the caller's contract is restored here.
    if (execution.result.kind === 'error') {
      throw new Error(`deepseek compact: ${execution.result.text ?? 'compaction failed'}`)
    }
  }

  /**
   * Re-mount third-party MCP servers from a fresh read of dsh's config.
   *
   * Sessions already sync at creation; this is the seam for a config edit that
   * lands while sessions are running. The registrar diffs by server name, so
   * calling this with unchanged specs is free.
   */
  async syncMcpServers(specs: readonly DeepseekMcpServerSpec[]): Promise<void> {
    await this.mcpServers.sync(specs)
  }

  async dispose(): Promise<void> {
    for (const [sessionId, record] of [...this.records]) {
      this.records.delete(sessionId)
      await record.dispose()
    }
    await this.mcpServers.dispose()
    await (this.root as Context & { stop?: () => Promise<void> }).stop?.()
  }
}
