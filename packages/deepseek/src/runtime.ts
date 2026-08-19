import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ImageBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
// Side-effect type imports: each declaration-merges one service onto `Context`,
// which is what makes `ctx.get('name')` return that service's REAL upstream type
// instead of `any`. Without them the reads below would need a hand-written
// structural shape, and TypeScript would then validate our calls against our own
// declaration rather than upstream's — the exact hole that let rc.8's added
// `CommandRuntime.execute` parameter through a green typecheck and broke
// `/compact` at runtime. Keep one line here per service this file resolves.
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-commands'
import { AttachmentId, type EncodedImageAttachment, type ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type { AgentEvent, ImageAttachment } from '@superone/shared/agent-types'
import { admitImageBlocks, encodeComposerImages, modelAcceptsImages } from './images'
import { extractSubagentDiagnostic } from './subagent-diagnostic'
import { DeepseekEventMapper } from './event-map'
import {
  installPermissionGate,
  mountToolPlane,
  type DeepseekToolPermissionRequest,
  type DeepseekToolPlaneOptions,
  type ToolApprovalDecision,
} from './tool-plane'
import { DeepseekMcpServers, type DeepseekMcpServerSpec } from './mcp-servers'
import { DeepseekPlugins, type MountReport } from './plugin-host/mount'
import type { DshPermissionPreset } from './permission-presets'
import { TrajectoryFold } from './trajectory/fold'
import type {
  TrajectoryDelta,
  TrajectoryImageRef,
  TrajectoryPage,
  TrajectoryProjection,
} from '@superone/shared/trajectory-types'
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
   * Writable root holding third-party plugins the user installed
   * (`<userData>/dsh-plugins`). Omit to run with only the plugins this build
   * carries — what every test that does not care about them wants.
   */
  pluginRoot?: string
  /**
   * Receives the outcome of each plugin reconcile pass, including the one at
   * boot.
   *
   * A callback rather than a return value because a plugin that fails is not a
   * boot failure — the runtime comes up without it — but the user still has to
   * be told, and only the host knows where to say it.
   */
  onPluginMount?: (report: MountReport) => void
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
  /**
   * Queue one user turn.
   *
   * Async because images are committed to the durable attachment store before
   * the message is queued; a rejection means nothing was queued and nothing was
   * stored, so the caller may surface the error and let the user retry.
   */
  sendText(text: string, images?: readonly ImageAttachment[]): Promise<void>
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
/**
 * How many session folds stay resident.
 *
 * Small on purpose: a fold retains its session's records, and the panel is
 * an inspection surface a user points at one session at a time.
 */
const TRAJECTORY_FOLD_CACHE = 8

export class DeepseekRuntime {
  private records = new Map<string, AgentRecord>()
  /** Live delegated children, keyed by the child's own dsh session id. */
  private subagentRuns = new Map<string, SubagentRun>()
  /**
   * Task id of a delegation that has already ended, keyed by its `subagent`
   * call. The run itself is gone from `subagentRuns` by the time the tool
   * rejects, but the diagnostic that arrives then still has to reach the Task
   * block it belongs to. Entries are consumed on use, and a run that ends
   * cleanly has its entry dropped rather than left to accumulate.
   */
  private endedSubagentTasks = new Map<string, string>()
  private adapterFiber: { dispose: () => Promise<void> } | null = null
  /** Open trajectory folds, keyed by dsh session id. */
  private readonly folds = new Map<string, { fold: TrajectoryFold; live: boolean }>()
  /** Notified for every appended session event, before it is mapped. */
  readonly logListeners = new Set<(dshSessionId: string) => void>()
  private readonly mcpServers: DeepseekMcpServers
  private readonly plugins: DeepseekPlugins
  private onPluginMount: ((report: MountReport) => void) | undefined

  private constructor(
    private readonly root: Context,
    private readonly bridge: Context,
    pluginRoot: string | undefined,
    onPluginMount: ((report: MountReport) => void) | undefined,
  ) {
    this.mcpServers = new DeepseekMcpServers(bridge)
    this.plugins = new DeepseekPlugins(bridge, pluginRoot)
    this.onPluginMount = onPluginMount
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

    const runtime = new DeepseekRuntime(root, bridge, options.pluginRoot, options.onPluginMount)

    bridge.on('session/event', (session: { header: { id: string } }, event: SessionEvent) => {
      const id = String(session.header.id)
      // Announced before any mapping: the trajectory follows the log, and the
      // AgentEvent stream is a lossy projection of it — `request/header`,
      // injected context, preset selection and approvals never reach a
      // consumer that listens there instead.
      for (const listener of runtime.logListeners) listener(id)
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
      const toolUseId = String(exec.callId)
      return delegationSpan.run(
        {
          toolUseId,
          description: typeof args?.description === 'string' ? args.description : 'subagent',
          agentSessionId: String(agentSessionId),
        },
        // A delegation that ends badly rejects here, and that rejection is the
        // ONLY place a provider's `SubagentResult.diagnostic` is observable:
        // `subagent/end`, which is what closes the Task block, does not carry
        // one. Catching it here — rather than re-reading the rendered tool
        // result later — keeps the failure detail attached to the exact call it
        // belongs to. The error is re-thrown untouched, so dsh still turns it
        // into the model-facing tool error it always did.
        () => next().catch((error: unknown) => {
          runtime.reportSubagentDiagnostic(
            String(agentSessionId),
            toolUseId,
            error instanceof Error ? error.message : String(error),
          )
          throw error
        }),
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

    // Third-party plugins mount last, so every service this build provides — and
    // the permission gate above — is already in place when they load. A plugin
    // that fails is reported through `onPluginMount`, never thrown: the runtime
    // is usable without it.
    await runtime.syncPlugins()

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
    // Only a non-clean ending can carry a diagnostic, so only that case leaves
    // an entry for the tool rejection to find.
    if (kind === 'completed') this.endedSubagentTasks.delete(run.toolUseId)
    else this.endedSubagentTasks.set(run.toolUseId, run.runId)
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
   * Attach a failed delegation's provider diagnostic to its Task block.
   *
   * A second `task_notification` for the same task rather than a field on the
   * first, because the two facts become available in that order and cannot be
   * merged at the source: `subagent/end` closes the block and carries no
   * diagnostic, and the diagnostic only exists once the tool rejects, which
   * happens after. The reducer merges a later notification onto the entry it
   * already has — omitted usage and summary keep their previous values — so
   * this adds detail without disturbing anything already shown.
   *
   * Nothing is emitted for a failure that carried no diagnostic, which leaves
   * the chip exactly as it was rather than replacing a real message with a
   * blank one.
   * @param agentSessionId - the DELEGATING agent's session.
   * @param toolUseId - the `subagent` call this failure belongs to.
   * @param message - the error text the tool rejected with.
   */
  private reportSubagentDiagnostic(agentSessionId: string, toolUseId: string, message: string): void {
    const taskId = this.endedSubagentTasks.get(toolUseId)
    if (taskId === undefined) return
    this.endedSubagentTasks.delete(toolUseId)
    const diagnostic = extractSubagentDiagnostic(message)
    if (diagnostic === undefined) return
    const owner = this.ownerOf(agentSessionId)
    if (!owner) return
    owner.onEvent({
      type: 'task_notification',
      taskId,
      toolUseId,
      taskStatus: 'failed',
      outputFile: '',
      diagnostic,
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
    const sessions = this.bridge.get('sessions')

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
    const llm = this.bridge.llm
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
    const agents = this.bridge.agents

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
      async sendText(text, images) {
        // Images are committed BEFORE the message is queued, and a refusal
        // throws out of here without queueing anything. That ordering is the
        // whole point: an admitted image lives in the durable log and rides
        // every later request of the session, so a message that dsh could
        // store but not serialize would not fail once — it would fail on every
        // subsequent turn too, with no way back. See `imageBlocksFor`.
        const encoded = images?.length ? encodeComposerImages(images) : []
        const imageBlocks = encoded.length > 0
          ? await runtime.imageBlocksFor(record, options, encoded)
          : []
        // followup() queues and wakes; input landing between turn/end and idle
        // can park until the next wake (integration plan §3 footgun 2) — the
        // queued-message chip covers that surface until steering lands.
        record.agent.followup(createUserMessage({
          content: [{ type: 'text', text }, ...imageBlocks],
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
   * Commit one message's images, refusing before anything durable is written.
   *
   * Two refusals, both deliberate and both BEFORE `admitEncodedImages`:
   *
   * 1. **No attachment store.** A tree mounted without `attachmentHome` has
   *    nowhere to put the bytes. The DeepSeek adapter reports the same thing
   *    (`resolveAttachments` returning undefined rejects image input), but it
   *    reports it at serialization — by which point the message is logged.
   * 2. **The model does not accept images.** `llm-deepseek` refuses image
   *    content for any model whose catalog entry omits the `image` modality,
   *    and it refuses it while serializing a request from history. An image
   *    admitted for a text-only model would therefore poison the session
   *    permanently: every later turn re-serializes the same history and throws
   *    again. Checking `inputModalities` first is what keeps that from
   *    happening, and it reads the very field the adapter enforces, so the two
   *    cannot disagree about a model.
   *
   * Both throw rather than dropping the images silently. The user attached
   * something and is owed an answer about it, and a failed send leaves the
   * session exactly as it was — nothing was queued, nothing was stored.
   * @param record - the live agent, for its current route.
   * @param created - the creation options holding the route's defaults.
   * @param encoded - already-projected wire images.
   * @returns one block per image, ready to append to the user message.
   */
  private async imageBlocksFor(
    record: AgentRecord,
    created: CreateDeepseekAgentOptions,
    encoded: readonly EncodedImageAttachment[],
  ): Promise<ImageBlock[]> {
    const store = this.bridge.get('attachments')
    if (!store) {
      throw new Error('deepseek images: no attachment store is mounted, so images cannot be sent')
    }
    // The route a request would actually take: `setRoute` overrides the model
    // picked at creation, and the capability belongs to whichever one wins.
    const provider = record.route.provider ?? created.provider
    const model = record.route.model ?? created.model
    const info = await this.bridge.llm.resolveModelInfo(provider, model)
    if (!modelAcceptsImages(info.inputModalities)) {
      throw new Error(`deepseek images: model "${model}" does not accept image input`)
    }
    return admitImageBlocks(store, encoded)
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
    const persistence = this.bridge.get('sessionPersistence')
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
   * The fold is held open between calls. A caller that sends the cursor it last
   * received gets only what changed since; one that sends nothing, or whose
   * cursor belongs to a fold that has since been rebuilt, gets a full window.
   * Re-folding per poll would cost the entire history on every frame of a
   * streaming turn, which is exactly when the panel is most likely to be open.
   *
   * The projection is what crosses the process boundary, never the raw events:
   * a real session's chunk frames outnumber its records by three orders of
   * magnitude, and none of them survive the fold.
   * @param sessionId - the dsh session to project.
   * @param cursor - the caller's last known cursor, absent for a first read.
   * @returns the read, or `null` when this session has no dsh log at all.
   */
  async trajectory(
    sessionId: string,
    cursor?: number,
  ): Promise<
    { kind: 'full'; trajectory: TrajectoryProjection } | { kind: 'delta'; delta: TrajectoryDelta } | null
  > {
    const entry = await this.foldFor(sessionId)
    if (entry === null) return null
    // A cursor ahead of the fold belongs to a previous fold of this session
    // (a restart, or a live session that has since closed and been reloaded).
    // Answering a delta there would merge two different histories.
    if (cursor === undefined || cursor > entry.fold.cursor) {
      return { kind: 'full', trajectory: entry.fold.snapshot(entry.live) }
    }
    return { kind: 'delta', delta: entry.fold.delta(cursor, entry.live) }
  }

  /**
   * Watch every session log this runtime appends to.
   *
   * The listener receives the dsh session id and nothing else: what changed is
   * a question the fold answers from the caller's own cursor, and pushing the
   * change itself would require this runtime to track every consumer's window.
   * @param listener - called once per appended event.
   * @returns a disposer.
   */
  onLogEvent(listener: (dshSessionId: string) => void): () => void {
    this.logListeners.add(listener)
    return () => {
      this.logListeners.delete(listener)
    }
  }

  /**
   * The full window, for a caller that holds no cursor.
   * @param sessionId - the dsh session to project.
   * @returns the projection, or `null` when this session has no dsh log at all.
   */
  async trajectorySnapshot(sessionId: string): Promise<TrajectoryProjection | null> {
    const entry = await this.foldFor(sessionId)
    return entry === null ? null : entry.fold.snapshot(entry.live)
  }

  /**
   * One page of records older than a consumer's loaded window.
   * @param sessionId - the dsh session to read.
   * @param before - the `index` of the consumer's first loaded record.
   * @param count - how many records to return.
   * @returns the page, or `null` when this session has no dsh log at all.
   */
  async trajectoryPage(sessionId: string, before: number, count: number): Promise<TrajectoryPage | null> {
    const entry = await this.foldFor(sessionId)
    return entry === null ? null : entry.fold.page(before, count)
  }

  /**
   * The untruncated text behind one bounded inspector payload.
   * @param sessionId - the dsh session to read.
   * @param recordId - the owning record's stable id.
   * @param field - the payload's field name.
   * @returns the full text, or `null` when the fold did not retain it.
   */
  async trajectoryText(sessionId: string, recordId: string, field: string): Promise<string | null> {
    const entry = await this.foldFor(sessionId)
    return entry === null ? null : entry.fold.payload(recordId, field)
  }

  /**
   * The bytes behind one logged image reference.
   *
   * dsh logs a content-addressed reference and verifies the stored bytes
   * against it on read, so the whole reference is the argument — an id alone
   * could not be verified.
   * @param ref - the reference the projection carried.
   * @returns the media type and bytes, or `null` without an attachment store.
   */
  async trajectoryImage(ref: TrajectoryImageRef): Promise<{ mediaType: string; data: Uint8Array } | null> {
    // `get()` rather than the `ctx.attachments` property because the declaration
    // merge types that property as always-present, while a tree that mounted no
    // attachment store genuinely has none — the `| undefined` here is the honest
    // shape and is what keeps the null return below reachable.
    const attachments = this.bridge.get('attachments')
    if (!attachments) return null
    // `TrajectoryImageRef` is SuperOne's neutral, IPC-serializable mirror of the
    // dsh reference — `packages/shared` must not depend on dsh, so it carries a
    // plain `string` id and media type. This is the one seam where that mirror
    // re-enters dsh's branded domain, so the re-branding is explicit and local
    // rather than hidden behind an `unknown` parameter as it used to be. The
    // values themselves came from a dsh-produced reference in the first place,
    // and `readImage` re-verifies the stored bytes against the whole reference,
    // so a mismatch fails there rather than being trusted here.
    const stored = await attachments.readImage({
      ...ref,
      attachmentId: AttachmentId(ref.attachmentId),
      mediaType: ref.mediaType as ImageMediaType,
    })
    return { mediaType: ref.mediaType, data: stored.data }
  }

  /**
   * The open fold for one session, built or rebuilt as its source demands.
   *
   * The source itself is part of the cache key: a session that was closed when
   * first read and is live now has a different authoritative log, and folding
   * the live one onto state built from the transcript would double every
   * record the transcript already held.
   * @param sessionId - the dsh session to fold.
   * @returns the entry, or `null` when this session has no dsh log at all.
   */
  private async foldFor(sessionId: string): Promise<{ fold: TrajectoryFold; live: boolean } | null> {
    const sessions = this.bridge.get('sessions')
    const liveSession = sessions?.get(SessionId(sessionId))
    const live = liveSession !== undefined

    let entry = this.folds.get(sessionId)
    if (entry !== undefined && entry.live !== live) entry = undefined
    // A log shorter than what the fold has consumed is not the log the fold was
    // built from — a rollback rewrote it. Folding the remainder onto that state
    // would splice two histories together.
    if (entry !== undefined && liveSession !== undefined && liveSession.events.length < entry.fold.cursor) {
      entry = undefined
    }

    let events = liveSession?.events
    if (events === undefined) {
      const persistence = this.bridge.get('sessionPersistence')
      if (!persistence) throw new Error('deepseek trajectory: session persistence is not configured')

      // A SuperOne session exists from the moment the user opens it, but its
      // dsh session only exists once a turn has run. `list` omits a
      // created-but-never-appended session, so this separates "nothing has
      // happened yet" from "the log is there and unreadable" without matching
      // on a backend error string.
      if (entry === undefined) {
        const known = await persistence.list()
        if (!known.some((header) => String(header.id) === sessionId)) {
          this.folds.delete(sessionId)
          return null
        }
        events = (await persistence.load(SessionId(sessionId))).events
      } else {
        // A closed session's transcript does not grow under us, so the fold
        // built from it is already complete.
        events = undefined
      }
    }

    if (entry === undefined) {
      entry = { fold: new TrajectoryFold(sessionId), live }
      this.folds.set(sessionId, entry)
      // Bounded, in insertion order: the panel follows the session a user is
      // looking at, and an unbounded cache would retain every session's records
      // for the lifetime of the app.
      while (this.folds.size > TRAJECTORY_FOLD_CACHE) {
        const oldest = this.folds.keys().next().value
        if (oldest === undefined) break
        this.folds.delete(oldest)
      }
    }
    if (events !== undefined && events.length > entry.fold.cursor) {
      entry.fold.consume(events.slice(entry.fold.cursor))
    }
    return entry
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
    const sessions = this.bridge.get('sessions')
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

    const sessions = this.bridge.get('sessions')
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
    const presets = this.bridge.get('permissionPresets')
    if (!presets) return
    presets.set(record.agent.session, preset)
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
    // Typed straight off `CommandRuntime`: this is the call rc.8 broke by adding
    // a positional `images` parameter, and it stayed green only because the old
    // code re-declared `execute` locally. Bound to the upstream signature, the
    // same drift is now a compile error rather than a runtime `TypeError`.
    const commands = this.bridge.get('commands')
    if (!commands) throw new Error('deepseek compact: command registry is not mounted')

    const execution = await commands.execute(
      record.agent,
      '/compact',
      // SuperOne is text-only; the slot exists so the abort signal lands last.
      [],
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

  /**
   * Reconcile installed third-party plugins against `registry.json`.
   *
   * The single mutation path: installing, enabling, disabling, reconfiguring and
   * removing all reduce to "write the registry, then call this". Because
   * mounting rides `ctx.loader`, the reconcile reaches the *running* tree — an
   * install does not wait for a restart.
   * @returns what each enabled row produced.
   */
  async syncPlugins(): Promise<MountReport> {
    const report = await this.plugins.sync()
    this.onPluginMount?.(report)
    return report
  }

  async dispose(): Promise<void> {
    this.folds.clear()
    for (const [sessionId, record] of [...this.records]) {
      this.records.delete(sessionId)
      await record.dispose()
    }
    await this.mcpServers.dispose()
    await this.plugins.dispose()
    // The root FIBER, not a `stop()` on the context. Cordis exposes teardown as
    // `Fiber.dispose()`; nothing in the pinned tree ever mixes a `stop` onto a
    // context. The previous `(root as Context & { stop?() }).stop?.()` therefore
    // never called anything — the hand-written optional member made a method
    // that does not exist look deliberate, and `?.` swallowed the miss — so the
    // embedded tree outlived every `dispose()`. Verified by probing the real
    // tree root: `typeof root.stop === 'undefined'`, while `root.fiber.dispose`
    // is a function that settles.
    await this.root.fiber.dispose()
  }
}
