/**
 * Claude Agent SDK message -> SuperOne AgentEvent conversion.
 *
 * This is the Electron-free form of the desktop Claude event semantics. Hosts
 * provide the message id and side-effect hooks; the mapper owns only protocol
 * state and emits IPC-safe AgentEvents.
 */
import type { AgentEvent, MessageMetadata } from '@superone/shared/agent-types'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

type Raw = Record<string, any>

export interface ClaudeAgentEventMapperOptions {
  messageId: string
  emit: (event: AgentEvent) => void
  now?: () => number
  startedAt?: number
  pausedMs?: () => number
  isInterrupted?: () => boolean
  onSessionId?: (sessionId: string) => void
  onStepBoundary?: () => void
  trackPlanFile?: (filePath: string) => void
}

export interface ClaudeAgentEventApplyResult {
  sessionId: string | null
  textDelta: string | null
  isResult: boolean
  resultIsError: boolean
  resultText: string | null
  resultError: string | null
}

export interface ClaudeAgentEventMapper {
  apply(message: SDKMessage | Record<string, unknown>): ClaudeAgentEventApplyResult
}

function emptyResult(sessionId: string | null): ClaudeAgentEventApplyResult {
  return {
    sessionId,
    textDelta: null,
    isResult: false,
    resultIsError: false,
    resultText: null,
    resultError: null,
  }
}

function sessionIdOf(message: Raw): string | null {
  return typeof message.session_id === 'string' && message.session_id.length > 0
    ? message.session_id
    : null
}

function stringifyInput(input: unknown): string {
  if (typeof input === 'string') return input
  if (input == null) return ''
  try {
    return JSON.stringify(input)
  } catch {
    return ''
  }
}

export function extractClaudeToolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block: Raw) => block?.type === 'text' && block.text)
    .map((block: Raw) => String(block.text))
    .join('\n')
}

function extractBashKilled(toolUseResult: unknown): boolean | undefined {
  return (toolUseResult as Raw | undefined)?.killed === true ? true : undefined
}

function extractBashOutputPath(summaryText?: string): string | undefined {
  return summaryText?.match(/Output is being written to:\s*(\S+\.output)/)?.[1]
}

export function isClaudeToolLayerError(
  toolName: string | undefined,
  sdkIsError: boolean,
  resultText: string,
): boolean {
  const hasToolUseErrorTag = resultText.includes('<tool_use_error>')
  return toolName === 'Bash' ? hasToolUseErrorTag : sdkIsError || hasToolUseErrorTag
}

function extractTaskCreateTodo(
  toolName: string | undefined,
  toolUseResult: unknown,
  resultText: string,
): { todoToolName: string; toolTodos: Array<{ content: string; status: string; taskId?: string }> } | undefined {
  if (toolName !== 'TaskCreate') return undefined
  let task = (toolUseResult as Raw | undefined)?.task
  if (!task?.id && resultText) {
    try {
      const parsed = JSON.parse(resultText)
      if (parsed?.task?.id) task = parsed.task
    } catch {
      // Non-JSON tool output has no structured task id.
    }
  }
  if (!task?.id) return undefined
  return {
    todoToolName: 'TaskCreate',
    toolTodos: [{
      content: String(task.subject ?? ''),
      status: 'pending',
      taskId: String(task.id),
    }],
  }
}

export function buildClaudeResultMetadata(
  result: Raw,
  startedAt: number,
  pausedMs: number,
  lastAssistantUsage?: Raw | null,
  now: () => number = Date.now,
): MessageMetadata {
  const metadata: MessageMetadata = {
    durationMs: now() - startedAt - pausedMs,
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
    metadata.permissionDenials = result.permission_denials.map((denial: Raw) => ({
      toolName: denial.tool_name,
      toolUseId: denial.tool_use_id,
      toolInput: denial.tool_input ?? {},
    }))
  }

  const usage = lastAssistantUsage ?? result.usage
  if (usage) {
    metadata.usage = {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    }
  }

  if (result.modelUsage) {
    metadata.modelUsage = {}
    for (const [model, rawUsage] of Object.entries(result.modelUsage)) {
      const modelUsage = rawUsage as Raw
      metadata.modelUsage[model] = {
        inputTokens: modelUsage.inputTokens ?? 0,
        outputTokens: modelUsage.outputTokens ?? 0,
        cacheReadInputTokens: modelUsage.cacheReadInputTokens ?? 0,
        cacheCreationInputTokens: modelUsage.cacheCreationInputTokens ?? 0,
        costUSD: modelUsage.costUSD ?? 0,
        webSearchRequests: modelUsage.webSearchRequests || undefined,
        contextWindow: modelUsage.contextWindow || undefined,
        maxOutputTokens: modelUsage.maxOutputTokens || undefined,
        canonicalModel: typeof modelUsage.canonicalModel === 'string' ? modelUsage.canonicalModel : undefined,
        provider: typeof modelUsage.provider === 'string' ? modelUsage.provider : undefined,
      }
    }
  }
  return metadata
}

/** SDK refusal when `resumeDropsTurn` validation fails (deterministic — do not retry). */
export const RESUME_DROPS_TURN_REFUSAL_PREFIX = 'Resume rejected by --resume-drops-turn:'

export function isResumeDropsTurnRefusal(error: string): boolean {
  return error.includes(RESUME_DROPS_TURN_REFUSAL_PREFIX)
}

function resultErrorText(result: Raw): string {
  if (Array.isArray(result.errors)) return result.errors.join('; ') || 'Unknown error'
  if (typeof result.errors === 'string' && result.errors) return result.errors
  if (typeof result.result === 'string' && result.result) return result.result
  return 'Unknown error'
}

function decorateMessageErrorText(
  rawError: string,
  typedCode: string | undefined,
  apiStatus: number | null | undefined,
): string {
  if (typedCode !== 'model_not_found') return rawError
  const suffix = apiStatus ? ` (HTTP ${apiStatus})` : ''
  return `Model not available for this provider${suffix}: ${rawError}`
}

export function createClaudeAgentEventMapper(
  options: ClaudeAgentEventMapperOptions,
): ClaudeAgentEventMapper {
  const now = options.now ?? Date.now
  const startedAt = options.startedAt ?? now()
  const messageId = options.messageId
  const emit = options.emit
  const activeToolBlocks = new Map<number, string>()
  const toolIdToName = new Map<string, string>()
  const processedStepIds = new Set<string>()
  const subagentTracking = new Map<string, { stepIds: Set<string>; input: number; output: number }>()
  const activeBackgroundTasks = new Map<string, { toolUseId?: string; description: string }>()
  let lastAssistantUsage: Raw | null = null
  let lastTopLevelAssistantUuid = ''
  let lastReplayCheckpointId = ''
  let lastAssistantTypedError: string | undefined
  let pendingSlashOutput = ''
  let messageInputTokens = 0
  let messageOutputTokens = 0
  let resultSeen = false
  let timestampApplied = false

  const maybeEmitDeferredIdle = () => {
    if (resultSeen && activeBackgroundTasks.size === 0) {
      emit({ type: 'status_change', status: 'idle' })
    }
  }

  const emitToolResult = (
    toolUseId: string,
    content: unknown,
    sdkIsError: boolean,
    toolUseResult: unknown,
    parentToolUseId: string | null,
    flags?: { isSynthetic?: boolean; isReplay?: boolean },
  ) => {
    const toolName = toolIdToName.get(toolUseId)
    const text = extractClaudeToolResultText(content)
    const isBash = toolName === 'Bash'
    const outputPath = isBash ? extractBashOutputPath(text) : undefined
    const isTimedOut = isBash ? extractBashKilled(toolUseResult) : undefined
    const taskCreateTodo = extractTaskCreateTodo(toolName, toolUseResult, text)
    const isError = isClaudeToolLayerError(toolName, sdkIsError, text)
    emit({
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_result',
        toolUseId,
        summary: text,
        ...(outputPath ? { outputPath } : {}),
        ...(isTimedOut ? { isTimedOut } : {}),
        ...(isError ? { isError: true } : {}),
        ...(taskCreateTodo ?? {}),
        parentToolUseId,
      },
      ...(flags?.isSynthetic ? { isSynthetic: true } : {}),
      ...(flags?.isReplay ? { isReplay: true } : {}),
    })
  }

  const applySystem = (system: Raw) => {
    switch (system.subtype) {
      case 'init':
        if (typeof system.session_id === 'string' && system.session_id) {
          options.onSessionId?.(system.session_id)
        }
        emit({
          type: 'session_init',
          session: {
            sessionId: system.session_id ?? '',
            model: system.model ?? '',
            tools: system.tools ?? [],
            mcpServers: system.mcp_servers ?? [],
            permissionMode: system.permissionMode ?? 'default',
            slashCommands: system.slash_commands ?? [],
            skills: system.skills ?? [],
            claudeCodeVersion: system.claude_code_version ?? '',
            cwd: system.cwd ?? '',
            agents: system.agents,
            apiKeySource: system.apiKeySource,
            betas: system.betas,
            outputStyle: system.output_style,
            availableOutputStyles: system.available_output_styles,
            plugins: system.plugins,
            fastModeState: system.fast_mode_state,
            fastModeDisabledReason: system.fast_mode_disabled_reason,
          },
        })
        break
      case 'hook_started':
        emit({
          type: 'hook_started',
          hook: {
            hookId: system.hook_id ?? '',
            hookName: system.hook_name ?? '',
            hookEvent: system.hook_event ?? '',
          },
        })
        break
      case 'hook_response':
        emit({
          type: 'hook_complete',
          hook: {
            hookId: system.hook_id ?? '',
            hookName: system.hook_name ?? '',
            hookEvent: system.hook_event ?? '',
            output: system.output ?? '',
            stdout: system.stdout,
            stderr: system.stderr,
            exitCode: system.exit_code,
            outcome: system.outcome ?? 'success',
          },
        })
        break
      case 'compact_boundary':
        emit({
          type: 'compact_boundary',
          trigger: system.compact_metadata?.trigger ?? 'auto',
          preTokens: system.compact_metadata?.pre_tokens ?? 0,
          postTokens: system.compact_metadata?.post_tokens,
          durationMs: system.compact_metadata?.duration_ms,
        })
        break
      case 'status':
        emit({
          type: 'status_indicator',
          indicator: system.status === 'compacting' ? 'compacting' : null,
          permissionMode: system.permissionMode,
          compactResult: system.compact_result,
          compactError: system.compact_error,
        })
        break
      case 'session_state_changed':
        if (system.state === 'idle') emit({ type: 'status_change', status: 'idle' })
        if (system.state === 'running' || system.state === 'requires_action') {
          emit({ type: 'status_change', status: 'streaming' })
        }
        break
      case 'task_started':
        if (system.task_id) {
          activeBackgroundTasks.set(system.task_id, {
            toolUseId: system.tool_use_id,
            description: system.description ?? '',
          })
        }
        emit({
          type: 'task_started',
          taskId: system.task_id ?? '',
          toolUseId: system.tool_use_id,
          description: system.description ?? '',
          taskType: system.task_type,
        })
        break
      case 'task_updated': {
        const status = system.patch?.status
        if (system.task_id && (status === 'completed' || status === 'failed' || status === 'killed')) {
          activeBackgroundTasks.delete(system.task_id)
          if ((status === 'failed' || status === 'killed') && system.tool_use_id) {
            emit({
              type: 'task_notification',
              taskId: system.task_id,
              toolUseId: system.tool_use_id,
              taskStatus: status === 'failed' ? 'failed' : 'stopped',
              outputFile: system.patch?.output_file ?? '',
              summary: system.patch?.summary,
            })
          }
          maybeEmitDeferredIdle()
        }
        break
      }
      case 'task_progress':
        emit({
          type: 'task_progress',
          taskId: system.task_id ?? '',
          toolUseId: system.tool_use_id,
          description: system.description ?? '',
          lastToolName: system.last_tool_name,
          summary: system.summary,
          usage: {
            totalTokens: system.usage?.total_tokens ?? 0,
            toolUses: system.usage?.tool_uses ?? 0,
            durationMs: system.usage?.duration_ms ?? 0,
          },
        })
        break
      case 'task_notification':
        if (system.task_id) activeBackgroundTasks.delete(system.task_id)
        emit({
          type: 'task_notification',
          taskId: system.task_id ?? '',
          toolUseId: system.tool_use_id,
          taskStatus: system.status ?? 'completed',
          outputFile: system.output_file ?? '',
          summary: system.summary,
          usage: system.usage ? {
            totalTokens: system.usage.total_tokens ?? 0,
            toolUses: system.usage.tool_uses ?? 0,
            durationMs: system.usage.duration_ms ?? 0,
          } : undefined,
        })
        maybeEmitDeferredIdle()
        break
      case 'background_tasks_changed':
        activeBackgroundTasks.clear()
        for (const task of system.tasks ?? []) {
          if (task?.task_id) {
            activeBackgroundTasks.set(task.task_id, { description: task.description ?? '' })
          }
        }
        maybeEmitDeferredIdle()
        break
      case 'hook_progress':
        emit({
          type: 'hook_progress',
          hook: {
            hookId: system.hook_id ?? '',
            hookName: system.hook_name ?? '',
            hookEvent: system.hook_event ?? '',
            stdout: system.stdout,
            stderr: system.stderr,
            output: system.output,
          },
        })
        break
      case 'files_persisted':
        emit({
          type: 'files_persisted',
          files: (system.files ?? []).map((file: Raw) => ({
            filename: file.filename,
            fileId: file.file_id,
          })),
          failed: (system.failed ?? []).map((file: Raw) => ({
            filename: file.filename,
            error: file.error,
          })),
          processedAt: system.processed_at ?? '',
        })
        break
      case 'elicitation_complete':
        emit({
          type: 'elicitation_complete',
          mcpServerName: system.mcp_server_name ?? '',
          elicitationId: system.elicitation_id ?? '',
        })
        break
      case 'api_retry':
        emit({
          type: 'api_retry',
          attempt: system.attempt ?? 1,
          maxRetries: system.max_retries ?? 3,
          delayMs: system.retry_delay_ms ?? 0,
        })
        break
      case 'model_fallback':
      case 'model_refusal_fallback':
        emit({
          type: 'model_fallback',
          trigger: typeof system.trigger === 'string' ? system.trigger : 'unknown',
          fromModel: system.original_model ?? system.from_model,
          toModel: system.fallback_model ?? system.to_model,
        })
        break
      case 'local_command_output':
        if (typeof system.content === 'string' && system.content) {
          emit({ type: 'slash_command_output', messageId, content: system.content })
        }
        break
    }
  }

  return {
    apply(message): ClaudeAgentEventApplyResult {
      const raw = message as Raw
      const sessionId = sessionIdOf(raw)
      const parentToolUseId = raw.parent_tool_use_id ?? null

      if (raw.type === 'user') {
        const content = raw.message?.content
        const isSynthetic = raw.isSynthetic === true
        const isReplay = raw.isReplay === true
        if (Array.isArray(content)) {
          let hasTopLevelToolResult = false
          for (const block of content) {
            if (block?.type !== 'tool_result' || !block.tool_use_id) continue
            emitToolResult(
              block.tool_use_id,
              block.content,
              block.is_error === true,
              raw.tool_use_result,
              parentToolUseId,
              { isSynthetic, isReplay },
            )
            if (!parentToolUseId) hasTopLevelToolResult = true
          }
          if (hasTopLevelToolResult) options.onStepBoundary?.()
        }
        if (!isReplay && typeof content === 'string' && content.includes('<local-command-stdout>')) {
          const text = content
            .replace(/<local-command-stdout>\n?/g, '')
            .replace(/<\/local-command-stdout>\n?/g, '')
            .trim()
          if (text) emit({ type: 'slash_command_output', messageId, content: text })
        }
        if (raw.uuid && !parentToolUseId) {
          if (isReplay) {
            lastReplayCheckpointId = raw.uuid
          } else {
            emit({
              type: 'checkpoint_captured',
              messageId,
              checkpointId: lastReplayCheckpointId || raw.uuid,
              resumePointId: lastTopLevelAssistantUuid,
            })
          }
        }
        return emptyResult(sessionId)
      }

      switch (raw.type) {
        case 'system':
          applySystem(raw)
          break
        case 'auth_status':
          emit({
            type: 'auth_status',
            isAuthenticating: raw.isAuthenticating ?? false,
            output: raw.output ?? [],
            error: raw.error,
          })
          break
        case 'assistant': {
          const assistantParent = raw.parent_tool_use_id ?? null
          const usage = raw.message?.usage
          if (usage) lastAssistantUsage = usage
          if (raw.error) lastAssistantTypedError = String(raw.error)
          if (!assistantParent) {
            lastTopLevelAssistantUuid = raw.uuid ?? ''
            if (!timestampApplied && typeof raw.timestamp === 'string' && raw.timestamp) {
              timestampApplied = true
              emit({ type: 'message_timestamp', messageId, timestamp: raw.timestamp })
            }
          }
          if (!assistantParent && usage) {
            const stepId = raw.message?.id ?? ''
            const isDupe = stepId && processedStepIds.has(stepId)
            if (!isDupe) {
              if (stepId) processedStepIds.add(stepId)
              messageInputTokens += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
            }
            emit({ type: 'message_usage', messageId, inputTokens: messageInputTokens, outputTokens: messageOutputTokens })
          }
          if (assistantParent && usage) {
            const tracker = subagentTracking.get(assistantParent) ?? {
              stepIds: new Set<string>(),
              input: 0,
              output: 0,
            }
            subagentTracking.set(assistantParent, tracker)
            const stepId = raw.message?.id ?? ''
            if (!stepId || !tracker.stepIds.has(stepId)) {
              if (stepId) tracker.stepIds.add(stepId)
              tracker.input += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
            }
            emit({ type: 'subagent_usage', messageId, parentToolUseId: assistantParent, inputTokens: tracker.input, outputTokens: tracker.output })
          }
          const blocks = Array.isArray(raw.message?.content) ? raw.message.content : []
          if (raw.message?.model === '<synthetic>' && !raw.error) {
            const text = blocks
              .filter((block: Raw) => block.type === 'text')
              .map((block: Raw) => block.text ?? '')
              .join('')
              .trim()
            if (text) pendingSlashOutput = pendingSlashOutput ? `${pendingSlashOutput}\n${text}` : text
          }
          for (const block of blocks) {
            if (block.type === 'text' && assistantParent && block.text) {
              emit({ type: 'content_delta', messageId, delta: { type: 'text', text: block.text, parentToolUseId: assistantParent } })
            } else if (block.type === 'thinking' && assistantParent && typeof block.thinking === 'string' && block.thinking) {
              const timestamp = now()
              emit({ type: 'content_delta', messageId, delta: { type: 'thinking', thinking: block.thinking, parentToolUseId: assistantParent, startedAt: timestamp, endedAt: timestamp } })
            } else if (block.type === 'tool_use') {
              const toolUseId = block.id ?? ''
              const toolName = block.name ?? 'unknown'
              toolIdToName.set(toolUseId, toolName)
              if (options.trackPlanFile && (toolName === 'Write' || toolName === 'Edit')) {
                const filePath = block.input?.file_path
                if (typeof filePath === 'string') options.trackPlanFile(filePath)
              }
              emit({
                type: 'content_delta',
                messageId,
                delta: {
                  type: 'tool_use',
                  toolName,
                  toolUseId,
                  input: stringifyInput(block.input),
                  parentToolUseId: assistantParent,
                },
              })
            }
          }
          break
        }
        case 'stream_event': {
          const event = raw.event
          if (!event) break
          const streamParent = raw.parent_tool_use_id ?? null
          if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            const toolUseId = event.content_block.id ?? ''
            const toolName = event.content_block.name ?? 'unknown'
            activeToolBlocks.set(event.index, toolUseId)
            toolIdToName.set(toolUseId, toolName)
            emit({ type: 'content_delta', messageId, delta: { type: 'tool_use', toolName, toolUseId, input: '', status: 'streaming', parentToolUseId: streamParent } })
          } else if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
            const timestamp = now()
            emit({ type: 'content_delta', messageId, delta: { type: 'thinking', thinking: '', parentToolUseId: streamParent, startedAt: timestamp, endedAt: timestamp } })
          } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              emit({ type: 'content_delta', messageId, delta: { type: 'text', text: event.delta.text, parentToolUseId: streamParent } })
              return { ...emptyResult(sessionId), textDelta: event.delta.text }
            }
            if (event.delta?.type === 'thinking_delta' && typeof event.delta.thinking === 'string') {
              emit({ type: 'content_delta', messageId, delta: { type: 'thinking', thinking: event.delta.thinking, parentToolUseId: streamParent, endedAt: now() } })
            } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
              emit({
                type: 'tool_input_delta',
                messageId,
                toolUseId: activeToolBlocks.get(event.index) ?? '',
                partialJson: event.delta.partial_json,
                parentToolUseId: streamParent,
              })
            }
          } else if (event.type === 'content_block_stop') {
            activeToolBlocks.delete(event.index)
          } else if (event.type === 'message_start') {
            emit({ type: 'stream_message_start', messageId, apiMessageId: event.message?.id ?? '', model: event.message?.model ?? '', parentToolUseId: streamParent })
          } else if (event.type === 'message_stop') {
            emit({ type: 'stream_message_stop', messageId, parentToolUseId: streamParent })
          } else if (event.type === 'message_delta' && event.usage?.output_tokens) {
            const outputTokens = event.usage.output_tokens as number
            if (!streamParent) {
              messageOutputTokens += outputTokens
              emit({ type: 'message_usage', messageId, inputTokens: messageInputTokens, outputTokens: messageOutputTokens })
            } else if (subagentTracking.has(streamParent)) {
              const tracker = subagentTracking.get(streamParent)!
              tracker.output += outputTokens
              emit({ type: 'subagent_usage', messageId, parentToolUseId: streamParent, inputTokens: tracker.input, outputTokens: tracker.output })
            }
          }
          break
        }
        case 'tool_progress': {
          const retry = raw.subagent_retry
          emit({
            type: 'tool_progress',
            messageId,
            toolUseId: raw.tool_use_id ?? '',
            toolName: raw.tool_name ?? '',
            elapsedSeconds: raw.elapsed_time_seconds ?? 0,
            parentToolUseId: raw.parent_tool_use_id ?? null,
            taskId: raw.task_id,
            subagentType: raw.subagent_type,
            subagentRetry: retry ? {
              agentId: retry.agent_id ?? '',
              attempt: retry.attempt ?? 0,
              maxRetries: retry.max_retries ?? 0,
              retryDelayMs: retry.retry_delay_ms ?? 0,
              errorStatus: retry.error_status ?? null,
              errorCategory: retry.error_category ?? '',
            } : undefined,
          })
          break
        }
        case 'tool_use_summary': {
          const summary = typeof raw.summary === 'string' ? raw.summary : ''
          if (summary) {
            const toolUseId = raw.preceding_tool_use_ids?.[0] ?? raw.tool_use_id ?? ''
            emitToolResult(toolUseId, summary, raw.is_error === true, raw.tool_use_result, raw.parent_tool_use_id ?? null)
          }
          break
        }
        case 'result': {
          if (lastReplayCheckpointId) {
            emit({ type: 'checkpoint_captured', messageId, checkpointId: lastReplayCheckpointId, resumePointId: lastTopLevelAssistantUuid })
            lastReplayCheckpointId = ''
          }
          const metadata = buildClaudeResultMetadata(
            raw,
            startedAt,
            options.pausedMs?.() ?? 0,
            lastAssistantUsage,
            now,
          )
          if (lastTopLevelAssistantUuid) metadata.forkAnchorId = lastTopLevelAssistantUuid
          const interrupted = options.isInterrupted?.() === true
          const resultIsError = raw.is_error === true || raw.subtype !== 'success'
          const rawError = resultErrorText(raw)
          const decoratedError = decorateMessageErrorText(rawError, lastAssistantTypedError, metadata.apiErrorStatus)
          if (interrupted) {
            emit({ type: 'message_interrupted', messageId, metadata })
            activeBackgroundTasks.clear()
          } else if (!resultIsError) {
            if (pendingSlashOutput) emit({ type: 'slash_command_output', messageId, content: pendingSlashOutput })
            emit({ type: 'message_complete', messageId, metadata })
          } else {
            // Hosts: if isResumeDropsTurnRefusal(error), clear fork target + full-resume only (never retry same args).
            emit({ type: 'message_error', messageId, error: decoratedError })
          }
          lastAssistantTypedError = undefined
          pendingSlashOutput = ''
          resultSeen = true
          options.onStepBoundary?.()
          emit({ type: 'status_change', status: activeBackgroundTasks.size === 0 ? 'idle' : 'background' })
          return {
            sessionId,
            textDelta: null,
            isResult: true,
            resultIsError,
            resultText: typeof raw.result === 'string' ? raw.result : null,
            resultError: resultIsError ? decoratedError : null,
          }
        }
        case 'prompt_suggestion':
          if (raw.suggestion) emit({ type: 'prompt_suggestion', suggestion: raw.suggestion })
          break
        case 'rate_limit_event': {
          const info = raw.rate_limit_info
          if (info) {
            emit({
              type: 'rate_limit',
              status: info.status,
              resetsAt: info.resetsAt,
              rateLimitType: info.rateLimitType,
              utilization: info.utilization,
              overageStatus: info.overageStatus,
              overageResetsAt: info.overageResetsAt,
              overageDisabledReason: info.overageDisabledReason,
              isUsingOverage: info.isUsingOverage,
              surpassedThreshold: info.surpassedThreshold,
              errorCode: info.errorCode,
              canUserPurchaseCredits: info.canUserPurchaseCredits,
              hasChargeableSavedPaymentMethod: info.hasChargeableSavedPaymentMethod,
            })
          }
          break
        }
      }
      return emptyResult(sessionId)
    },
  }
}
