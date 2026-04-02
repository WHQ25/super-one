import { query, type CanUseTool, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, MessageMetadata, PermissionMode, SandboxInfo, SendMessageRequest } from '../../shared/agent-types'
import type { MessageBridge } from './message-bridge'
import log from '../logger'
import { trace } from './event-trace'
import { getNodeRuntime, resolveSdkCli } from './resolve-cli'
import { createGenerativeUiMcpServer } from '../generative-ui/mcp-server'
import { getCanvasMcpProxy } from '../canvas/canvas-mcp-proxy'

export interface SessionQueryOptions {
  cwd: string
  model?: string
  effort?: 'low' | 'medium' | 'high' | 'max'
  permissionMode: PermissionMode
  sandboxInfo?: SandboxInfo
  canUseTool: CanUseTool
  trackPlanFile?: (filePath: string) => void
  resume?: string
  resumeSessionAt?: string
  forkSession?: boolean
  sessionId?: string
  abortController?: AbortController
  additionalDirectories?: string[]
  env?: Record<string, string | undefined>
  taskBudget?: number
}

export interface SessionQueryHandle {
  query: Query
  iterationDone: Promise<void>
}

/** Create a long-lived session query consuming messages from a bridge. */
export function createSessionQuery(
  bridge: MessageBridge,
  options: SessionQueryOptions,
  emit: (event: AgentEvent) => void,
  getCurrentMessageId: () => string,
  getCurrentStartTime: () => number,
  getInterrupted: () => boolean,
  onSessionId?: (id: string) => void,
  onQueuedTurnStart?: (messageId: string) => void,
): SessionQueryHandle {
  const timing = { pausedMs: 0 }
  const timedCanUseTool: CanUseTool = async (...args) => {
    const start = Date.now()
    const result = await options.canUseTool(...args)
    timing.pausedMs += Date.now() - start
    return result
  }

  log.info('[claude-query] createSessionQuery env=%s model=%s cwd=%s resume=%s enableFileCheckpointing=true', options.env ? Object.keys(options.env).join(',') : 'none', options.model ?? 'default', options.cwd, options.resume ?? 'none')
  log.info('[claude-query] env CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=%s CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING=%s', process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING ?? 'unset', process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING ?? 'unset')
  trace('provider.query', 'create_session', { envKeys: options.env ? Object.keys(options.env) : null, model: options.model, resume: options.resume })

  const cliPath = resolveSdkCli()
  log.info('[claude-query] resolved SDK CLI path=%s', cliPath ?? 'none')

  const runtime = getNodeRuntime()
  const q = query({
    prompt: bridge,
    options: {
      pathToClaudeCodeExecutable: cliPath,
      executable: runtime.executable as any,
      cwd: options.cwd,
      model: options.model,
      effort: options.effort,
      promptSuggestions: true,
      includePartialMessages: true,
      permissionMode: options.permissionMode,
      allowDangerouslySkipPermissions: options.permissionMode === 'bypassPermissions',
      canUseTool: timedCanUseTool,
      sandbox: options.sandboxInfo?.enabled
        ? { enabled: true, autoAllowBashIfSandboxed: options.sandboxInfo.autoAllowBash }
        : undefined,
      enableFileCheckpointing: true,
      agentProgressSummaries: true,
      taskBudget: options.taskBudget ? { total: options.taskBudget } : undefined,
      extraArgs: { 'replay-user-messages': null },
      settingSources: ['user', 'project', 'local'],
      resume: options.resume,
      resumeSessionAt: options.resumeSessionAt,
      forkSession: options.forkSession,
      sessionId: options.sessionId,
      abortController: options.abortController,
      additionalDirectories: options.additionalDirectories,
      env: runtime.env || options.env ? { ...process.env, ...runtime.env, ...options.env } : undefined,
      stderr: (data: string) => {
        log.warn('[claude-cli]', data.trimEnd())
        if (data.includes('FileHistory') || data.includes('checkpoint') || data.includes('file_history')) {
          log.info('[claude-cli][checkpoint-stderr] %s', data.trimEnd())
        }
      },
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: 'You have a powerful `show_widget` tool (via the `widget` MCP server) for rendering visual content inline — diagrams, charts, dashboards, data tables, interactive widgets, illustrations, and any visual explanation. Prefer show_widget over plain text/markdown when the user asks for something visual, data-heavy, or interactive. For mermaid diagrams (ERD, sequence, flowchart, etc.), use fenced ```mermaid code blocks instead — the host app renders them natively.',
      },
      mcpServers: { 'widget': createGenerativeUiMcpServer(), 'canvas': getCanvasMcpProxy() },
    },
  })

  const iterationDone = iterateMessages(q, {
    emit,
    getCurrentMessageId,
    getCurrentStartTime,
    getInterrupted,
    onSessionId,
    trackPlanFile: options.trackPlanFile,
    onQueuedTurnStart,
    bridge,
    timing,
  })

  return { query: q, iterationDone }
}

/** Build an SDKUserMessage from a SendMessageRequest. */
export function buildUserMessage(request: SendMessageRequest, sessionId: string): SDKUserMessage {
  let content: unknown

  if (request.images?.length) {
    const blocks: Array<Record<string, unknown>> = request.images.map((att) => ({
      type: att.mimeType === 'application/pdf' ? 'document' : 'image',
      source: { type: 'base64', media_type: att.mimeType, data: att.base64 },
    }))
    if (request.content.trim()) {
      blocks.push({ type: 'text', text: request.content })
    }
    content = blocks
  } else {
    content = request.content
  }

  const msg = {
    type: 'user' as const,
    message: { role: 'user' as const, content },
    parent_tool_use_id: null,
    session_id: sessionId,
    ...(request.priority ? { priority: request.priority } : {}),
  } as SDKUserMessage
  trace('agent.sdk', 'user_send', { content })
  return msg
}

interface IterateMessagesOptions {
  emit: (event: AgentEvent) => void
  getCurrentMessageId: () => string
  getCurrentStartTime: () => number
  getInterrupted: () => boolean
  onSessionId?: (id: string) => void
  trackPlanFile?: (filePath: string) => void
  onQueuedTurnStart?: (messageId: string) => void
  bridge: MessageBridge
  timing: { pausedMs: number }
}

async function iterateMessages(q: Query, opts: IterateMessagesOptions): Promise<void> {
  const { emit: rawEmit, getCurrentMessageId, getCurrentStartTime, getInterrupted, onSessionId, trackPlanFile, onQueuedTurnStart, bridge, timing } = opts
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
  // Per-step dedup: track processed step IDs (SDK message IDs) and latest step tokens
  const processedStepIds = new Set<string>()
  let messageInputTokens = 0
  let messageOutputTokens = 0
  let lastTrackedMessageId = ''
  // Subagent token accumulation per parent_tool_use_id
  const subagentTracking = new Map<string, { stepIds: Set<string>; input: number; output: number }>()

  let pendingBackgroundTasks = 0
  let earlyIdleEmitted = false
  let earlyIdlePauseStart = 0
  const backgroundToolUseIds = new Set<string>()
  let turnMessageId = getCurrentMessageId()
  let turnActive = false
  let resultSeen = false
  let turnUserEchoSeen = false

  log.debug('[iterateMessages] starting iteration loop')
  try {
    for await (const msg of q) {
      let messageId = turnMessageId

      if (!turnActive) {
        const latestId = getCurrentMessageId()
        if (latestId && latestId !== turnMessageId) {
          turnMessageId = latestId
          messageId = turnMessageId
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
            emit({ type: 'message_start', message: {
              id: queuedMessageId,
              role: 'assistant',
              status: 'streaming',
              content: [],
              createdAt: new Date().toISOString(),
              providerId: 'claude',
            } })
            if (earlyIdlePauseStart) {
              timing.pausedMs += Date.now() - earlyIdlePauseStart
              earlyIdlePauseStart = 0
            }
            emit({ type: 'status_change', status: 'streaming' })
            earlyIdleEmitted = false
            resultSeen = false
            turnActive = true
          } else if (earlyIdleEmitted) {
            log.debug('[iterateMessages] re-emit streaming: main agent resumed after early idle')
            if (earlyIdlePauseStart) {
              timing.pausedMs += Date.now() - earlyIdlePauseStart
              earlyIdlePauseStart = 0
            }
            emit({ type: 'status_change', status: 'streaming' })
            earlyIdleEmitted = false
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
        if (!parentToolUseId && earlyIdleEmitted) {
          const msgContent2 = userMsg.message?.content
          const isBackgroundResult = Array.isArray(msgContent2) && msgContent2.length > 0 &&
            msgContent2.every((b: any) => b.type === 'tool_result' && backgroundToolUseIds.has(b.tool_use_id))
          if (!isBackgroundResult) {
            log.debug('[iterateMessages] re-emit streaming: user message after early idle')
            if (earlyIdlePauseStart) {
              timing.pausedMs += Date.now() - earlyIdlePauseStart
              earlyIdlePauseStart = 0
            }
            emit({ type: 'status_change', status: 'streaming' })
            earlyIdleEmitted = false
          }
        }
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
            emit({ type: 'message_start', message: {
              id: queuedMessageId,
              role: 'assistant',
              status: 'streaming',
              content: [],
              createdAt: new Date().toISOString(),
              providerId: 'claude',
            } })
            turnActive = true
          }
        }

        // Extract tool_result blocks from array content
        if (Array.isArray(msgContent)) {
          for (const block of msgContent) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const toolName = toolIdToName.get(block.tool_use_id)
              const text = extractToolResultText(block.content)
              const isBash = toolName === 'Bash'
              const outputPath = isBash ? extractBashOutputPath(text) : undefined
              const isTimedOut = isBash ? extractBashKilled(userMsg.tool_use_result) : undefined
              emit({
                type: 'content_delta',
                messageId,
                delta: {
                  type: 'tool_result',
                  toolUseId: block.tool_use_id,
                  summary: text || '',
                  ...(outputPath ? { outputPath } : {}),
                  ...(isTimedOut ? { isTimedOut } : {}),
                  parentToolUseId,
                },
                isSynthetic,
                isReplay,
              })
            }
          }
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

        // Capture file checkpoint UUID from top-level user messages (skip replays — their checkpoint data is not available)
        const uuid = userMsg.uuid as string | undefined
        log.info('[checkpoint] user msg: uuid=%s parent=%s isReplay=%s isSynthetic=%s', uuid ?? 'none', userMsg.parent_tool_use_id ?? 'none', userMsg.isReplay ?? false, userMsg.isSynthetic ?? false)
        if (uuid && !userMsg.parent_tool_use_id && !userMsg.isReplay) {
          log.info('[checkpoint] captured: checkpointId=%s resumePointId=%s', uuid, lastTopLevelAssistantUuid)
          emit({ type: 'checkpoint_captured', messageId, checkpointId: uuid, resumePointId: lastTopLevelAssistantUuid })
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
            })
          } else if (sys.subtype === 'status') {
            emit({
              type: 'status_indicator',
              indicator: sys.status ?? null,
              permissionMode: sys.permissionMode,
            })
          } else if (sys.subtype === 'task_started') {
            pendingBackgroundTasks++
            if (sys.tool_use_id) backgroundToolUseIds.add(sys.tool_use_id)
            emit({
              type: 'task_started',
              taskId: sys.task_id ?? '',
              toolUseId: sys.tool_use_id,
              description: sys.description ?? '',
              taskType: sys.task_type,
            })
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
            pendingBackgroundTasks = Math.max(0, pendingBackgroundTasks - 1)
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

          // Forward assistant-level errors (auth_failed, billing_error, rate_limit, etc.)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const assistantError = (msg as any).error
          if (assistantError) {
            emit({ type: 'assistant_error', messageId, error: assistantError })
          }

          if (!assistantParent) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lastTopLevelAssistantUuid = (msg as any).uuid ?? ''
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
          if (isSyntheticMsg && Array.isArray(msg.message?.content)) {
            const text = msg.message.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text ?? '')
              .join('')
              .trim()
            if (text) {
              emit({ type: 'slash_command_output', messageId, content: text })
            }
          }

          const content = msg.message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use') {
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
          } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              emit({
                type: 'content_delta',
                messageId,
                delta: { type: 'text', text: event.delta.text, parentToolUseId: streamParent },
              })
            } else if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
              emit({
                type: 'content_delta',
                messageId,
                delta: { type: 'thinking', thinking: event.delta.thinking, parentToolUseId: streamParent },
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
            const stopReason = event.delta?.stop_reason
            if (!streamParent && pendingBackgroundTasks > 0 && stopReason && stopReason !== 'tool_use') {
              emit({ type: 'status_change', status: 'idle' })
              earlyIdleEmitted = true
              earlyIdlePauseStart = Date.now()
            }
          }
          break
        }

        case 'tool_progress': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tp = msg as any
          emit({
            type: 'tool_progress',
            messageId,
            toolUseId: tp.tool_use_id ?? '',
            toolName: tp.tool_name ?? '',
            elapsedSeconds: tp.elapsed_time_seconds ?? 0,
            parentToolUseId: tp.parent_tool_use_id ?? null,
            taskId: tp.task_id,
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
            emit({
              type: 'content_delta',
              messageId,
              delta: { type: 'tool_result', toolUseId, summary: summaryText, ...(outputPath ? { outputPath } : {}), ...(isTimedOut ? { isTimedOut } : {}), parentToolUseId: raw.parent_tool_use_id ?? null },
            })
          }
          break
        }

        case 'result': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = msg as any
          log.debug(`[iterateMessages] result subtype=${result.subtype} session_id=${result.session_id ?? '(none)'}`)
          if (earlyIdlePauseStart) {
            timing.pausedMs += Date.now() - earlyIdlePauseStart
            earlyIdlePauseStart = 0
          }
          const metadata = buildResultMetadata(result, getCurrentStartTime(), timing.pausedMs, lastAssistantUsage)

          if (getInterrupted()) {
            emit({ type: 'message_interrupted', messageId, metadata })
          } else if (result.subtype === 'success') {
            emit({ type: 'message_complete', messageId, metadata })
          } else {
            const errorMsg = result.errors?.join('; ') ?? 'Unknown error'
            emit({ type: 'message_error', messageId, error: errorMsg })
          }

          resultSeen = true
          turnActive = false
          if (messageId === getCurrentMessageId()) {
            emit({ type: 'status_change', status: 'idle' })
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
    if (earlyIdlePauseStart) {
      timing.pausedMs += Date.now() - earlyIdlePauseStart
      earlyIdlePauseStart = 0
    }
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

/** Extract rich metadata from an SDK result message. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildResultMetadata(result: any, startTime: number, pausedMs: number, lastAssistantUsage?: any): MessageMetadata {
  const metadata: MessageMetadata = {
    durationMs: Date.now() - startTime - pausedMs,
    durationApiMs: result.duration_api_ms,
    costUsd: result.total_cost_usd,
    numTurns: result.num_turns,
    stopReason: result.stop_reason ?? null,
    resultText: result.result,
    fastModeState: result.fast_mode_state,
    errorSubtype: result.subtype !== 'success' ? result.subtype : undefined,
    structuredOutput: result.structured_output,
    isError: result.is_error || undefined,
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

const BASH_OUTPUT_PATH_RE = /Output is being written to:\s*(\S+\.output)/

function extractBashOutputPath(summaryText?: string): string | undefined {
  if (!summaryText) return undefined
  return summaryText.match(BASH_OUTPUT_PATH_RE)?.[1]
}
