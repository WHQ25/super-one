import { query, type CanUseTool, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, MessageMetadata, PermissionMode, SandboxInfo, SendMessageRequest } from '../../shared/agent-types'
import type { MessageBridge } from './message-bridge'
import log from '../logger'

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
  onSessionId?: (id: string) => void
): SessionQueryHandle {
  const q = query({
    prompt: bridge,
    options: {
      cwd: options.cwd,
      model: options.model,
      effort: options.effort,
      promptSuggestions: true,
      includePartialMessages: true,
      permissionMode: options.permissionMode,
      allowDangerouslySkipPermissions: options.permissionMode === 'bypassPermissions',
      canUseTool: options.canUseTool,
      sandbox: options.sandboxInfo?.enabled
        ? { enabled: true, autoAllowBashIfSandboxed: options.sandboxInfo.autoAllowBash }
        : undefined,
      enableFileCheckpointing: true,
      extraArgs: { 'replay-user-messages': null },
      settingSources: ['user', 'project', 'local'],
      resume: options.resume,
      resumeSessionAt: options.resumeSessionAt,
      forkSession: options.forkSession,
      sessionId: options.sessionId,
      abortController: options.abortController,
      additionalDirectories: options.additionalDirectories,
      stderr: (data: string) => log.warn('[claude-cli]', data.trimEnd()),
    },
  })

  const iterationDone = iterateMessages(q, emit, getCurrentMessageId, getCurrentStartTime, getInterrupted, onSessionId, options.trackPlanFile)

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
    blocks.push({ type: 'text', text: request.content })
    content = blocks
  } else {
    content = request.content
  }

  return {
    type: 'user' as const,
    message: { role: 'user' as const, content },
    parent_tool_use_id: null,
    session_id: sessionId,
  } as SDKUserMessage
}

/** Continuously iterate SDK messages, mapping them to AgentEvents. */
async function iterateMessages(
  q: Query,
  emit: (event: AgentEvent) => void,
  getCurrentMessageId: () => string,
  getCurrentStartTime: () => number,
  getInterrupted: () => boolean,
  onSessionId?: (id: string) => void,
  trackPlanFile?: (filePath: string) => void
): Promise<void> {
  // Track content_block index → tool_use_id for input_json_delta correlation
  const activeToolBlocks = new Map<number, string>()
  // Track tool_use_id → tool_name so we can tag tool_result events
  const toolIdToName = new Map<string, string>()
  // Track the last assistant message's usage (= current context window snapshot)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastAssistantUsage: any = null
  // Track the most recent top-level assistant message UUID for resumeSessionAt
  let lastTopLevelAssistantUuid = ''
  // Per-step dedup: track processed step IDs (SDK message IDs) and accumulate tokens
  const processedStepIds = new Set<string>()
  let messageInputTokens = 0
  let messageOutputTokens = 0
  let lastTrackedMessageId = ''
  // Subagent token accumulation per parent_tool_use_id
  const subagentTracking = new Map<string, { stepIds: Set<string>; input: number; output: number }>()

  try {
    for await (const msg of q) {
      const messageId = getCurrentMessageId()

      // User messages carry tool results and slash command output
      if (msg.type === 'user') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userMsg = msg as any
        const parentToolUseId = userMsg.parent_tool_use_id ?? null
        const msgContent = userMsg.message?.content

        // Extract tool_result blocks from array content
        if (Array.isArray(msgContent)) {
          for (const block of msgContent) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const text = extractToolResultText(block.content)
              if (text) {
                emit({
                  type: 'content_delta',
                  messageId,
                  delta: {
                    type: 'tool_result',
                    toolUseId: block.tool_use_id,
                    summary: text,
                    parentToolUseId,
                  },
                })
              }
            }
          }
        }

        // Slash command output arrives as a string with <local-command-stdout> wrapper
        const raw = typeof msgContent === 'string' ? msgContent : ''
        if (raw.includes('<local-command-stdout>')) {
          const text = raw
            .replace(/<local-command-stdout>\n?/g, '')
            .replace(/<\/local-command-stdout>\n?/g, '')
            .trim()
          if (text) {
            emit({ type: 'slash_command_output', messageId, content: text })
          }
        }

        // Capture file checkpoint UUID from top-level user messages
        const uuid = userMsg.uuid as string | undefined
        if (uuid && !userMsg.parent_tool_use_id) {
          emit({ type: 'checkpoint_captured', messageId, checkpointId: uuid, resumePointId: lastTopLevelAssistantUuid })
        }
      }

      switch (msg.type) {
        case 'system': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sys = msg as any
          if (sys.subtype === 'init') {
            if (sys.session_id) onSessionId?.(sys.session_id)
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
            })
          } else if (sys.subtype === 'task_started') {
            emit({
              type: 'task_started',
              taskId: sys.task_id ?? '',
              toolUseId: sys.tool_use_id,
              description: sys.description ?? '',
              taskType: sys.task_type,
            })
          } else if (sys.subtype === 'task_notification') {
            emit({
              type: 'task_notification',
              taskId: sys.task_id ?? '',
              toolUseId: sys.tool_use_id,
              taskStatus: sys.status ?? 'completed',
              outputFile: sys.output_file ?? '',
            })
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
          // Capture per-API-call usage for context window tracking
          if (msg.message?.usage) lastAssistantUsage = msg.message.usage
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const assistantParent = (msg as any).parent_tool_use_id ?? null

          if (!assistantParent) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lastTopLevelAssistantUuid = (msg as any).uuid ?? ''
          }

          // Track top-level message usage (per-step accumulation, deduped by SDK message ID)
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

          // Track subagent token usage (per-step accumulation, deduped by SDK message ID)
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

          const content = msg.message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'thinking' && block.thinking) {
                emit({
                  type: 'content_delta',
                  messageId,
                  delta: {
                    type: 'thinking',
                    thinking: block.thinking,
                    parentToolUseId: assistantParent,
                  },
                })
              }
              if (block.type === 'tool_use') {
                toolIdToName.set(block.id ?? '', block.name ?? 'unknown')

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
          } else if (event.type === 'message_delta' && event.usage?.output_tokens) {
            // message_delta fires at end of streaming with final output_tokens for this step
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
          })
          break
        }

        case 'tool_use_summary': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = msg as any
          const summaryText = raw.summary as string | undefined
          if (summaryText) {
            const toolUseId = raw.preceding_tool_use_ids?.[0] ?? raw.tool_use_id ?? ''
            emit({
              type: 'content_delta',
              messageId,
              delta: { type: 'tool_result', toolUseId, summary: summaryText, parentToolUseId: raw.parent_tool_use_id ?? null },
            })
          }
          break
        }

        case 'result': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = msg as any
          const metadata = buildResultMetadata(result, getCurrentStartTime(), lastAssistantUsage)

          if (getInterrupted()) {
            emit({ type: 'message_interrupted', messageId, metadata })
          } else if (result.subtype === 'success') {
            emit({ type: 'message_complete', messageId, metadata })
          } else {
            const errorMsg = result.errors?.join('; ') ?? 'Unknown error'
            emit({ type: 'message_error', messageId, error: errorMsg })
          }

          // Turn complete — signal idle until next user message
          emit({ type: 'status_change', status: 'idle' })
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
      }
    }
  } catch (err) {
    const messageId = getCurrentMessageId()
    if (getInterrupted()) {
      emit({ type: 'message_interrupted', messageId, metadata: { durationMs: Date.now() - getCurrentStartTime() } })
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
function buildResultMetadata(result: any, startTime: number, lastAssistantUsage?: any): MessageMetadata {
  const metadata: MessageMetadata = {
    durationMs: Date.now() - startTime,
    costUsd: result.total_cost_usd,
    numTurns: result.num_turns,
    stopReason: result.stop_reason ?? null,
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
