import type { AgentEvent, SlashCommandInfo } from '@superone/shared/agent-types'
import type { SessionConfigOption, SessionUpdate } from '@agentclientprotocol/sdk'
import { readArgumentHintFromMarkdownFile } from '@superone/runtime/fs'
import { extractModeConfig, extractModelConfig } from './config-map'
import { isHiddenAcpPermissionSlashCommand } from './slash-filter'
import {
  extractEmbeddedTerminalId,
  queryFromWebSearchRawOutput,
  textFromContent,
  toolUseBlock,
} from './tool-normalization'
import { shouldEmitToolUseUpdate, toolResultFromUpdate } from './tool-result-map'
import {
  mapXaiStandaloneNotification,
  noteContextTokensFromMeta,
  noteContextWindow,
} from './xai-event-map'
import {
  createXaiCorrelationState,
  noteToolCorrelationFromAgentEvents,
} from './xai-state'

export interface AcpMapContext {
  messageId: string
}

function mapPlanToTodoEvents(messageId: string, entries: Array<{ content?: string; status?: string; priority?: string }>): AgentEvent[] {
  const todos = entries
    .filter((e) => typeof e.content === 'string' && e.content.trim())
    .map((e) => {
      const status =
        e.status === 'completed' || e.status === 'in_progress' || e.status === 'pending'
          ? e.status
          : 'pending'
      const item: { content: string; status: string; activeForm?: string } = {
        content: e.content!.trim(),
        status,
      }
      if (status === 'in_progress') item.activeForm = e.content!.trim()
      return item
    })
  const toolUseId = `acp-plan:${messageId}`
  const input = JSON.stringify({ todos })
  return [
    {
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_use',
        toolName: 'TodoWrite',
        toolUseId,
        input,
        status: 'complete',
      },
    },
    {
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_result',
        toolUseId,
        summary: `Plan: ${todos.filter((t) => t.status === 'completed').length}/${todos.length}`,
        isError: false,
      },
    },
  ]
}

export interface MapSessionUpdateOptions {
  /** Resolve command line for an embedded terminal id (for Bash UI). */
  resolveTerminalCommand?: (terminalId: string) => string | undefined
  /** Resolve live/final terminal output for tool_result summary. */
  resolveTerminalOutput?: (terminalId: string) => string | undefined
  /** Called when a tool_use embeds a terminal, so runtime can bind streaming. */
  onTerminalEmbedded?: (terminalId: string, toolUseId: string) => void
}

/** Map one ACP session update into zero or more SuperOne AgentEvents. */
export function mapSessionUpdate(
  update: SessionUpdate,
  ctx: AcpMapContext,
  opts?: MapSessionUpdateOptions,
): AgentEvent[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content = update.content
      if (content?.type === 'text') {
        const text = textFromContent(content)
        if (!text) return []
        return [{
          type: 'content_delta',
          messageId: ctx.messageId,
          delta: { type: 'text', text },
        }]
      }
      if (content?.type === 'image' && typeof content.data === 'string') {
        // Surface as markdown data-uri text so chat still shows something without a dedicated image block path.
        const mime = typeof content.mimeType === 'string' ? content.mimeType : 'image/png'
        return [{
          type: 'content_delta',
          messageId: ctx.messageId,
          delta: { type: 'text', text: `\n![image](data:${mime};base64,${content.data})\n` },
        }]
      }
      return []
    }
    case 'agent_thought_chunk': {
      const text = textFromContent(update.content)
      if (!text) return []
      return [{
        type: 'content_delta',
        messageId: ctx.messageId,
        delta: { type: 'thinking', thinking: text },
      }]
    }
    case 'tool_call':
    case 'tool_call_update': {
      const terminalId = extractEmbeddedTerminalId(update.content)
      const terminalCommand = terminalId ? opts?.resolveTerminalCommand?.(terminalId) : undefined
      const terminalOutput = terminalId ? opts?.resolveTerminalOutput?.(terminalId) : undefined
      if (terminalId) {
        opts?.onTerminalEmbedded?.(terminalId, update.toolCallId)
      }

      const events: AgentEvent[] = []
      const wantUse =
        update.sessionUpdate === 'tool_call'
        || shouldEmitToolUseUpdate(update)
      if (wantUse) {
        const block = toolUseBlock(update, { terminalCommand })
        if (block) {
          events.push({
            type: 'content_delta',
            messageId: ctx.messageId,
            delta: block,
          })
        }
      }
      if (update.sessionUpdate === 'tool_call_update') {
        // Backend web_search never puts query on raw_input; backfill from raw_output on complete.
        const webQuery = queryFromWebSearchRawOutput(update.rawOutput)
        if (webQuery) {
          events.push({
            type: 'content_delta',
            messageId: ctx.messageId,
            delta: {
              type: 'tool_use',
              toolName: 'WebSearch',
              toolUseId: update.toolCallId,
              input: JSON.stringify({ query: webQuery }),
              toolSummary: webQuery,
              status:
                update.status === 'completed' || update.status === 'failed'
                  ? 'complete'
                  : 'streaming',
            },
          })
        }
        const result = toolResultFromUpdate(update, terminalOutput)
        if (result) {
          events.push({
            type: 'content_delta',
            messageId: ctx.messageId,
            delta: result,
          })
        }
      }
      return events
    }
    case 'plan': {
      return mapPlanToTodoEvents(ctx.messageId, update.entries ?? [])
    }
    case 'usage_update': {
      // ACP usage_update is context occupancy (used/size), not turn billing in/out.
      const used = typeof (update as { used?: number }).used === 'number' ? (update as { used: number }).used : null
      const size = typeof (update as { size?: number }).size === 'number' ? (update as { size: number }).size : null
      if (used == null) return []
      const cost = (update as { cost?: { amount?: number; currency?: string } | null }).cost
      const costUsd =
        cost && typeof cost.amount === 'number' && (cost.currency === 'USD' || !cost.currency)
          ? cost.amount
          : undefined
      return [{
        type: 'message_usage',
        messageId: ctx.messageId,
        inputTokens: 0,
        outputTokens: 0,
        contextTokens: used,
        ...(size != null ? { contextWindow: size } : {}),
        ...(costUsd != null ? { costUsd } : {}),
      }]
    }
    case 'config_option_update': {
      const configOptions = (update as { configOptions?: SessionConfigOption[] }).configOptions
      if (!configOptions?.length) return []
      const events: AgentEvent[] = []
      const models = extractModelConfig(configOptions)
      if (models) {
        events.push({
          type: 'acp_models',
          models: models.models,
          selectedModelId: models.selectedModelId,
          configId: models.configId,
          status: 'ready',
        })
      }
      const modes = extractModeConfig(configOptions)
      if (modes) {
        events.push({
          type: 'acp_modes',
          modes: modes.modes,
          selectedModeId: modes.selectedModeId,
          configId: modes.configId,
          status: 'ready',
        })
      }
      return events
    }
    case 'available_commands_update': {
      const raw = (update as { availableCommands?: unknown[] }).availableCommands
      if (!Array.isArray(raw)) return []
      const commands: SlashCommandInfo[] = []
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const c = item as {
          name?: string
          description?: string
          input?: { hint?: string } | null
          _meta?: { path?: string; workflowSource?: string; workflowPath?: string } | null
        }
        if (typeof c.name !== 'string' || !c.name.trim()) continue
        const name = c.name.replace(/^\//, '').trim()
        if (!name) continue
        // Host owns permission baseline via the status-bar selector — hide Grok's
        // /always-approve so users don't have two competing controls.
        if (isHiddenAcpPermissionSlashCommand(name)) continue
        let hint =
          c.input && typeof c.input === 'object' && typeof c.input.hint === 'string'
            ? c.input.hint.trim()
            : ''
        // Grok only advertises input.hint for skills that use `argument-hint:`.
        // Skills that still use Claude's `arguments:` send input:null — re-read
        // the skill path when present so SuperOne's slash menu supports both keys.
        if (!hint && c._meta && typeof c._meta === 'object' && typeof c._meta.path === 'string') {
          hint = readArgumentHintFromMarkdownFile(c._meta.path)
        }
        const isSkill = Boolean(
          c._meta && typeof c._meta === 'object' && typeof c._meta.path === 'string' &&
          /SKILL\.md$/i.test(c._meta.path),
        )
        const workflowSource =
          c._meta && typeof c._meta === 'object' && typeof c._meta.workflowSource === 'string'
            ? c._meta.workflowSource
            : undefined
        const workflowPath =
          c._meta && typeof c._meta === 'object' && typeof c._meta.workflowPath === 'string'
            ? c._meta.workflowPath
            : undefined
        const isWorkflow = Boolean(workflowSource) || Boolean(workflowPath)
          || (typeof c.description === 'string' && /^Workflow:\s/i.test(c.description))
        commands.push({
          name,
          description: typeof c.description === 'string' ? c.description : '',
          argumentHint: hint,
          isSkill,
          ...(isWorkflow
            ? {
                isWorkflow: true,
                workflowSource: workflowSource ?? 'workflow',
                ...(workflowPath ? { workflowPath } : {}),
              }
            : {}),
        })
      }
      return [{ type: 'acp_commands', commands }]
    }
    default:
      return []
  }
}

export interface AcpAgentEventMapperOptions extends MapSessionUpdateOptions {
  messageId: string
  emit: (event: AgentEvent) => void
  now?: () => number
  /** Session cwd — resolves Grok child chat_history.jsonl paths. */
  cwd?: string
}

export function mapStopReason(stopReason: string): { complete: boolean; interrupted: boolean } {
  if (stopReason === 'cancelled') return { complete: false, interrupted: true }
  return { complete: true, interrupted: false }
}

export interface AcpAgentEventApplyResult {
  textDelta: string | null
}

export interface AcpAgentEventMapper {
  start(providerSessionId?: string | null): void
  apply(update: SessionUpdate, notificationMeta?: Record<string, unknown> | null): AcpAgentEventApplyResult
  applyXaiNotification(method: string, params: Record<string, unknown>): void
  complete(stopReason?: string): void
  fail(error: string, interrupted?: boolean): void
}

/** Track open tools so cancellation can close every streaming block. */
export function trackOpenAcpTools(open: Set<string>, events: AgentEvent[]): void {
  for (const event of events) {
    if (event.type !== 'content_delta') continue
    if (event.delta.type === 'tool_use' && event.delta.status !== 'complete') {
      open.add(event.delta.toolUseId)
    }
    if (
      event.delta.type === 'tool_use'
      && event.delta.status === 'complete'
      && event.delta.toolName === 'TodoWrite'
    ) {
      open.delete(event.delta.toolUseId)
    }
    if (event.delta.type === 'tool_result') open.delete(event.delta.toolUseId)
  }
}

export function cancelOpenAcpTools(messageId: string, open: Set<string>): AgentEvent[] {
  const events: AgentEvent[] = []
  for (const toolUseId of open) {
    events.push({
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_use',
        toolName: 'tool',
        toolUseId,
        input: '{}',
        status: 'complete',
      },
    })
    events.push({
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_result',
        toolUseId,
        summary: 'cancelled',
        isError: true,
      },
    })
  }
  open.clear()
  return events
}

export function getAcpAgentChunkMessageId(update: SessionUpdate): string | null {
  if (update.sessionUpdate !== 'agent_message_chunk' && update.sessionUpdate !== 'agent_thought_chunk') {
    return null
  }
  const messageId = (update as { messageId?: string | null }).messageId
  return typeof messageId === 'string' && messageId.trim() ? messageId : null
}

/**
 * Stateful ACP turn projection matching the desktop runtime/back-end contract.
 * Native message ids may split a prompt into multiple assistant bubbles.
 */
export function createAcpAgentEventMapper(
  options: AcpAgentEventMapperOptions,
): AcpAgentEventMapper {
  const now = options.now ?? Date.now
  const nativeToLocal = new Map<string, string>()
  const localMessageIds = new Set<string>([options.messageId])
  const openTools = new Set<string>()
  const xaiCorrelation = createXaiCorrelationState(
    options.cwd ? { cwd: options.cwd } : undefined,
  )
  let currentMessageId = options.messageId
  let started = false
  let terminal = false

  const emitMessageStart = (messageId: string) => {
    options.emit({
      type: 'message_start',
      message: {
        id: messageId,
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date(now()).toISOString(),
        providerId: 'acp',
      },
    })
  }

  const fail = (error: string, interrupted = false) => {
    if (terminal) return
    terminal = true
    if (interrupted) {
      for (const event of cancelOpenAcpTools(currentMessageId, openTools)) options.emit(event)
    }
    for (const messageId of localMessageIds) {
      options.emit(interrupted
        ? { type: 'message_interrupted', messageId }
        : { type: 'message_error', messageId, error })
    }
    options.emit({ type: 'status_change', status: interrupted ? 'idle' : 'error' })
  }

  return {
    start(providerSessionId) {
      if (started) return
      started = true
      emitMessageStart(options.messageId)
      options.emit({ type: 'status_change', status: 'streaming' })
      if (providerSessionId) {
        options.emit({ type: 'provider_session_id', providerSessionId })
      }
    },
    apply(update, notificationMeta) {
      const nativeMessageId = getAcpAgentChunkMessageId(update)
      if (nativeMessageId) {
        const existing = nativeToLocal.get(nativeMessageId)
        if (existing) {
          currentMessageId = existing
        } else if (nativeToLocal.size === 0) {
          nativeToLocal.set(nativeMessageId, options.messageId)
          currentMessageId = options.messageId
        } else {
          const nextId = `acp_msg_${now().toString(36)}_${nativeToLocal.size}`
          nativeToLocal.set(nativeMessageId, nextId)
          localMessageIds.add(nextId)
          currentMessageId = nextId
          emitMessageStart(nextId)
        }
      }

      const previousContextTokens = xaiCorrelation.lastUsage?.totalTokens ?? 0
      noteContextTokensFromMeta(xaiCorrelation, notificationMeta)
      const nextContextTokens = xaiCorrelation.lastUsage?.totalTokens ?? 0
      const events = mapSessionUpdate(update, { messageId: currentMessageId }, options)
      for (const event of events) {
        if (event.type !== 'acp_models') continue
        const selected = event.models.find((model) => model.id === event.selectedModelId)
        if (selected?.contextWindow) noteContextWindow(xaiCorrelation, selected.contextWindow)
      }
      if (nextContextTokens > 0 && nextContextTokens !== previousContextTokens) {
        const contextWindow = xaiCorrelation.lastUsage?.maxTokens ?? 0
        events.push({
          type: 'message_usage',
          messageId: currentMessageId,
          inputTokens: 0,
          outputTokens: 0,
          contextTokens: nextContextTokens,
          ...(contextWindow > 0 ? { contextWindow } : {}),
        })
      }
      trackOpenAcpTools(openTools, events)
      const migrate = noteToolCorrelationFromAgentEvents(events, xaiCorrelation)
      let textDelta = ''
      for (const event of events) {
        if (
          event.type === 'content_delta'
          && event.delta.type === 'text'
          && !event.delta.parentToolUseId
        ) {
          textDelta += event.delta.text
        }
        options.emit(event)
      }
      for (const event of migrate) options.emit(event)
      return { textDelta: textDelta || null }
    },
    applyXaiNotification(method, params) {
      const events = mapXaiStandaloneNotification(
        method,
        params,
        xaiCorrelation,
        { messageId: currentMessageId },
      )
      trackOpenAcpTools(openTools, events)
      const migrate = noteToolCorrelationFromAgentEvents(events, xaiCorrelation)
      for (const event of events) options.emit(event)
      for (const event of migrate) options.emit(event)
    },
    complete(stopReason = 'end_turn') {
      if (terminal) return
      const mapped = mapStopReason(stopReason)
      if (mapped.interrupted) {
        fail('ACP turn interrupted', true)
        return
      }
      terminal = true
      for (const messageId of localMessageIds) {
        options.emit({ type: 'message_complete', messageId })
      }
      options.emit({ type: 'status_change', status: 'idle' })
    },
    fail,
  }
}
