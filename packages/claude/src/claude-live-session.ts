/**
 * Long-lived Claude Agent SDK session (desktop MessageBridge parity).
 *
 * One `query({ prompt: bridge })` stays open; each user turn is `bridge.push()`.
 * Messages arriving while a turn is in-flight are queued with `priority: 'next'`
 * and flushed when the current result arrives — same as ClaudeBackend.
 */

import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { query as sdkQuery, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { SessionTurnEvent } from '@superone/shared/environment'
import { MessageBridge } from './message-bridge'
import { createClaudeAgentEventMapper } from './agent-event-mapper'
import { applySdkMessage, createSdkMapState } from './map-sdk-message'
import { resolveSdkClaudeBinary } from './resolve-sdk-binary'
import { applyRootPermissionGuard } from './root-permission-guard'
import type {
  ClaudePermissionHandler,
  ClaudePlanHandler,
  ClaudeQuestionHandler,
  ClaudeQueryFn,
  ClaudeSdkTurnResult,
  RunClaudeSdkTurnOptions,
} from './types'
import { SUPERONE_SYSTEM_PROMPT_APPEND } from '@superone/shared/superone-system-prompt'
import { isStaticHostOwnedSuperoneToolQualified } from '@superone/shared/superone-host-owned-tools'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'

export interface ClaudeLiveTurnInput {
  /** User text or prebuilt multimodal content blocks. */
  content: string | Array<Record<string, unknown>>
  messageId?: string
  clientMessageId?: string
  /** When true (default if a turn is active), use SDK priority next. */
  priorityNext?: boolean
  onDelta?: (text: string) => void
  onEvent?: (event: SessionTurnEvent) => void
  onAgentEvent?: (event: AgentEvent) => void
  onPermission?: ClaudePermissionHandler
  onQuestion?: ClaudeQuestionHandler
  onPlan?: ClaudePlanHandler
  signal?: AbortSignal
}

export interface ClaudeLiveSessionOptions {
  cwd: string
  binaryPath?: string | null
  /** Initial resume id (prior claude-session). */
  sessionId?: string | null
  /**
   * Truncating resume (`Options.resumeSessionAt`). When set, also pass
   * `resumeDropsTurn` (prompt UUID of the discarded turn).
   */
  resumeSessionAt?: string
  /**
   * With `resumeSessionAt`: UUID of the turn this truncating resume discards.
   * On refusal (`Resume rejected by --resume-drops-turn:`), clear fork target
   * and full-resume only — never retry the same args.
   */
  resumeDropsTurn?: string
  model?: string
  effort?: string
  permissionMode?: string
  /**
   * Effective uid of the harness process for the root permission guard.
   * Defaults to `process.getuid?.()`; callers that spawn as another user (or
   * tests) can state it explicitly.
   */
  uid?: number | null
  /**
   * SuperOne sandbox mode (`off` | `on` | `auto`).
   * Mapped to Agent SDK `sandbox` (enabled + autoAllowBashIfSandboxed).
   */
  sandboxMode?: string
  additionalDirectories?: string[]
  enabledSkills?: string[]
  env?: NodeJS.ProcessEnv
  systemPromptAppend?: string
  options?: Partial<Options>
  queryFn?: ClaudeQueryFn
}

interface PendingTurn {
  tag: string
  msg: SDKUserMessage
  input: ClaudeLiveTurnInput
  resolve: (r: ClaudeSdkTurnResult) => void
  reject: (e: unknown) => void
}

interface ActiveTurn {
  tag: string
  messageId: string
  input: ClaudeLiveTurnInput
  resolve: (r: ClaudeSdkTurnResult) => void
  reject: (e: unknown) => void
  streamedText: string
  finalText: string
  sawResult: boolean
  resultError: string | null
  cancelled?: boolean
}

/**
 * Build SDK options shared with runClaudeSdkTurn (permissionMode, effort, skills, …).
 */
function buildLiveOptions(
  opts: ClaudeLiveSessionOptions,
  onPermission: ClaudePermissionHandler | undefined,
  onQuestion: ClaudeQuestionHandler | undefined,
  onPlan: ClaudePlanHandler | undefined,
  signal: AbortSignal,
  timing: { pausedMs: number },
): Options {
  const abortController = new AbortController()
  if (signal.aborted) abortController.abort()
  else signal.addEventListener('abort', () => abortController.abort(), { once: true })

  const canUseTool: CanUseTool = async (toolName, input, toolOpts) => {
    if (signal.aborted || toolOpts.signal.aborted) {
      return { behavior: 'deny', message: 'Permission aborted' }
    }
    if (isStaticHostOwnedSuperoneToolQualified(toolName)) {
      return { behavior: 'allow' }
    }
    const interactionId =
      (typeof toolOpts.requestId === 'string' && toolOpts.requestId) ||
      (typeof toolOpts.toolUseID === 'string' && toolOpts.toolUseID) ||
      `interaction_${Date.now()}`
    if (toolName === 'AskUserQuestion') {
      if (!onQuestion) {
        return { behavior: 'deny', message: 'Question denied by SuperOne node (no question handler)' }
      }
      const answer = await onQuestion({
        interactionId,
        kind: 'question',
        toolName,
        toolUseId: typeof toolOpts.toolUseID === 'string' ? toolOpts.toolUseID : undefined,
        input: input && typeof input === 'object' ? (input as Record<string, unknown>) : undefined,
      })
      const record = answer && typeof answer === 'object' ? (answer as Record<string, unknown>) : null
      const answers = record && 'answers' in record ? record.answers : answer
      return {
        behavior: 'allow',
        updatedInput: {
          ...(input && typeof input === 'object' ? input : {}),
          answers,
          ...(record && record.annotations !== undefined ? { annotations: record.annotations } : {}),
        },
      }
    }
    if (toolName === 'ExitPlanMode') {
      if (!onPlan) {
        return { behavior: 'deny', message: 'Plan denied by SuperOne node (no plan handler)' }
      }
      const result = await onPlan({
        interactionId,
        kind: 'plan',
        toolName,
        toolUseId: typeof toolOpts.toolUseID === 'string' ? toolOpts.toolUseID : undefined,
        input: input && typeof input === 'object' ? (input as Record<string, unknown>) : undefined,
      })
      if (result.decision === 'approve') return { behavior: 'allow', updatedInput: input }
      const feedback = result.options?.feedback
      return {
        behavior: 'deny',
        message: typeof feedback === 'string' && feedback ? feedback : 'User rejected the plan',
      }
    }
    if (!onPermission) {
      return { behavior: 'deny', message: 'Permission denied by SuperOne node (no permission handler)' }
    }
    const startedAt = Date.now()
    const decision = await onPermission({
      interactionId,
      toolName,
      toolUseId: typeof toolOpts.toolUseID === 'string' ? toolOpts.toolUseID : undefined,
      input: input && typeof input === 'object' ? (input as Record<string, unknown>) : undefined,
    }).finally(() => {
      timing.pausedMs += Date.now() - startedAt
    })
    if (decision === 'allow') return { behavior: 'allow' }
    return { behavior: 'deny', message: 'Permission denied by SuperOne node' }
  }

  const binaryPath =
    (opts.binaryPath && existsSync(opts.binaryPath) ? opts.binaryPath : null) ??
    resolveSdkClaudeBinary() ??
    undefined

  const effort =
    opts.effort === 'low' ||
    opts.effort === 'medium' ||
    opts.effort === 'high' ||
    opts.effort === 'xhigh' ||
    opts.effort === 'max'
      ? opts.effort
      : undefined

  const env = opts.env
    ? ({ ...process.env, ...opts.env } as Record<string, string | undefined>)
    : undefined

  const sandbox =
    opts.sandboxMode === 'on' || opts.sandboxMode === 'auto'
      ? {
          enabled: true as const,
          autoAllowBashIfSandboxed: opts.sandboxMode === 'auto',
          failIfUnavailable: false as const,
        }
      : undefined

  // Under root the SDK process refuses to start with permission-skipping
  // options; relax them so the turn runs instead of exiting during spawn.
  const permissions = applyRootPermissionGuard({
    permissionMode: opts.permissionMode,
    uid: opts.uid === undefined ? process.getuid?.() : opts.uid,
    env: env ?? (process.env as Record<string, string | undefined>),
  })

  const base: Options = {
    cwd: opts.cwd,
    ...(binaryPath ? { pathToClaudeCodeExecutable: binaryPath } : {}),
    model: opts.model,
    ...(effort ? { effort } : {}),
    includePartialMessages: true,
    thinking: { type: 'adaptive', display: 'summarized' },
    promptSuggestions: true,
    forwardSubagentText: true,
    enableFileCheckpointing: true,
    agentProgressSummaries: true,
    extraArgs: { 'replay-user-messages': null },
    permissionMode: (permissions.permissionMode as Options['permissionMode']) || 'default',
    allowDangerouslySkipPermissions: permissions.allowDangerouslySkipPermissions,
    canUseTool,
    abortController,
    settingSources: ['user', 'project', 'local'],
    ...(sandbox ? { sandbox } : {}),
    ...(opts.additionalDirectories && opts.additionalDirectories.length > 0
      ? { additionalDirectories: opts.additionalDirectories }
      : {}),
    ...(opts.enabledSkills && opts.enabledSkills.length > 0
      ? { skills: opts.enabledSkills }
      : {}),
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: [SUPERONE_SYSTEM_PROMPT_APPEND, opts.systemPromptAppend]
        .filter(Boolean)
        .join('\n\n'),
    },
    ...(opts.sessionId ? { resume: opts.sessionId } : {}),
    ...(opts.resumeSessionAt ? { resumeSessionAt: opts.resumeSessionAt } : {}),
    ...(opts.resumeDropsTurn ? { resumeDropsTurn: opts.resumeDropsTurn } : {}),
    ...(env ? { env } : {}),
  }

  return {
    ...base,
    ...(opts.options ?? {}),
    canUseTool: opts.options?.canUseTool ?? base.canUseTool,
    abortController: opts.options?.abortController ?? base.abortController,
  }
}

function toUserMessage(
  content: string | Array<Record<string, unknown>>,
  sessionId: string,
  priorityNext: boolean,
): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: content as never },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: sessionId,
    ...(priorityNext ? { priority: 'next' as const } : {}),
  } as SDKUserMessage
}

export class ClaudeLiveSession {
  private readonly bridge = new MessageBridge()
  private readonly pending: PendingTurn[] = []
  private active: ActiveTurn | null = null
  private sdkSessionId: string | null
  private closed = false
  private readonly iterationDone: Promise<void>
  private readonly processAbort = new AbortController()
  /** Latest permission handler from the active turn (desktop swaps per send). */
  private permissionHandler: ClaudePermissionHandler | undefined
  private questionHandler: ClaudeQuestionHandler | undefined
  private planHandler: ClaudePlanHandler | undefined
  private readonly timing = { pausedMs: 0 }

  private constructor(
    private readonly opts: ClaudeLiveSessionOptions,
    queryFn: ClaudeQueryFn,
  ) {
    this.sdkSessionId = opts.sessionId ?? null
    // Permission is re-bound per turn; start with deny-closed until first send.
    const options = buildLiveOptions(
      opts,
      (req) => {
        if (!this.permissionHandler) {
          return Promise.resolve('deny' as const)
        }
        return this.permissionHandler(req)
      },
      (req) => {
        if (!this.questionHandler) return Promise.reject(new Error('question handler unavailable'))
        return this.questionHandler(req)
      },
      (req) => {
        if (!this.planHandler) return Promise.reject(new Error('plan handler unavailable'))
        return this.planHandler(req)
      },
      this.processAbort.signal,
      this.timing,
    )
    const q = queryFn({ prompt: this.bridge, options })
    this.iterationDone = this.iterate(q)
  }

  static open(opts: ClaudeLiveSessionOptions): ClaudeLiveSession {
    const binary =
      (opts.binaryPath && existsSync(opts.binaryPath) ? opts.binaryPath : null) ??
      resolveSdkClaudeBinary()
    if (opts.binaryPath && !existsSync(opts.binaryPath)) {
      throw new Error(`Claude binary not found: ${opts.binaryPath}`)
    }
    if (!binary && !opts.queryFn) {
      throw new Error(
        'Claude Agent SDK binary not found: reinstall platform package or set SUPERONE_CLAUDE_BINARY',
      )
    }
    const queryFn = opts.queryFn ?? sdkQuery
    return new ClaudeLiveSession(opts, queryFn)
  }

  get sessionId(): string | null {
    return this.sdkSessionId
  }

  get isBusy(): boolean {
    return this.active != null
  }

  /**
   * Send one user turn on the long-lived query.
   * If a turn is already running, the message is queued with priority next and
   * starts after the current result (desktop ClaudeBackend parity).
   */
  sendTurn(input: ClaudeLiveTurnInput): Promise<ClaudeSdkTurnResult> {
    if (this.closed) {
      return Promise.reject(new Error('Claude live session is closed'))
    }
    const tag = input.clientMessageId || randomUUID()
    const sessionId = this.sdkSessionId || ''
    const priorityNext = input.priorityNext !== false && this.active != null
    const msg = toUserMessage(input.content, sessionId, priorityNext)

    return new Promise<ClaudeSdkTurnResult>((resolve, reject) => {
      if (input.signal?.aborted) {
        reject(new Error('Claude turn interrupted'))
        return
      }
      const onAbort = () => {
        // Soft: process abort is reserved for dispose; per-turn abort rejects waiter.
        if (this.active?.tag === tag) {
          // The SDK query is shared by all turns. Keep consuming the cancelled
          // turn until its result arrives; otherwise its late output would be
          // attributed to the next queued turn.
          if (!this.active.cancelled) {
            this.active.cancelled = true
            this.active.reject(new Error('Claude turn interrupted'))
          }
        } else {
          const idx = this.pending.findIndex((p) => p.tag === tag)
          if (idx >= 0) {
            const [item] = this.pending.splice(idx, 1)
            item?.reject(new Error('Claude turn interrupted'))
          }
        }
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })

      if (this.active) {
        this.pending.push({ tag, msg, input, resolve, reject })
        return
      }
      this.startTurn({ tag, msg, input, resolve, reject })
    })
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.splice(0)) {
      p.reject(new Error('Claude live session disposed'))
    }
    if (this.active) {
      this.active.reject(new Error('Claude live session disposed'))
      this.active = null
    }
    this.bridge.close()
    this.processAbort.abort()
    await this.iterationDone.catch(() => undefined)
  }

  private startTurn(item: PendingTurn): void {
    const messageId = item.input.messageId || `assistant-${item.tag}`
    this.permissionHandler = item.input.onPermission
    this.questionHandler = item.input.onQuestion
    this.planHandler = item.input.onPlan
    this.active = {
      tag: item.tag,
      messageId,
      input: item.input,
      resolve: item.resolve,
      reject: item.reject,
      streamedText: '',
      finalText: '',
      sawResult: false,
      resultError: null,
    }
    // Rebuild message session_id if we learned it after open.
    if (this.sdkSessionId && item.msg.session_id !== this.sdkSessionId) {
      item.msg = { ...item.msg, session_id: this.sdkSessionId }
    }
    this.bridge.push(item.msg, item.tag)
  }

  private flushPending(): void {
    if (this.active || this.closed) return
    const next = this.pending.shift()
    if (!next) return
    this.startTurn(next)
  }

  private completeActive(ok: boolean): void {
    const cur = this.active
    if (!cur) return
    this.active = null
    this.permissionHandler = undefined
    this.questionHandler = undefined
    this.planHandler = undefined
    if (!ok) {
      cur.reject(new Error(cur.resultError || 'Claude turn failed'))
    } else {
      const finalText = cur.finalText || cur.streamedText
      cur.resolve({
        finalText,
        sessionId: this.sdkSessionId,
      })
    }
    this.flushPending()
  }

  private async iterate(q: AsyncIterable<SDKMessage>): Promise<void> {
    try {
      for await (const msg of q) {
        if (this.closed) break
        const cur = this.active
        if (!cur) continue

        if (cur.cancelled) {
          // Drain the SDK's current turn before allowing the next bridge
          // message to become active. A shared query cannot safely switch
          // ownership in the middle of a result stream.
          if (msg.type === 'result') {
            this.active = null
            this.permissionHandler = undefined
            this.questionHandler = undefined
            this.planHandler = undefined
            this.flushPending()
          }
          continue
        }

        const useAgentEvents = typeof cur.input.onAgentEvent === 'function'
        const useOnEvent = typeof cur.input.onEvent === 'function' && !useAgentEvents

        // Per-turn mappers (message id may change each turn).
        if (!(cur as ActiveTurn & { _mapper?: ReturnType<typeof createClaudeAgentEventMapper> })._mapper) {
          const holder = cur as ActiveTurn & {
            _mapper?: ReturnType<typeof createClaudeAgentEventMapper>
            _state?: ReturnType<typeof createSdkMapState>
          }
          if (useAgentEvents) {
            holder._mapper = createClaudeAgentEventMapper({
              messageId: cur.messageId,
              emit: cur.input.onAgentEvent!,
              startedAt: Date.now(),
              pausedMs: () => this.timing.pausedMs,
              isInterrupted: () => cur.input.signal?.aborted === true,
            })
          } else {
            holder._state = createSdkMapState(cur.messageId)
          }
        }

        const holder = cur as ActiveTurn & {
          _mapper?: ReturnType<typeof createClaudeAgentEventMapper>
          _state?: ReturnType<typeof createSdkMapState>
        }

        const applied = holder._mapper
          ? holder._mapper.apply(msg)
          : applySdkMessage(msg, holder._state!, (ev) => cur.input.onEvent?.(ev))

        if (applied.sessionId) this.sdkSessionId = applied.sessionId
        if (applied.textDelta) {
          cur.streamedText += applied.textDelta
          if (!useAgentEvents) {
            if (useOnEvent) {
              cur.input.onEvent?.({
                kind: 'text',
                blockId: cur.messageId,
                delta: applied.textDelta,
              })
            } else {
              cur.input.onDelta?.(applied.textDelta)
            }
          }
        }

        if (applied.isResult) {
          cur.sawResult = true
          if (applied.resultIsError) {
            cur.resultError = applied.resultError || 'Claude turn failed'
            this.completeActive(false)
          } else {
            cur.finalText =
              applied.resultText ??
              (cur.streamedText.length > 0 ? cur.streamedText : cur.finalText)
            this.completeActive(true)
          }
        }
      }
    } catch (err) {
      if (this.active) {
        if (!this.active.cancelled) {
          this.active.reject(err instanceof Error ? err : new Error(String(err)))
        }
        this.active = null
      }
      for (const p of this.pending.splice(0)) {
        p.reject(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      this.closed = true
      this.bridge.close()
    }
  }
}

/** Test helper: open a live session with injectable query (no real binary). */
export function openClaudeLiveSessionForTests(
  opts: ClaudeLiveSessionOptions & { queryFn: ClaudeQueryFn },
): ClaudeLiveSession {
  return ClaudeLiveSession.open(opts)
}
