import { query, type CanUseTool, type HookCallback, type OnElicitation, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, MessageMetadata, PermissionMode, QuestionPreviewFormat, SandboxInfo, SendMessageRequest } from '@superone/shared/agent-types'
import {
  isResumeDropsTurnRefusal,
  RESUME_DROPS_TURN_REFUSAL_PREFIX,
} from '@superone/claude'
import type { MessageBridge } from './message-bridge'
import log from '../logger'
import { trace } from './event-trace'
import { createSuperoneMcpServer } from '../mcp/superone-mcp-server'
import type { WarmupManager } from './warmup-manager'
import { resolveSdkClaudeBinary } from './claude-binary'
import { makeClaudeSpawn } from './claude-spawn'
import { getSandboxCapability } from '../sandbox-platform'
import { recordClaudeStepDeltas, modelUsageInfoToDelta, subtractDelta, type UsageStepDelta } from '../usage-stats-service'
import { SUPERONE_SYSTEM_PROMPT_APPEND } from './superone-system-prompt'
import { persistAttachment, buildAttachmentPathNote } from './attachment-store'

export { isResumeDropsTurnRefusal, RESUME_DROPS_TURN_REFUSAL_PREFIX }

export interface SessionQueryOptions {
  /** SuperOne session id (Session class) — distinct from SDK sessionId (resume) */
  superoneSessionId: string
  projectPath: string
  cwd: string
  model?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  permissionMode: PermissionMode
  sandboxInfo?: SandboxInfo
  canUseTool?: CanUseTool
  onElicitation?: OnElicitation
  trackPlanFile?: (filePath: string) => void
  resume?: string
  resumeSessionAt?: string
  /**
   * With `resumeSessionAt`: UUID of the turn this truncating resume discards.
   * Production paths that set `resumeSessionAt` MUST also set this. On refusal
   * (`Resume rejected by --resume-drops-turn:`), clear the fork target and
   * full-resume only — never retry the same args.
   */
  resumeDropsTurn?: string
  forkSession?: boolean
  sessionId?: string
  abortController?: AbortController
  additionalDirectories?: string[]
  env?: Record<string, string | undefined>
  taskBudget?: number
  warmupManager?: WarmupManager
  enabledSkills?: string[]
  askUserQuestionPreviewFormat?: QuestionPreviewFormat
  systemPromptAppend?: string
}

export const denySubagentSessionRename: HookCallback = async (input) => {
  if (
    input.hook_event_name === 'PreToolUse' &&
    input.tool_name === 'mcp__superone__session_rename' &&
    input.agent_id
  ) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'session_rename is main-thread only. You are running inside a subagent (Task/Agent worker) and must not rename the user-facing session title.',
      },
    }
  }
  return {}
}

export function buildClaudeOptions(opts: SessionQueryOptions): Options {
  return {
    cwd: opts.cwd,
    pathToClaudeCodeExecutable: resolveSdkClaudeBinary(),
    model: opts.model,
    effort: opts.effort,
    thinking: { type: 'adaptive', display: 'summarized' },
    promptSuggestions: true,
    includePartialMessages: true,
    forwardSubagentText: true,
    permissionMode: opts.permissionMode,
    allowDangerouslySkipPermissions: true,
    canUseTool: opts.canUseTool,
    onElicitation: opts.onElicitation,
    sandbox: opts.sandboxInfo?.enabled && getSandboxCapability().supportLevel !== 'unsupported'
      ? { enabled: true, autoAllowBashIfSandboxed: opts.sandboxInfo.autoAllowBash, failIfUnavailable: false }
      : undefined,
    enableFileCheckpointing: true,
    agentProgressSummaries: true,
    taskBudget: opts.taskBudget ? { total: opts.taskBudget } : undefined,
    extraArgs: { 'replay-user-messages': null },
    settingSources: ['user', 'project', 'local'],
    resume: opts.resume,
    resumeSessionAt: opts.resumeSessionAt,
    resumeDropsTurn: opts.resumeDropsTurn,
    forkSession: opts.forkSession,
    sessionId: opts.sessionId,
    abortController: opts.abortController,
    additionalDirectories: opts.additionalDirectories,
    env: opts.env,
    spawnClaudeCodeProcess: makeClaudeSpawn({
      onStderr: (data) => {
        log.warn('[claude-cli]', data.trimEnd())
        if (data.includes('FileHistory') || data.includes('checkpoint') || data.includes('file_history')) {
          log.info('[claude-cli][checkpoint-stderr] %s', data.trimEnd())
        }
      },
    }),
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: [SUPERONE_SYSTEM_PROMPT_APPEND, opts.systemPromptAppend].filter(Boolean).join('\n\n'),
    },
    hooks: { PreToolUse: [{ hooks: [denySubagentSessionRename] }] },
    mcpServers: { 'superone': createSuperoneMcpServer(opts.superoneSessionId, opts.projectPath) },
    ...(opts.enabledSkills ? { skills: opts.enabledSkills } : {}),
    ...(opts.askUserQuestionPreviewFormat
      ? { toolConfig: { askUserQuestion: { previewFormat: opts.askUserQuestionPreviewFormat } } }
      : {}),
  }
}

export interface BackgroundTaskInfo {
  toolUseId?: string
  description: string
}

export interface SessionQueryHandle {
  query: Query
  iterationDone: Promise<void>
  spawnAbortController: AbortController
  activeBackgroundTasks: Map<string, BackgroundTaskInfo>
}

export function createSessionQuery(
  bridge: MessageBridge,
  options: SessionQueryOptions,
  emit: (event: AgentEvent) => void,
  getCurrentMessageId: () => string,
  getCurrentStartTime: () => number,
  getInterrupted: () => boolean,
  onSessionId?: (id: string) => void,
  onQueuedTurnStart?: (messageId: string) => void,
  onStepBoundary?: () => void,
): SessionQueryHandle {
  const timing = { pausedMs: 0 }
  const originalCanUseTool = options.canUseTool
  const timedCanUseTool: CanUseTool | undefined = originalCanUseTool
    ? async (...args) => {
        const start = Date.now()
        const result = await originalCanUseTool(...args)
        timing.pausedMs += Date.now() - start
        return result
      }
    : undefined

  log.info('[claude-query] createSessionQuery env=%s model=%s cwd=%s resume=%s enableFileCheckpointing=true', options.env ? Object.keys(options.env).join(',') : 'none', options.model ?? 'default', options.cwd, options.resume ?? 'none')
  log.info('[claude-query] env CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=%s CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING=%s', process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING ?? 'unset', process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING ?? 'unset')
  trace('provider.query', 'create_session', { envKeys: options.env ? Object.keys(options.env) : null, model: options.model, resume: options.resume })

  const sdkOptions = buildClaudeOptions({ ...options, canUseTool: timedCanUseTool })

  let q: Query
  let spawnAbortController: AbortController
  const warm = options.warmupManager?.consume(sdkOptions)
  if (warm) {
    log.info('[claude-query] using prewarmed subprocess')
    q = warm.warm.query(bridge)
    spawnAbortController = warm.abortController
  } else {
    spawnAbortController = sdkOptions.abortController ?? new AbortController()
    if (!sdkOptions.abortController) sdkOptions.abortController = spawnAbortController
    q = query({ prompt: bridge, options: sdkOptions })
  }

  const activeBackgroundTasks = new Map<string, BackgroundTaskInfo>()
  const iterationDone = iterateMessages(q, {
    emit,
    getCurrentMessageId,
    getCurrentStartTime,
    getInterrupted,
    superoneSessionId: options.superoneSessionId,
    onSessionId,
    trackPlanFile: options.trackPlanFile,
    onQueuedTurnStart,
    onStepBoundary,
    bridge,
    timing,
    activeBackgroundTasks,
  })

  return { query: q, iterationDone, spawnAbortController, activeBackgroundTasks }
}

export function buildUserMessage(request: SendMessageRequest, sessionId: string): SDKUserMessage {
  let content: unknown

  if (request.images?.length) {
    const saved = request.images.map((att) => ({
      name: att.name,
      path: persistAttachment(att.base64, att.mimeType),
    }))
    if (saved.every((entry) => entry.path)) {
      // Hand the agent file paths instead of inline bytes so it Reads them only
      // when needed, and can pass them to file-path tools (e.g. image editing).
      const note = buildAttachmentPathNote(saved as Array<{ name: string; path: string }>)
      content = request.content.trim() ? `${request.content}\n\n${note}` : note
    } else {
      // Persisting to disk failed — fall back to inline base64 so the upload is
      // never lost.
      const blocks: Array<Record<string, unknown>> = request.images.map((att) => ({
        type: att.mimeType === 'application/pdf' ? 'document' : 'image',
        source: { type: 'base64', media_type: att.mimeType, data: att.base64 },
      }))
      if (request.content.trim()) blocks.push({ type: 'text', text: request.content })
      content = blocks
    }
  } else {
    content = request.content
  }

  const msg = {
    type: 'user' as const,
    message: { role: 'user' as const, content },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: sessionId,
    ...(request.priority ? { priority: request.priority } : {}),
  } as SDKUserMessage
  trace('agent.sdk', 'user_send', { content })
  return msg
}

export interface IterateMessagesOptions {
  emit: (event: AgentEvent) => void
  getCurrentMessageId: () => string
  getCurrentStartTime: () => number
  getInterrupted: () => boolean
  superoneSessionId: string
  onSessionId?: (id: string) => void
  trackPlanFile?: (filePath: string) => void
  onQueuedTurnStart?: (messageId: string) => void
  onStepBoundary?: () => void
  bridge: MessageBridge
  timing: { pausedMs: number }
  activeBackgroundTasks?: Map<string, BackgroundTaskInfo>
}

export async function iterateMessages(q: Query, opts: IterateMessagesOptions): Promise<void> {
  const { emit: rawEmit, getCurrentMessageId, getCurrentStartTime, getInterrupted, onSessionId, trackPlanFile, onQueuedTurnStart, onStepBoundary, bridge, timing } = opts
  const emit = rawEmit
  // Track content_block index → tool_use_id for input_json_delta correlation
  const activeToolBlocks = new Map<number, string>()
  // Track tool_use_id → tool_name so we can tag tool_result events
  const toolIdToName = new Map<string, string>()
  // Track the last assistant message's usage (= current context window snapshot)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastAssistantUsage: any = null
  // Track the most recent top-level assistant message UUID for resumeSessionAt
  let lastTopLevelAssistantUuid = ''
  // Last replay user message UUID — SDK creates file-history snapshots for replay UUIDs only
  let lastReplayCheckpointId = ''
  let lastAssistantTypedError: string | undefined
  let pendingSlashOutput = ''
  // Per-step dedup: track processed step IDs (SDK message IDs) and latest step tokens
  const processedStepIds = new Set<string>()
  let messageInputTokens = 0
  let messageOutputTokens = 0
  let lastTrackedMessageId = ''
  // Subagent token accumulation per parent_tool_use_id
  const subagentTracking = new Map<string, { stepIds: Set<string>; input: number; output: number }>()
  // Per-model usage snapshot: SDK's result.modelUsage is cumulative across the
  // streaming query's lifetime. Diff against the prior snapshot to get the
  // step delta to record into usage_daily.
  const usageSnapshotByModel = new Map<string, UsageStepDelta>()

  let turnMessageId = getCurrentMessageId()
  let turnActive = false
  let resultSeen = false
  let turnUserEchoSeen = false
  const timestampAppliedIds = new Set<string>()

  const activeBackgroundTasks = opts.activeBackgroundTasks ?? new Map<string, BackgroundTaskInfo>()

  const resolveSdkTimestamp = (raw: unknown): string | undefined => {
    const ts = (raw as { timestamp?: unknown } | null | undefined)?.timestamp
    return typeof ts === 'string' && ts.length > 0 ? ts : undefined
  }

  const seedMessageTimestamp = (targetMessageId: string, raw: unknown): void => {
    if (!targetMessageId || timestampAppliedIds.has(targetMessageId)) return
    const timestamp = resolveSdkTimestamp(raw)
    if (!timestamp) return
    timestampAppliedIds.add(targetMessageId)
    emit({ type: 'message_timestamp', messageId: targetMessageId, timestamp })
  }

  const resolveCreatedAt = (raw: unknown): string =>
    resolveSdkTimestamp(raw) ?? new Date().toISOString()
  const maybeEmitDeferredIdle = () => {
    if (resultSeen && activeBackgroundTasks.size === 0 && turnMessageId === getCurrentMessageId()) {
      emit({ type: 'status_change', status: 'idle' })
    }
  }

  log.debug('[iterateMessages] starting iteration loop')
  try {
    for await (const msg of q) {
      let messageId = turnMessageId

      if (getInterrupted() && msg.type !== 'result') {
        trace('agent.sdk', `${msg.type}_ignored_after_interrupt`, msg, messageId)
        continue
      }

      if (!turnActive) {
        const latestId = getCurrentMessageId()
        if (latestId && latestId !== turnMessageId) {
          turnMessageId = latestId
          messageId = turnMessageId
          resultSeen = false
          turnUserEchoSeen = false
        }
      }

      if ((msg.type === 'assistant' || msg.type === 'stream_event')) {
        const parent = (msg as any).parent_tool_use_id ?? null
        if (!parent) {
          if (resultSeen) {
            const queuedMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            turnMessageId = queuedMessageId
            onQueuedTurnStart?.(queuedMessageId)
            if (bridge.consumedTags.length > 0) bridge.drainConsumedTag()
            const createdAt = resolveCreatedAt(msg)
            emit({ type: 'message_start', message: {
              id: queuedMessageId,
              role: 'assistant',
              status: 'streaming',
              content: [],
              createdAt,
              providerId: 'claude',
            } })
            if (resolveSdkTimestamp(msg)) timestampAppliedIds.add(queuedMessageId)
            emit({ type: 'status_change', status: 'streaming' })
            resultSeen = false
            turnActive = true
          }
          const latestId = getCurrentMessageId()
          if (!turnActive || latestId !== turnMessageId) {
            turnMessageId = latestId
            turnActive = true
          }
          messageId = turnMessageId
        }
      }

      trace('agent.sdk', msg.type, msg, messageId)

      // User messages carry tool results and slash command output
      if (msg.type === 'user') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userMsg = msg as any
        const parentToolUseId = userMsg.parent_tool_use_id ?? null
        const isSynthetic = userMsg.isSynthetic === true ? true : undefined
        const isReplay = userMsg.isReplay === true ? true : undefined
        const msgContent = userMsg.message?.content

        if (!parentToolUseId && typeof msgContent === 'string') {
          if (!turnUserEchoSeen) {
            turnUserEchoSeen = true
          } else if (bridge.consumedTags.length > 0) {
            emit({ type: 'message_complete', messageId: turnMessageId, metadata: {} })
            bridge.drainConsumedTag()
            const queuedMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            turnMessageId = queuedMessageId
            messageId = queuedMessageId
            onQueuedTurnStart?.(queuedMessageId)
            const createdAt = resolveCreatedAt(userMsg)
            emit({ type: 'message_start', message: {
              id: queuedMessageId,
              role: 'assistant',
              status: 'streaming',
              content: [],
              createdAt,
              providerId: 'claude',
            } })
            if (resolveSdkTimestamp(userMsg)) timestampAppliedIds.add(queuedMessageId)
            emit({ type: 'status_change', status: 'streaming' })
            turnActive = true
          }
        }

        // Extract tool_result blocks from array content
        if (Array.isArray(msgContent)) {
          let hasToolResult = false
          for (const block of msgContent) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              hasToolResult = true
              const toolName = toolIdToName.get(block.tool_use_id)
              const text = extractToolResultText(block.content)
              const isBash = toolName === 'Bash'
              const outputPath = isBash ? extractBashOutputPath(text) : undefined
              const isTimedOut = isBash ? extractBashKilled(userMsg.tool_use_result) : undefined
              const taskCreateTodo = extractTaskCreateTodo(toolName, userMsg.tool_use_result, text)
              // Bash: CLI sets is_error for non-zero exits too; only <tool_use_error>
              // marks a true tool-layer failure (validation, blocked, cancelled, …).
              const isError = isToolLayerError(toolName, block.is_error === true, text)
              emit({
                type: 'content_delta',
                messageId,
                delta: {
                  type: 'tool_result',
                  toolUseId: block.tool_use_id,
                  summary: text || '',
                  ...(outputPath ? { outputPath } : {}),
                  ...(isTimedOut ? { isTimedOut } : {}),
                  ...(isError ? { isError: true } : {}),
                  ...(taskCreateTodo ?? {}),
                  parentToolUseId,
                },
                isSynthetic,
                isReplay,
              })
            }
          }
          if (hasToolResult && !parentToolUseId) onStepBoundary?.()
        }

        const raw = typeof msgContent === 'string' ? msgContent : ''
        if (!isReplay && raw.includes('<local-command-stdout>')) {
          const text = raw
            .replace(/<local-command-stdout>\n?/g, '')
            .replace(/<\/local-command-stdout>\n?/g, '')
            .trim()
          if (text) {
            emit({ type: 'slash_command_output', messageId, content: text })
          }
        }

        // SDK file-history snapshots are keyed by replay UUIDs, not new message UUIDs.
        // Use getCurrentMessageId() because user echo may arrive before sendMessage updates messageId.
        const uuid = userMsg.uuid as string | undefined
        log.info('[checkpoint] user msg: uuid=%s parent=%s isReplay=%s isSynthetic=%s', uuid ?? 'none', userMsg.parent_tool_use_id ?? 'none', userMsg.isReplay ?? false, userMsg.isSynthetic ?? false)
        if (uuid && !userMsg.parent_tool_use_id) {
          if (userMsg.isReplay) {
            lastReplayCheckpointId = uuid
          } else {
            const checkpointId = lastReplayCheckpointId || uuid
            const latestMessageId = getCurrentMessageId() || messageId
            log.info('[checkpoint] captured: checkpointId=%s resumePointId=%s messageId=%s', checkpointId, lastTopLevelAssistantUuid, latestMessageId)
            emit({ type: 'checkpoint_captured', messageId: latestMessageId, checkpointId, resumePointId: lastTopLevelAssistantUuid })
          }
        }
      }

      switch (msg.type) {
        case 'system': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sys = msg as any
          log.debug(`[iterateMessages] system message subtype=${sys.subtype} session_id=${sys.session_id ?? '(none)'}`)
          if (sys.subtype === 'init') {
            const mcpNames = (sys.mcp_servers ?? []).map((s: any) => `${s.name}(${s.status})`).join(', ')
            const widgetTools = (sys.tools ?? []).filter((t: string) => t.startsWith('mcp__widget'))
            log.info(`[iterateMessages] init mcp_servers=[${mcpNames}] widget_tools=[${widgetTools}]`)
            if (sys.session_id) onSessionId?.(sys.session_id)
            log.info('[session_init] outputStyle=%s availableOutputStyles=%j', sys.output_style, sys.available_output_styles)
            emit({
              type: 'session_init',
              session: {
                sessionId: sys.session_id ?? '',
                model: sys.model ?? '',
                tools: sys.tools ?? [],
                mcpServers: sys.mcp_servers ?? [],
                permissionMode: sys.permissionMode ?? 'default',
                slashCommands: sys.slash_commands ?? [],
                skills: sys.skills ?? [],
                claudeCodeVersion: sys.claude_code_version ?? '',
                cwd: sys.cwd ?? '',
                agents: sys.agents,
                apiKeySource: sys.apiKeySource,
                betas: sys.betas,
                outputStyle: sys.output_style,
                availableOutputStyles: sys.available_output_styles,
                plugins: sys.plugins,
                fastModeState: sys.fast_mode_state,
                fastModeDisabledReason: sys.fast_mode_disabled_reason,
              },
            })
          } else if (sys.subtype === 'hook_started') {
            emit({
              type: 'hook_started',
              hook: {
                hookId: sys.hook_id ?? '',
                hookName: sys.hook_name ?? '',
                hookEvent: sys.hook_event ?? '',
              },
            })
          } else if (sys.subtype === 'hook_response') {
            emit({
              type: 'hook_complete',
              hook: {
                hookId: sys.hook_id ?? '',
                hookName: sys.hook_name ?? '',
                hookEvent: sys.hook_event ?? '',
                output: sys.output ?? '',
                stdout: sys.stdout,
                stderr: sys.stderr,
                exitCode: sys.exit_code,
                outcome: sys.outcome ?? 'success',
              },
            })
          } else if (sys.subtype === 'compact_boundary') {
            emit({
              type: 'compact_boundary',
              trigger: sys.compact_metadata?.trigger ?? 'auto',
              preTokens: sys.compact_metadata?.pre_tokens ?? 0,
              postTokens: sys.compact_metadata?.post_tokens,
              durationMs: sys.compact_metadata?.duration_ms,
            })
          } else if (sys.subtype === 'status') {
            emit({
              type: 'status_indicator',
              indicator: sys.status === 'compacting' ? 'compacting' : null,
              permissionMode: sys.permissionMode,
              compactResult: sys.compact_result,
              compactError: sys.compact_error,
            })
          } else if (sys.subtype === 'session_state_changed') {
            const state = sys.state as 'idle' | 'running' | 'requires_action' | undefined
            if (state === 'idle') {
              emit({ type: 'status_change', status: 'idle' })
            } else if (state === 'running' || state === 'requires_action') {
              emit({ type: 'status_change', status: 'streaming' })
            }
          } else if (sys.subtype === 'task_started') {
            if (sys.task_id) activeBackgroundTasks.set(sys.task_id, { toolUseId: sys.tool_use_id, description: sys.description ?? '' })
            emit({
              type: 'task_started',
              taskId: sys.task_id ?? '',
              toolUseId: sys.tool_use_id,
              description: sys.description ?? '',
              taskType: sys.task_type,
            })
          } else if (sys.subtype === 'task_updated') {
            const patchStatus = sys.patch?.status as string | undefined
            if (sys.task_id && (patchStatus === 'completed' || patchStatus === 'failed' || patchStatus === 'killed')) {
              activeBackgroundTasks.delete(sys.task_id)
              if ((patchStatus === 'failed' || patchStatus === 'killed') && sys.tool_use_id) {
                emit({
                  type: 'task_notification',
                  taskId: sys.task_id,
                  toolUseId: sys.tool_use_id,
                  taskStatus: patchStatus === 'failed' ? 'failed' : 'stopped',
                  outputFile: sys.patch?.output_file ?? '',
                  summary: sys.patch?.summary,
                })
              }
              maybeEmitDeferredIdle()
            }
          } else if (sys.subtype === 'task_progress') {
            emit({
              type: 'task_progress',
              taskId: sys.task_id ?? '',
              toolUseId: sys.tool_use_id,
              description: sys.description ?? '',
              lastToolName: sys.last_tool_name,
              summary: sys.summary,
              usage: {
                totalTokens: sys.usage?.total_tokens ?? 0,
                toolUses: sys.usage?.tool_uses ?? 0,
                durationMs: sys.usage?.duration_ms ?? 0,
              },
            })
          } else if (sys.subtype === 'task_notification') {
            if (sys.task_id) activeBackgroundTasks.delete(sys.task_id)
            emit({
              type: 'task_notification',
              taskId: sys.task_id ?? '',
              toolUseId: sys.tool_use_id,
              taskStatus: sys.status ?? 'completed',
              outputFile: sys.output_file ?? '',
              summary: sys.summary,
              usage: sys.usage ? {
                totalTokens: sys.usage.total_tokens ?? 0,
                toolUses: sys.usage.tool_uses ?? 0,
                durationMs: sys.usage.duration_ms ?? 0,
              } : undefined,
            })
            maybeEmitDeferredIdle()
          } else if (sys.subtype === 'background_tasks_changed') {
            activeBackgroundTasks.clear()
            for (const t of (sys.tasks ?? []) as Array<{ task_id?: string; description?: string }>) {
              if (t?.task_id) activeBackgroundTasks.set(t.task_id, { description: t.description ?? '' })
            }
            maybeEmitDeferredIdle()
          } else if (sys.subtype === 'hook_progress') {
            emit({
              type: 'hook_progress',
              hook: {
                hookId: sys.hook_id ?? '',
                hookName: sys.hook_name ?? '',
                hookEvent: sys.hook_event ?? '',
                stdout: sys.stdout,
                stderr: sys.stderr,
                output: sys.output,
              },
            })
          } else if (sys.subtype === 'files_persisted') {
            emit({
              type: 'files_persisted',
              files: (sys.files ?? []).map((f: any) => ({ filename: f.filename, fileId: f.file_id })),
              failed: (sys.failed ?? []).map((f: any) => ({ filename: f.filename, error: f.error })),
              processedAt: sys.processed_at ?? '',
            })
          } else if (sys.subtype === 'elicitation_complete') {
            emit({
              type: 'elicitation_complete',
              mcpServerName: sys.mcp_server_name ?? '',
              elicitationId: sys.elicitation_id ?? '',
            })
          } else if (sys.subtype === 'api_retry') {
            emit({
              type: 'api_retry',
              attempt: sys.attempt ?? 1,
              maxRetries: sys.max_retries ?? 3,
              delayMs: sys.retry_delay_ms ?? 0,
            })
          } else if (sys.subtype === 'model_fallback' || sys.subtype === 'model_refusal_fallback') {
            emit({
              type: 'model_fallback',
              trigger: typeof sys.trigger === 'string' ? sys.trigger : 'unknown',
              fromModel: sys.original_model ?? sys.from_model,
              toModel: sys.fallback_model ?? sys.to_model,
            })
          } else if (sys.subtype === 'local_command_output') {
            const text = typeof sys.content === 'string' ? sys.content : ''
            if (text) {
              emit({ type: 'slash_command_output', messageId, content: text })
            }
          }
          break
        }

        case 'auth_status': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const auth = msg as any
          emit({
            type: 'auth_status',
            isAuthenticating: auth.isAuthenticating ?? false,
            output: auth.output ?? [],
            error: auth.error,
          })
          break
        }

        case 'assistant': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const assistantParent = (msg as any).parent_tool_use_id ?? null
          // Capture per-API-call usage for context window tracking
          if (msg.message?.usage) lastAssistantUsage = msg.message.usage

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const assistantError = (msg as any).error
          if (assistantError) {
            lastAssistantTypedError = String(assistantError)
          }

          if (!assistantParent) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lastTopLevelAssistantUuid = (msg as any).uuid ?? ''
            seedMessageTimestamp(messageId, msg)
          }

          // Track top-level message usage (latest step snapshot, deduped by SDK message ID)
          if (!assistantParent && msg.message?.usage) {
            // Reset accumulators when a new front-end message starts
            if (messageId !== lastTrackedMessageId) {
              lastTrackedMessageId = messageId
              processedStepIds.clear()
              messageInputTokens = 0
              messageOutputTokens = 0
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stepId = (msg.message as any)?.id ?? ''
            const u = msg.message.usage
            const stepInput = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
            const isDupe = stepId && processedStepIds.has(stepId)
            if (!isDupe) {
              if (stepId) processedStepIds.add(stepId)
              messageInputTokens += stepInput
              // output_tokens from assistant messages are incomplete (partial emit);
              // accurate output comes from message_delta stream events below.
            }
            emit({
              type: 'message_usage',
              messageId,
              inputTokens: messageInputTokens,
              outputTokens: messageOutputTokens,
            })
          }

          // Track subagent token usage (latest step snapshot, deduped by SDK message ID)
          if (assistantParent && msg.message?.usage) {
            if (!subagentTracking.has(assistantParent)) {
              subagentTracking.set(assistantParent, { stepIds: new Set(), input: 0, output: 0 })
            }
            const tracker = subagentTracking.get(assistantParent)!
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stepId = (msg.message as any)?.id ?? ''
            const u = msg.message.usage
            const stepInput = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
            const isDupe = stepId && tracker.stepIds.has(stepId)
            if (!isDupe) {
              if (stepId) tracker.stepIds.add(stepId)
              tracker.input += stepInput
            }
            emit({
              type: 'subagent_usage',
              messageId,
              parentToolUseId: assistantParent,
              inputTokens: tracker.input,
              outputTokens: tracker.output,
            })
          }

          const isSyntheticMsg = msg.message?.model === '<synthetic>'
          if (isSyntheticMsg && !assistantError && Array.isArray(msg.message?.content)) {
            const text = msg.message.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text ?? '')
              .join('')
              .trim()
            if (text) {
              pendingSlashOutput = pendingSlashOutput ? `${pendingSlashOutput}\n${text}` : text
            }
          }

          const content = msg.message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && assistantParent && typeof block.text === 'string' && block.text) {
                emit({
                  type: 'content_delta',
                  messageId,
                  delta: { type: 'text', text: block.text, parentToolUseId: assistantParent },
                })
              } else if (block.type === 'thinking' && assistantParent && typeof block.thinking === 'string' && block.thinking) {
                const now = Date.now()
                emit({
                  type: 'content_delta',
                  messageId,
                  delta: { type: 'thinking', thinking: block.thinking, parentToolUseId: assistantParent, startedAt: now, endedAt: now },
                })
              } else if (block.type === 'tool_use') {
                toolIdToName.set(block.id ?? '', block.name ?? 'unknown')

                if (block.name === 'Bash') {
                  const inp = typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {})
                  log.debug(`[bash-debug] assistant tool_use input=${inp.slice(0, 200)} typeof_input=${typeof block.input}`)
                }

                // Track Write/Edit to plan files (catches auto-allowed calls that skip canUseTool)
                if (trackPlanFile && (block.name === 'Write' || block.name === 'Edit')) {
                  const inp = typeof block.input === 'object' && block.input !== null ? block.input : {}
                  const filePath = (inp as Record<string, unknown>).file_path
                  if (typeof filePath === 'string') trackPlanFile(filePath)
                }

                emit({
                  type: 'content_delta',
                  messageId,
                  delta: {
                    type: 'tool_use',
                    toolName: block.name ?? 'unknown',
                    toolUseId: block.id ?? '',
                    input: typeof block.input === 'string'
                      ? block.input
                      : JSON.stringify(block.input ?? {}),
                    parentToolUseId: assistantParent,
                  },
                })
              }
            }
          }

          break
        }

        case 'stream_event': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const streamMsg = msg as any
          const event = streamMsg.event
          if (!event) break
          const streamParent = streamMsg.parent_tool_use_id ?? null

          if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            // Track index → toolUseId for input_json_delta correlation
            activeToolBlocks.set(event.index, event.content_block.id ?? '')
            toolIdToName.set(event.content_block.id ?? '', event.content_block.name ?? 'unknown')
            emit({
              type: 'content_delta',
              messageId,
              delta: {
                type: 'tool_use',
                toolName: event.content_block.name ?? 'unknown',
                toolUseId: event.content_block.id ?? '',
                input: '',
                status: 'streaming',
                parentToolUseId: streamParent,
              },
            })
          } else if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
            const now = Date.now()
            emit({
              type: 'content_delta',
              messageId,
              delta: { type: 'thinking', thinking: '', parentToolUseId: streamParent, startedAt: now, endedAt: now },
            })
          } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              emit({
                type: 'content_delta',
                messageId,
                delta: { type: 'text', text: event.delta.text, parentToolUseId: streamParent },
              })
            } else if (event.delta?.type === 'thinking_delta' && typeof event.delta.thinking === 'string') {
              emit({
                type: 'content_delta',
                messageId,
                delta: { type: 'thinking', thinking: event.delta.thinking, parentToolUseId: streamParent, endedAt: Date.now() },
              })
            } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
              const toolUseId = activeToolBlocks.get(event.index) ?? ''
              const toolName = toolIdToName.get(toolUseId) ?? ''
              trace('widget.main', 'input_json_delta', { toolUseId, toolName, partialLen: event.delta.partial_json.length }, messageId)
              emit({
                type: 'tool_input_delta',
                messageId,
                toolUseId,
                partialJson: event.delta.partial_json,
                parentToolUseId: streamParent,
              })
            }
          } else if (event.type === 'content_block_stop') {
            activeToolBlocks.delete(event.index)
          } else if (event.type === 'message_start') {
            emit({
              type: 'stream_message_start',
              messageId,
              apiMessageId: event.message?.id ?? '',
              model: event.message?.model ?? '',
              parentToolUseId: streamParent,
            })
          } else if (event.type === 'message_stop') {
            emit({
              type: 'stream_message_stop',
              messageId,
              parentToolUseId: streamParent,
            })
          } else if (event.type === 'message_delta') {
            if (event.usage?.output_tokens) {
              const finalOutput = event.usage.output_tokens as number
              if (!streamParent) {
                messageOutputTokens += finalOutput
                emit({
                  type: 'message_usage',
                  messageId,
                  inputTokens: messageInputTokens,
                  outputTokens: messageOutputTokens,
                })
              } else if (subagentTracking.has(streamParent)) {
                const tracker = subagentTracking.get(streamParent)!
                tracker.output += finalOutput
                emit({
                  type: 'subagent_usage',
                  messageId,
                  parentToolUseId: streamParent,
                  inputTokens: tracker.input,
                  outputTokens: tracker.output,
                })
              }
            }
          }
          break
        }

        case 'tool_progress': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tp = msg as any
          const retry = tp.subagent_retry
          emit({
            type: 'tool_progress',
            messageId,
            toolUseId: tp.tool_use_id ?? '',
            toolName: tp.tool_name ?? '',
            elapsedSeconds: tp.elapsed_time_seconds ?? 0,
            parentToolUseId: tp.parent_tool_use_id ?? null,
            taskId: tp.task_id,
            subagentType: tp.subagent_type,
            subagentRetry: retry
              ? {
                  agentId: retry.agent_id ?? '',
                  attempt: retry.attempt ?? 0,
                  maxRetries: retry.max_retries ?? 0,
                  retryDelayMs: retry.retry_delay_ms ?? 0,
                  errorStatus: retry.error_status ?? null,
                  errorCategory: retry.error_category ?? '',
                }
              : undefined,
          })
          break
        }

        case 'tool_use_summary': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = msg as any
          const summaryText = raw.summary as string | undefined
          if (summaryText) {
            const toolUseId = raw.preceding_tool_use_ids?.[0] ?? raw.tool_use_id ?? ''
            const toolName = toolIdToName.get(toolUseId)
            const isBash = toolName === 'Bash'
            const outputPath = isBash ? extractBashOutputPath(summaryText) : undefined
            const isTimedOut = isBash ? extractBashKilled(raw.tool_use_result) : undefined
            const taskCreateTodo = extractTaskCreateTodo(toolName, raw.tool_use_result, summaryText)
            const isError = isToolLayerError(toolName, raw.is_error === true, summaryText)
            emit({
              type: 'content_delta',
              messageId,
              delta: { type: 'tool_result', toolUseId, summary: summaryText, ...(outputPath ? { outputPath } : {}), ...(isTimedOut ? { isTimedOut } : {}), ...(isError ? { isError: true } : {}), ...(taskCreateTodo ?? {}), parentToolUseId: raw.parent_tool_use_id ?? null },
            })
          }
          break
        }

        case 'result': {
          if (lastReplayCheckpointId) {
            const latestMid = getCurrentMessageId() || messageId
            log.info('[checkpoint] captured (flush at result): checkpointId=%s resumePointId=%s messageId=%s', lastReplayCheckpointId, lastTopLevelAssistantUuid, latestMid)
            emit({ type: 'checkpoint_captured', messageId: latestMid, checkpointId: lastReplayCheckpointId, resumePointId: lastTopLevelAssistantUuid })
            lastReplayCheckpointId = ''
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = msg as any
          log.debug(`[iterateMessages] result subtype=${result.subtype} session_id=${result.session_id ?? '(none)'}`)
          const metadata = buildResultMetadata(result, getCurrentStartTime(), timing.pausedMs, lastAssistantUsage)
          if (lastTopLevelAssistantUuid) metadata.forkAnchorId = lastTopLevelAssistantUuid

          try {
            if (metadata.modelUsage && Object.keys(metadata.modelUsage).length > 0) {
              const deltas: Record<string, UsageStepDelta> = {}
              for (const [model, usage] of Object.entries(metadata.modelUsage)) {
                const curr = modelUsageInfoToDelta(usage)
                const prev = usageSnapshotByModel.get(model)
                const delta = prev ? subtractDelta(curr, prev) : curr
                usageSnapshotByModel.set(model, curr)
                deltas[model] = delta
              }
              recordClaudeStepDeltas(deltas, new Date())
            }
          } catch (err) {
            log.warn('[usage-stats] failed to record Claude usage: %s', err instanceof Error ? err.message : String(err))
          }

          if (getInterrupted()) {
            emit({ type: 'message_interrupted', messageId, metadata })
            activeBackgroundTasks.clear()
          } else if (result.subtype === 'success') {
            if (pendingSlashOutput) {
              emit({ type: 'slash_command_output', messageId, content: pendingSlashOutput })
            }
            emit({ type: 'message_complete', messageId, metadata })
          } else {
            const rawError = result.errors?.join('; ') ?? 'Unknown error'
            const decorated = decorateMessageErrorText(rawError, lastAssistantTypedError, metadata.apiErrorStatus)
            if (isResumeDropsTurnRefusal(rawError)) {
              // Deterministic refusal: clear any truncating fork target and full-resume only.
              // Re-sending the same resumeSessionAt + resumeDropsTurn pair fails forever.
              log.warn(
                '[claude-query] resume-drops-turn refused session=%s — clear fork target, full resume, do not retry same args: %s',
                opts.superoneSessionId,
                rawError,
              )
            }
            if (result.terminal_reason === 'api_error') {
              log.error(
                '[claude-query] API error session=%s message=%s httpStatus=%s error=%s',
                opts.superoneSessionId,
                messageId,
                metadata.apiErrorStatus ?? 'unknown',
                decorated,
              )
            }
            emit({ type: 'message_error', messageId, error: decorated })
          }
          lastAssistantTypedError = undefined
          pendingSlashOutput = ''

          resultSeen = true
          turnActive = false
          onStepBoundary?.()
          if (messageId === getCurrentMessageId()) {
            emit({
              type: 'status_change',
              status: activeBackgroundTasks.size === 0 ? 'idle' : 'background',
            })
          }
          break
        }

        case 'prompt_suggestion': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ps = msg as any
          if (ps.suggestion) {
            emit({ type: 'prompt_suggestion', suggestion: ps.suggestion })
          }
          break
        }

        case 'rate_limit_event': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rl = (msg as any).rate_limit_info
          if (rl) {
            emit({
              type: 'rate_limit',
              status: rl.status,
              resetsAt: rl.resetsAt,
              rateLimitType: rl.rateLimitType,
              utilization: rl.utilization,
              overageStatus: rl.overageStatus,
              overageResetsAt: rl.overageResetsAt,
              overageDisabledReason: rl.overageDisabledReason,
              isUsingOverage: rl.isUsingOverage,
              surpassedThreshold: rl.surpassedThreshold,
              errorCode: rl.errorCode,
              canUserPurchaseCredits: rl.canUserPurchaseCredits,
              hasChargeableSavedPaymentMethod: rl.hasChargeableSavedPaymentMethod,
            })
          }
          break
        }
      }

    }
    log.debug('[iterateMessages] loop ended normally')
  } catch (err) {
    const messageId = getCurrentMessageId()
    const interrupted = getInterrupted()
    log.debug(`[iterateMessages] catch — interrupted=${interrupted}, error=${err instanceof Error ? err.message : String(err)}`)
    if (interrupted) {
      emit({ type: 'message_interrupted', messageId, metadata: { durationMs: Date.now() - getCurrentStartTime() - timing.pausedMs } })
      emit({ type: 'status_change', status: 'idle' })
      return
    }
    const errMsg = err instanceof Error ? err.message : String(err)
    emit({ type: 'message_error', messageId, error: errMsg })
    emit({ type: 'status_change', status: 'error' })
  }
}

function decorateMessageErrorText(rawError: string, typedCode: string | undefined, apiStatus: number | null | undefined): string {
  if (typedCode === 'model_not_found') {
    const suffix = apiStatus ? ` (HTTP ${apiStatus})` : ''
    return `Model not available for this provider${suffix}: ${rawError}`
  }
  return rawError
}

/** Extract rich metadata from an SDK result message. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildResultMetadata(result: any, startTime: number, pausedMs: number, lastAssistantUsage?: any): MessageMetadata {
  const metadata: MessageMetadata = {
    durationMs: Date.now() - startTime - pausedMs,
    durationApiMs: result.duration_api_ms,
    costUsd: result.total_cost_usd,
    numTurns: result.num_turns,
    stopReason: result.stop_reason ?? null,
    terminalReason: result.terminal_reason,
    resultText: result.result,
    fastModeState: result.fast_mode_state,
    fastModeDisabledReason: result.fast_mode_disabled_reason,
    errorSubtype: result.subtype !== 'success' ? result.subtype : undefined,
    structuredOutput: result.structured_output,
    isError: result.is_error || undefined,
    apiErrorStatus: result.api_error_status ?? undefined,
  }

  if (result.permission_denials?.length > 0) {
    metadata.permissionDenials = result.permission_denials.map((d: any) => ({
      toolName: d.tool_name,
      toolUseId: d.tool_use_id,
      toolInput: d.tool_input ?? {},
    }))
  }

  // Use the last assistant message's usage as context window snapshot
  // (result.usage is cumulative across all turns, not a context window size)
  const u = lastAssistantUsage ?? result.usage
  if (u) {
    metadata.usage = {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    }
  }

  if (result.modelUsage) {
    metadata.modelUsage = {}
    for (const [model, usage] of Object.entries(result.modelUsage)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = usage as any
      metadata.modelUsage[model] = {
        inputTokens: u.inputTokens ?? 0,
        outputTokens: u.outputTokens ?? 0,
        cacheReadInputTokens: u.cacheReadInputTokens ?? 0,
        cacheCreationInputTokens: u.cacheCreationInputTokens ?? 0,
        costUSD: u.costUSD ?? 0,
        webSearchRequests: u.webSearchRequests || undefined,
        contextWindow: u.contextWindow || undefined,
        maxOutputTokens: u.maxOutputTokens || undefined,
        canonicalModel: typeof u.canonicalModel === 'string' ? u.canonicalModel : undefined,
        provider: typeof u.provider === 'string' ? u.provider : undefined,
      }
    }
  }

  return metadata
}

/** Extract readable text from a tool_result content field. */
function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((b: any) => b.type === 'text' && b.text)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((b: any) => b.text)
      .join('\n')
  }
  return ''
}

function extractBashKilled(toolUseResult?: unknown): boolean | undefined {
  const tur = toolUseResult as any
  return tur?.killed === true ? true : undefined
}

/**
 * Whether a tool_result should render as a tool-layer error in the UI.
 *
 * Bash is special: the CLI marks non-zero command exits with is_error=true and
 * content like "Exit code 1", but those are command results, not tool failures.
 * Production transcripts show <tool_use_error> only on tool-layer paths
 * (validation, blocked, cancelled parallel call, permission, …) and never on
 * plain "Exit code N" results — so for Bash we key solely off that marker.
 * Other tools keep the SDK is_error flag (plus the marker as a fallback).
 */
function isToolLayerError(toolName: string | undefined, sdkIsError: boolean, resultText: string): boolean {
  const hasToolUseErrorTag = resultText.includes('<tool_use_error>')
  if (toolName === 'Bash') return hasToolUseErrorTag
  return sdkIsError || hasToolUseErrorTag
}

/**
 * TaskCreate's real task id is SDK-assigned and only present in its result
 * (TaskCreateOutput = { task: { id, subject } }). Surface it on the tool_result
 * delta via the existing toolTodos channel so both the desktop store and the
 * mobile broadcaster key the todo by the same id a later TaskUpdate references.
 */
function extractTaskCreateTodo(
  toolName: string | undefined,
  toolUseResult: unknown,
  resultText: string,
): { todoToolName: string; toolTodos: Array<{ content: string; status: string; taskId?: string }> } | undefined {
  if (toolName !== 'TaskCreate') return undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let task = (toolUseResult as any)?.task
  if (!task?.id && resultText) {
    try {
      const parsed = JSON.parse(resultText)
      if (parsed?.task?.id) task = parsed.task
    } catch { /* result is not structured JSON */ }
  }
  if (!task?.id) return undefined
  return {
    todoToolName: 'TaskCreate',
    toolTodos: [{ content: String(task.subject ?? ''), status: 'pending', taskId: String(task.id) }],
  }
}

const BASH_OUTPUT_PATH_RE = /Output is being written to:\s*(\S+\.output)/

function extractBashOutputPath(summaryText?: string): string | undefined {
  if (!summaryText) return undefined
  return summaryText.match(BASH_OUTPUT_PATH_RE)?.[1]
}
