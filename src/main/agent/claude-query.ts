import { query, type CanUseTool, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, MessageMetadata, PermissionMode, SendMessageRequest } from '../../shared/agent-types'
import type { MessageBridge } from './message-bridge'

export interface SessionQueryOptions {
  cwd: string
  model?: string
  permissionMode: PermissionMode
  canUseTool: CanUseTool
  resume?: string
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
      includePartialMessages: true,
      permissionMode: options.permissionMode,
      allowDangerouslySkipPermissions: options.permissionMode === 'bypassPermissions',
      canUseTool: options.canUseTool,
      enableFileCheckpointing: true,
      settingSources: ['user', 'project', 'local'],
      resume: options.resume,
    },
  })

  const iterationDone = iterateMessages(q, emit, getCurrentMessageId, getCurrentStartTime, getInterrupted, onSessionId)

  return { query: q, iterationDone }
}

/** Build an SDKUserMessage from a SendMessageRequest. */
export function buildUserMessage(request: SendMessageRequest, sessionId: string): SDKUserMessage {
  let content: unknown

  if (request.images?.length) {
    const blocks: Array<Record<string, unknown>> = request.images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
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
  onSessionId?: (id: string) => void
): Promise<void> {
  // Track content_block index → tool_use_id for input_json_delta correlation
  const activeToolBlocks = new Map<number, string>()

  try {
    for await (const msg of q) {
      const messageId = getCurrentMessageId()

      // Slash command output arrives as a user message with <local-command-stdout> wrapper
      if (msg.type === 'user') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userMsg = msg as any
        const raw = typeof userMsg.message?.content === 'string'
          ? userMsg.message.content
          : ''
        if (raw.includes('<local-command-stdout>')) {
          const text = raw
            .replace(/<local-command-stdout>\n?/g, '')
            .replace(/<\/local-command-stdout>\n?/g, '')
            .trim()
          if (text) {
            emit({ type: 'slash_command_output', messageId, content: text })
          }
        }
      }

      switch (msg.type) {
        case 'system': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sys = msg as any
          if (sys.subtype === 'init') {
            // Note: The SDK does not yield the init message through the async iterator.
            // Use query.initializationResult() (control channel) for init data instead.
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
          } else if (sys.subtype === 'task_notification') {
            emit({
              type: 'task_notification',
              taskId: sys.task_id ?? '',
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
          const content = msg.message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use') {
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
                  },
                })
              }
            }
          }
          break
        }

        case 'stream_event': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const event = (msg as any).event
          if (!event) break

          if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            // Track index → toolUseId for input_json_delta correlation
            activeToolBlocks.set(event.index, event.content_block.id ?? '')
            emit({
              type: 'content_delta',
              messageId,
              delta: {
                type: 'tool_use',
                toolName: event.content_block.name ?? 'unknown',
                toolUseId: event.content_block.id ?? '',
                input: '',
                status: 'streaming',
              },
            })
          } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              emit({
                type: 'content_delta',
                messageId,
                delta: { type: 'text', text: event.delta.text },
              })
            } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
              const toolUseId = activeToolBlocks.get(event.index) ?? ''
              emit({
                type: 'tool_input_delta',
                messageId,
                toolUseId,
                partialJson: event.delta.partial_json,
              })
            }
          } else if (event.type === 'content_block_stop') {
            activeToolBlocks.delete(event.index)
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
          })
          break
        }

        case 'tool_use_summary': {
          const summary = msg as { summary?: string; preceding_tool_use_ids?: string[] }
          if (summary.summary) {
            const toolUseId = summary.preceding_tool_use_ids?.[0] ?? ''
            emit({
              type: 'content_delta',
              messageId,
              delta: { type: 'tool_result', toolUseId, summary: summary.summary },
            })
          }
          break
        }

        case 'result': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = msg as any
          const metadata = buildResultMetadata(result, getCurrentStartTime())

          // Emit result text (e.g. slash command output) as content before completing
          if (result.result && typeof result.result === 'string') {
            emit({
              type: 'content_delta',
              messageId,
              delta: { type: 'text', text: result.result },
            })
          }

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
function buildResultMetadata(result: any, startTime: number): MessageMetadata {
  const metadata: MessageMetadata = {
    durationMs: Date.now() - startTime,
    costUsd: result.total_cost_usd,
    numTurns: result.num_turns,
    stopReason: result.stop_reason ?? null,
  }

  if (result.usage) {
    metadata.usage = {
      inputTokens: result.usage.input_tokens ?? 0,
      outputTokens: result.usage.output_tokens ?? 0,
      cacheReadInputTokens: result.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: result.usage.cache_creation_input_tokens ?? 0,
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
