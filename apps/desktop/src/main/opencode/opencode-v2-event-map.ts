import type {
  AgentEvent,
  AskUserQuestionRequest,
  MessageMetadata,
  PermissionRequest,
} from '@superone/shared/agent-types'
import { mapOpenCodePermissionRequest, openCodeToolName } from './opencode-event-map'
import type {
  OpenCodeV2Event,
  OpenCodeV2Form,
  OpenCodeV2FormField,
  OpenCodeV2FormValue,
  OpenCodeV2ModelRef,
  OpenCodeV2TokenUsage,
} from './opencode-v2-types'

/**
 * What one OpenCode 2.x event means for the active SuperOne turn. Chat content is
 * `agent`; the rest are turn-lifecycle and interaction steps the backend owns.
 */
export type OpenCodeV2TurnAction =
  | { type: 'agent'; event: AgentEvent }
  | { type: 'step_ended'; metadata: MessageMetadata; contextTokens: number }
  | { type: 'permission'; request: PermissionRequest; permission: string; toolInput: Record<string, unknown> | null }
  | { type: 'permission_resolved'; requestId: string; approved: boolean }
  | { type: 'question'; request: AskUserQuestionRequest }
  | { type: 'question_resolved'; requestId: string }
  | { type: 'compaction_started'; trigger: 'auto' | 'manual' }
  | { type: 'compacted'; trigger: 'auto' | 'manual' }
  | { type: 'compaction_failed'; error: string }
  | { type: 'complete'; interrupted: boolean }
  | { type: 'fail'; error: string }

/** Session id of a 2.x event; `form.created` nests it under `form`. */
export function openCodeV2EventSessionId(event: OpenCodeV2Event): string | undefined {
  const data = event.data as { sessionID?: unknown; form?: { sessionID?: unknown } } | undefined
  const sessionId = data?.sessionID ?? data?.form?.sessionID
  return typeof sessionId === 'string' ? sessionId : undefined
}

/** Fields shown as questions, in the order answers are given back. */
export function openCodeV2FormFields(form: OpenCodeV2Form): OpenCodeV2FormField[] {
  return form.fields.filter((field) => !field.hidden && field.type !== 'external')
}

const BOOLEAN_OPTIONS = [{ label: 'Yes', description: '' }, { label: 'No', description: '' }]

export function mapOpenCodeV2FormRequest(form: OpenCodeV2Form): AskUserQuestionRequest {
  return {
    requestId: form.id,
    questions: openCodeV2FormFields(form).map((field) => ({
      question: field.description || field.title || field.key,
      header: field.title || form.title,
      options: field.type === 'boolean'
        ? BOOLEAN_OPTIONS
        : (field.options ?? []).map((option) => ({ label: option.label, description: option.description ?? '' })),
      multiSelect: field.type === 'multiselect',
    })),
  }
}

/** `answers[i]` holds the selected labels (or typed text) for visible field `i`. */
export function openCodeV2FormAnswer(form: OpenCodeV2Form, answers: string[][]): Record<string, OpenCodeV2FormValue> {
  const result: Record<string, OpenCodeV2FormValue> = {}
  openCodeV2FormFields(form).forEach((field, index) => {
    const values = (answers[index] ?? []).map((label) =>
      field.options?.find((option) => option.label === label)?.value ?? label)
    const first = values[0]
    if (field.type === 'multiselect') {
      if (values.length > 0 || field.required) result[field.key] = values
    } else if (first === undefined || first === '') {
      if (field.required) result[field.key] = field.type === 'boolean' ? false : ''
    } else if (field.type === 'boolean') {
      result[field.key] = first === 'Yes'
    } else if (field.type === 'number' || field.type === 'integer') {
      result[field.key] = Number(first)
    } else {
      result[field.key] = first
    }
  })
  return result
}

function contextTokens(tokens: OpenCodeV2TokenUsage): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

function errorText(error: { message?: string; type?: string } | undefined, fallback: string): string {
  return error?.message?.trim() || error?.type || fallback
}

export interface OpenCodeV2TurnTranslatorOptions {
  contextWindow: (model: string) => number | undefined
}

/**
 * Stateful per turn: text arrives as `delta`s with a full-value `ended`, tools as
 * `input.started → called → success|failed`. `reset()` between turns; content
 * of assistant messages whose step started before the reset is dropped.
 *
 * Execution events carry no id and also fire for work outside a turn (clearing
 * a revert runs its own execution), so a terminal event only settles the turn
 * when its execution delivered an inbox item (prompt, command or compaction)
 * enqueued during the turn.
 */
export class OpenCodeV2TurnTranslator {
  private execution: 'none' | 'running' | 'owned' = 'none'
  private readonly turnInbox = new Set<string>()
  private readonly streamedText = new Map<string, string>()
  /** Stream key of the last text/thinking block emitted; null once a tool follows it. */
  private lastBlockKey: string | null = null
  private readonly reasoningStartedAt = new Map<string, number>()
  private readonly toolInputs = new Map<string, Record<string, unknown>>()
  private readonly toolNames = new Map<string, string>()
  private readonly completedTools = new Set<string>()
  private readonly steps = new Map<string, { agent: string; model: OpenCodeV2ModelRef }>()

  constructor(private readonly opts: OpenCodeV2TurnTranslatorOptions) {}

  reset(): void {
    this.execution = 'none'
    this.turnInbox.clear()
    this.streamedText.clear()
    this.lastBlockKey = null
    this.reasoningStartedAt.clear()
    this.toolInputs.clear()
    this.toolNames.clear()
    this.completedTools.clear()
    this.steps.clear()
  }

  /** `messageId` is the active SuperOne assistant message, or null between turns. */
  apply(event: OpenCodeV2Event, messageId: string | null): OpenCodeV2TurnAction[] {
    switch (event.type) {
      case 'permission.asked': {
        const data = event.data
        const callId = data.source?.id
        return [{
          type: 'permission',
          permission: data.action,
          toolInput: (callId && this.toolInputs.get(callId)) || null,
          request: mapOpenCodePermissionRequest({
            id: data.id,
            permission: data.action,
            patterns: data.resources,
            metadata: data.metadata,
            always: data.save,
            toolUseId: callId,
          }),
        }]
      }
      case 'permission.replied':
        return [{ type: 'permission_resolved', requestId: event.data.requestID, approved: event.data.reply !== 'reject' }]
      case 'form.created':
        return [{ type: 'question', request: mapOpenCodeV2FormRequest(event.data.form) }]
      case 'form.replied':
      case 'form.cancelled':
        return [{ type: 'question_resolved', requestId: event.data.id }]
      case 'session.compaction.started':
        return [{ type: 'compaction_started', trigger: event.data.reason }]
      case 'session.compaction.ended':
        return [{ type: 'compacted', trigger: event.data.reason }]
      case 'session.compaction.failed':
        return [{ type: 'compaction_failed', error: errorText(event.data.error, 'OpenCode compaction failed') }]
    }
    if (!messageId) return []
    return this.applyTurnEvent(event, messageId)
  }

  private applyTurnEvent(event: OpenCodeV2Event, messageId: string): OpenCodeV2TurnAction[] {
    // An interrupted turn's `ended` events can land after the next turn began.
    const assistantId = (event.data as { assistantMessageID?: unknown }).assistantMessageID
    if (typeof assistantId === 'string' && event.type !== 'session.step.started' && !this.steps.has(assistantId)) return []
    const agent = (agentEvent: AgentEvent): OpenCodeV2TurnAction => ({ type: 'agent', event: agentEvent })
    switch (event.type) {
      case 'session.execution.started':
        this.execution = 'running'
        return []
      case 'session.inbox.delivered':
        if (this.execution === 'running' && this.turnInbox.has(event.data.inboxID)) this.execution = 'owned'
        return []
      case 'session.execution.succeeded':
        return this.settle({ type: 'complete', interrupted: false })
      case 'session.execution.interrupted':
        return this.settle({ type: 'complete', interrupted: true })
      case 'session.execution.failed':
        return this.settle({ type: 'fail', error: errorText(event.data.error, 'OpenCode session failed') })
      case 'session.inbox.enqueued':
        this.turnInbox.add(event.data.inboxID)
        if (event.data.item.type !== 'user') return []
        return [agent({
          type: 'checkpoint_captured',
          messageId,
          checkpointId: event.data.inboxID,
          resumePointId: event.data.inboxID,
        })]
      case 'session.step.started':
        this.steps.set(event.data.assistantMessageID, { agent: event.data.agent, model: event.data.model })
        return []
      case 'session.step.ended':
        return this.stepEnded(event.data, messageId)
      case 'session.reasoning.started':
        this.reasoningStartedAt.set(this.textKey(event.data), event.created ?? Date.now())
        return []
      case 'session.text.delta':
      case 'session.reasoning.delta':
        return this.textDelta(event.type === 'session.reasoning.delta', event.data, event.data.delta, messageId)
      case 'session.text.ended':
      case 'session.reasoning.ended': {
        // `ended` carries the full value; emit whatever the live deltas missed.
        const reasoning = event.type === 'session.reasoning.ended'
        const streamed = this.streamedText.get(this.streamKey(reasoning, event.data)) ?? ''
        const rest = event.data.text.startsWith(streamed) ? event.data.text.slice(streamed.length) : ''
        return this.textDelta(reasoning, event.data, rest, messageId, reasoning ? event.created ?? Date.now() : undefined)
      }
      case 'session.tool.input.started':
        this.toolNames.set(event.data.id, event.data.name)
        return [agent(this.toolUse(messageId, event.data.id, '{}', 'streaming', event.created))]
      case 'session.tool.called':
        this.toolInputs.set(event.data.id, event.data.input)
        return [agent(this.toolUse(messageId, event.data.id, JSON.stringify(event.data.input), 'streaming'))]
      case 'session.tool.success':
      case 'session.tool.failed': {
        const id = event.data.id
        if (this.completedTools.has(id)) return []
        this.completedTools.add(id)
        const isError = event.type === 'session.tool.failed'
        const content = (event.data.content ?? [])
          .flatMap((item) => item.type === 'text' && item.text ? [item.text] : [])
          .join('\n')
        return [
          agent(this.toolUse(messageId, id, JSON.stringify(this.toolInputs.get(id) ?? {}), 'complete')),
          agent({
            type: 'content_delta',
            messageId,
            delta: {
              type: 'tool_result',
              toolUseId: id,
              summary: isError ? errorText(event.data.error, content || 'Tool failed') : content,
              isError,
            },
          }),
        ]
      }
      case 'session.shell.started': {
        const { shell } = event.data
        this.toolNames.set(shell.id, 'shell')
        this.toolInputs.set(shell.id, { command: shell.command })
        return [agent(this.toolUse(messageId, shell.id, JSON.stringify({ command: shell.command }), 'streaming', event.created))]
      }
      case 'session.shell.ended': {
        const { shell, output } = event.data
        // Only a shell started in this turn: an interrupted `!command` can end after the next turn began.
        if (!this.toolNames.has(shell.id) || this.completedTools.has(shell.id)) return []
        this.completedTools.add(shell.id)
        const actions: OpenCodeV2TurnAction[] = [
          agent(this.toolUse(messageId, shell.id, JSON.stringify({ command: shell.command }), 'complete')),
          agent({
            type: 'content_delta',
            messageId,
            delta: { type: 'tool_result', toolUseId: shell.id, summary: output.output, isError: shell.status !== 'exited' },
          }),
        ]
        // A `!command` turn runs the shell alone, without an execution.
        if (this.execution !== 'owned') actions.push({ type: 'complete', interrupted: false })
        return actions
      }
      case 'session.retry.scheduled':
        return [
          agent({ type: 'status_change', status: 'streaming' }),
          agent({
            type: 'api_retry',
            attempt: event.data.attempt,
            delayMs: Math.max(0, event.data.at - Date.now()),
            message: errorText(event.data.error, 'Retrying'),
          }),
        ]
      default:
        return []
    }
  }

  private settle(action: OpenCodeV2TurnAction): OpenCodeV2TurnAction[] {
    const owned = this.execution === 'owned'
    this.execution = 'none'
    return owned ? [action] : []
  }

  private textKey(data: { assistantMessageID: string; ordinal: number }): string {
    return `${data.assistantMessageID}:${data.ordinal}`
  }

  private streamKey(reasoning: boolean, data: { assistantMessageID: string; ordinal: number }): string {
    return `${reasoning ? 'r' : 't'}:${this.textKey(data)}`
  }

  /**
   * Empty deltas are dropped: after a text block, one would open an empty thinking
   * block. The one exception carries `endedAt` into the thinking block still open.
   */
  private textDelta(
    reasoning: boolean,
    data: { assistantMessageID: string; ordinal: number },
    delta: string,
    messageId: string,
    endedAt?: number,
  ): OpenCodeV2TurnAction[] {
    const key = this.streamKey(reasoning, data)
    if (!delta && (endedAt === undefined || this.lastBlockKey !== key)) return []
    this.lastBlockKey = key
    this.streamedText.set(key, `${this.streamedText.get(key) ?? ''}${delta}`)
    if (!reasoning) return [{ type: 'agent', event: { type: 'content_delta', messageId, delta: { type: 'text', text: delta } } }]
    const startedAt = this.reasoningStartedAt.get(this.textKey(data))
    return [{
      type: 'agent',
      event: {
        type: 'content_delta',
        messageId,
        delta: {
          type: 'thinking',
          thinking: delta,
          ...(startedAt !== undefined ? { startedAt } : {}),
          ...(endedAt !== undefined ? { endedAt } : {}),
        },
      },
    }]
  }

  private toolUse(
    messageId: string,
    id: string,
    input: string,
    status: 'streaming' | 'complete',
    startedAt?: number,
  ): AgentEvent {
    this.lastBlockKey = null
    return {
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_use',
        toolName: openCodeToolName(this.toolNames.get(id) ?? 'tool'),
        toolUseId: id,
        input,
        status,
        ...(startedAt ? { startedAt } : {}),
      },
    }
  }

  private stepEnded(
    data: { assistantMessageID: string; finish: string; cost: number; tokens: OpenCodeV2TokenUsage },
    messageId: string,
  ): OpenCodeV2TurnAction[] {
    const step = this.steps.get(data.assistantMessageID)
    const model = step ? `${step.model.providerID}/${step.model.id}` : undefined
    const total = contextTokens(data.tokens)
    return [
      {
        type: 'agent',
        event: {
          type: 'message_usage',
          messageId,
          inputTokens: data.tokens.input + data.tokens.cache.read + data.tokens.cache.write,
          outputTokens: data.tokens.output + data.tokens.reasoning,
          contextTokens: total,
          contextWindow: model ? this.opts.contextWindow(model) : undefined,
          costUsd: data.cost,
        },
      },
      {
        type: 'step_ended',
        contextTokens: total,
        metadata: {
          model,
          agent: step?.agent,
          costUsd: data.cost,
          usage: {
            inputTokens: data.tokens.input,
            outputTokens: data.tokens.output,
            cacheReadInputTokens: data.tokens.cache.read,
            cacheCreationInputTokens: data.tokens.cache.write,
          },
          stopReason: data.finish,
          forkAnchorId: data.assistantMessageID,
        },
      },
    ]
  }
}
