import {
  asArray,
  asString,
  canonicalizeToolArguments,
  extractReasoningFieldText,
  get,
  type JsonValue,
} from './helpers'
import { chatUsageToMessageUsage, messageIdFromChatId } from './response'

type InlineThinkMode = 'detecting' | 'reasoning' | 'text'

interface TextItemState {
  outputIndex?: number
  added: boolean
  done: boolean
}

interface ToolCallState {
  outputIndex?: number
  callId: string
  name: string
  arguments: string
  reasoningContent: string
  added: boolean
  done: boolean
}

function newTextItem(): TextItemState {
  return { added: false, done: false }
}

function newToolCall(): ToolCallState {
  return { callId: '', name: '', arguments: '', reasoningContent: '', added: false, done: false }
}

export function sseEvent(event: string, data: JsonValue): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export class ChatToMessagesState {
  private messageStarted = false
  private completed = false
  private responseId = 'msg_ccswitch'
  private model = ''
  private createdAt = 0
  private nextIndex = 0
  private text = newTextItem()
  private reasoning = newTextItem()
  private inlineMode: InlineThinkMode = 'detecting'
  private inlineBuffer = ''
  private tools = new Map<number, ToolCallState>()
  private outputItems: Array<[number, JsonValue]> = []
  private latestUsage: JsonValue | undefined
  private finishReason: string | undefined
  private inputTokens: number | undefined

  handleChatChunk(chunk: unknown): string[] {
    const events: string[] = []

    const id = asString(get(chunk, 'id'))
    if (id) this.responseId = messageIdFromChatId(id)
    const model = asString(get(chunk, 'model'))
    if (model) this.model = model
    const created = get(chunk, 'created')
    if (typeof created === 'number') this.createdAt = created

    events.push(...this.ensureStarted())

    const usage = get(chunk, 'usage')
    if (usage !== null && usage !== undefined) {
      this.latestUsage = chatUsageToMessageUsage(usage) as JsonValue
      const usageObj = asObject(usage)
      if (usageObj) {
        const inputTokens = typeof usageObj.prompt_tokens === 'number'
          ? usageObj.prompt_tokens
          : typeof usageObj.input_tokens === 'number'
            ? usageObj.input_tokens
            : undefined
        if (inputTokens !== undefined) this.inputTokens = inputTokens
      }
    }

    const choice = asArray(get(chunk, 'choices'))?.[0]
    if (choice === undefined) return events

    const delta = get(choice, 'delta')
    if (delta !== undefined) {
      const reasoning = extractReasoningFieldText(delta)
      if (reasoning) events.push(...this.pushReasoningDelta(reasoning))

      const content = asString(get(delta, 'content'))
      if (content) events.push(...this.pushContentDelta(content))

      const toolCalls = asArray(get(delta, 'tool_calls'))
      if (toolCalls) {
        events.push(...this.flushInlineThinkAtBoundary())
        const reasoningForTool = this.currentReasoningText()
        events.push(...this.finalizeReasoning())
        for (const toolCall of toolCalls) events.push(...this.pushToolCallDelta(toolCall, reasoningForTool))
      }
    }

    const finishReason = asString(get(choice, 'finish_reason'))
    if (finishReason) this.finishReason = finishReason

    return events
  }

  finalize(): string[] {
    if (this.completed) return []
    const events = [
      ...this.ensureStarted(),
      ...this.flushInlineThinkAtBoundary(),
      ...this.finalizeReasoning(),
      ...this.finalizeText(),
      ...this.finalizeTools(),
    ]
    const stopReason = stopReasonFromFinishReason(this.finishReason)
    const response = this.baseResponse(stopReason, this.completedOutputItems())
    events.push(sseEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: this.latestUsage ?? { input_tokens: this.inputTokens ?? 0, output_tokens: 0, total_tokens: 0 },
    }))
    events.push(sseEvent('message_stop', { type: 'message_stop' }))
    this.completed = true
    return events
  }

  failedEvent(message: string, errorType?: string): string {
    this.completed = true
    const error: Record<string, JsonValue> = { message }
    if (errorType) error.type = errorType
    const response = this.baseResponse('failed', this.completedOutputItems())
    response.error = error
    return sseEvent('message_stop', { type: 'message_stop', response })
  }

  private ensureStarted(): string[] {
    if (this.messageStarted) return []
    this.messageStarted = true
    const usage: JsonValue = {
      input_tokens: this.inputTokens ?? 0,
      output_tokens: 0,
    }
    return [
      sseEvent('message_start', {
        type: 'message_start',
        message: this.baseMessage(usage),
      }),
    ]
  }

  private pushContentDelta(delta: string): string[] {
    if (this.inlineMode === 'text') {
      return [...this.finalizeReasoning(), ...this.pushTextDelta(delta)]
    }
    if (this.inlineMode === 'detecting') {
      this.inlineBuffer += delta
      const decision = leadingThinkPrefixDecision(this.inlineBuffer)
      if (decision === 'need_more') return []
      if (decision === 'reasoning') {
        this.inlineMode = 'reasoning'
        return this.drainCompleteInlineThink()
      }
      this.inlineMode = 'text'
      const text = this.inlineBuffer
      this.inlineBuffer = ''
      return [...this.finalizeReasoning(), ...this.pushTextDelta(text)]
    }
    this.inlineBuffer += delta
    return this.drainCompleteInlineThink()
  }

  private drainCompleteInlineThink(): string[] {
    const split = splitLeadingThinkBlock(this.inlineBuffer)
    if (!split) return []
    this.inlineMode = 'text'
    this.inlineBuffer = ''
    const events: string[] = []
    if (split.reasoning) {
      events.push(...this.pushReasoningDelta(split.reasoning))
      events.push(...this.finalizeReasoning())
    }
    if (split.answer) events.push(...this.pushTextDelta(split.answer))
    return events
  }

  private flushInlineThinkAtBoundary(): string[] {
    if (this.inlineMode === 'text') return []
    if (this.inlineMode === 'detecting') {
      this.inlineMode = 'text'
      const text = this.inlineBuffer
      this.inlineBuffer = ''
      if (!text) return []
      return [...this.finalizeReasoning(), ...this.pushTextDelta(text)]
    }
    const buffered = this.inlineBuffer
    this.inlineBuffer = ''
    this.inlineMode = 'text'
    const split = splitLeadingThinkBlock(buffered)
    if (split) {
      const events: string[] = []
      if (split.reasoning) {
        events.push(...this.pushReasoningDelta(split.reasoning))
        events.push(...this.finalizeReasoning())
      }
      if (split.answer) events.push(...this.pushTextDelta(split.answer))
      return events
    }
    const reasoning = stripLeadingThinkOpenTag(buffered) ?? buffered
    if (!reasoning) return []
    return [...this.pushReasoningDelta(reasoning), ...this.finalizeReasoning()]
  }

  private pushReasoningDelta(delta: string): string[] {
    const events: string[] = []
    if (!this.reasoning.added) {
      const outputIndex = this.allocIndex()
      this.reasoning.outputIndex = outputIndex
      this.reasoning.added = true
      events.push(
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: outputIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }),
      )
    }
    events.push(
      sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: this.reasoning.outputIndex ?? 0,
        delta: { type: 'thinking_delta', thinking: delta },
      }),
    )
    return events
  }

  private pushTextDelta(delta: string): string[] {
    const events: string[] = []
    if (!this.text.added) {
      const outputIndex = this.allocIndex()
      this.text.outputIndex = outputIndex
      this.text.added = true
      events.push(
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: outputIndex,
          content_block: { type: 'text', text: '' },
        }),
      )
    }
    events.push(
      sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: this.text.outputIndex ?? 0,
        delta: { type: 'text_delta', text: delta },
      }),
    )
    return events
  }

  private currentReasoningText(): string | undefined {
    return undefined
  }

  private pushToolCallDelta(toolCall: unknown, reasoning: string | undefined): string[] {
    const chatIndex = typeof get(toolCall, 'index') === 'number' ? (get(toolCall, 'index') as number) : 0
    const idDelta = asString(get(toolCall, 'id'))
    const fn = get(toolCall, 'function')
    const nameDelta = asString(get(fn, 'name'))
    const argsDelta = asString(get(fn, 'arguments')) ?? ''

    let state = this.tools.get(chatIndex)
    if (!state) {
      state = newToolCall()
      this.tools.set(chatIndex, state)
    }
    if (idDelta) state.callId = idDelta
    if (nameDelta) state.name = nameDelta
    if (argsDelta) state.arguments += argsDelta
    if (!state.reasoningContent && reasoning?.trim()) state.reasoningContent = reasoning.trim()

    const events: string[] = []

    if (!state.added && (state.callId || state.name)) {
      const assigned = this.allocIndex()
      state.added = true
      if (!state.callId) state.callId = `call_${chatIndex}`
      if (!state.name) state.name = 'unknown_tool'
      state.outputIndex = assigned
      events.push(
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: assigned,
          content_block: {
            type: 'tool_use',
            id: state.callId,
            name: state.name,
            input: {},
          },
        }),
      )
      if (state.arguments) {
        events.push(
          sseEvent('content_block_delta', {
            type: 'content_block_delta',
            index: assigned,
            delta: { type: 'input_json_delta', partial_json: state.arguments },
          }),
        )
      }
    } else if (state.added && argsDelta) {
      events.push(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: state.outputIndex ?? 0,
          delta: { type: 'input_json_delta', partial_json: argsDelta },
        }),
      )
    }

    return events
  }

  private finalizeReasoning(): string[] {
    if (!this.reasoning.added || this.reasoning.done) return []
    const outputIndex = this.reasoning.outputIndex ?? 0
    const text = ''
    const item: JsonValue = { type: 'thinking', thinking: text, signature: '' }
    this.outputItems.push([outputIndex, item])
    this.reasoning.done = true
    return [
      sseEvent('content_block_stop', { type: 'content_block_stop', index: outputIndex }),
    ]
  }

  private finalizeText(): string[] {
    if (!this.text.added || this.text.done) return []
    const outputIndex = this.text.outputIndex ?? 0
    const text = ''
    const item: JsonValue = { type: 'text', text, annotations: [] }
    this.outputItems.push([outputIndex, item])
    this.text.done = true
    return [
      sseEvent('content_block_stop', { type: 'content_block_stop', index: outputIndex }),
    ]
  }

  private finalizeTools(): string[] {
    const events: string[] = []
    for (const [key, state] of [...this.tools.entries()].sort((a, b) => a[0] - b[0])) {
      if (state.done) continue
      if (!state.added) {
        const assigned = this.allocIndex()
        state.added = true
        if (!state.callId) state.callId = `call_${key}`
        if (!state.name) state.name = 'unknown_tool'
        state.outputIndex = assigned
        events.push(
          sseEvent('content_block_start', {
            type: 'content_block_start',
            index: assigned,
            content_block: {
              type: 'tool_use',
              id: state.callId,
              name: state.name,
              input: {},
            },
          }),
        )
      }
      const outputIndex = state.outputIndex ?? 0
      const args = canonicalizeToolArguments(state.arguments || '')
      const item: JsonValue = {
        type: 'tool_use',
        id: state.callId,
        name: state.name,
        input: safeJsonParse(args),
      }
      state.done = true
      this.outputItems.push([outputIndex, item])
      events.push(
        sseEvent('content_block_stop', { type: 'content_block_stop', index: outputIndex }),
      )
    }
    return events
  }

  private completedOutputItems(): JsonValue[] {
    return [...this.outputItems].sort((a, b) => a[0] - b[0]).map(([, item]) => item)
  }

  private baseMessage(usage: JsonValue): Record<string, JsonValue> {
    return {
      id: this.responseId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: this.model,
      usage,
    }
  }

  private baseResponse(status: string, output: JsonValue[]): Record<string, JsonValue> {
    return {
      id: this.responseId,
      type: 'message',
      role: 'assistant',
      content: output,
      model: this.model,
      stop_reason: status,
      stop_sequence: null,
      usage: this.latestUsage ?? { input_tokens: this.inputTokens ?? 0, output_tokens: 0, total_tokens: 0 },
    }
  }

  private allocIndex(): number {
    return this.nextIndex++
  }
}

function stopReasonFromFinishReason(finishReason: string | undefined): string {
  switch (finishReason) {
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'content_filter':
      return 'end_turn'
    case 'stop':
    default:
      return 'end_turn'
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function safeJsonParse(text: string): JsonValue {
  try {
    return JSON.parse(text)
  } catch {
    return {} as JsonValue
  }
}

type ThinkDecision = 'need_more' | 'reasoning' | 'text'

function leadingThinkPrefixDecision(buffer: string): ThinkDecision {
  const trimmed = buffer.trimStart()
  if (!trimmed) return 'need_more'
  const thinkOpen = '<think>'
  if (trimmed.startsWith(thinkOpen)) return 'reasoning'
  if (thinkOpen.startsWith(trimmed)) return 'need_more'
  return 'text'
}

function splitLeadingThinkBlock(text: string): { reasoning: string; answer: string } | undefined {
  const thinkOpen = '<think>'
  const thinkClose = '</think>'
  const afterWs = text.trimStart()
  if (!afterWs.startsWith(thinkOpen)) return undefined
  const body = afterWs.slice(thinkOpen.length)
  const closeIdx = body.indexOf(thinkClose)
  if (closeIdx < 0) return undefined
  return {
    reasoning: body.slice(0, closeIdx).trim(),
    answer: body.slice(closeIdx + thinkClose.length).replace(/^[\r\n\t ]+/, ''),
  }
}

function stripLeadingThinkOpenTag(text: string): string | undefined {
  const thinkOpen = '<think>'
  const afterWs = text.trimStart()
  if (!afterWs.startsWith(thinkOpen)) return undefined
  return afterWs.slice(thinkOpen.length).trim()
}

function extractChatSseError(value: unknown): { message: string; errorType?: string } {
  const error = get(value, 'error') ?? value
  const message =
    asString(error) ??
    asString(get(error, 'message')) ??
    asString(get(error, 'detail')) ??
    JSON.stringify(error)
  const errorType = asString(get(error, 'type')) ?? asString(get(error, 'code'))
  return { message, errorType: errorType ?? undefined }
}

function stripSseField(line: string, field: string): string | undefined {
  if (!line.startsWith(field)) return undefined
  const rest = line.slice(field.length)
  if (rest.startsWith(':')) return rest.slice(1).replace(/^ /, '')
  if (rest === '') return ''
  return undefined
}

export function feedSseBlock(state: ChatToMessagesState, block: string): { events: string[]; failed: boolean } {
  let eventName: string | undefined
  const dataParts: string[] = []
  for (const line of block.split(/\r?\n/)) {
    const ev = stripSseField(line, 'event')
    if (ev !== undefined) eventName = ev.trim()
    const data = stripSseField(line, 'data')
    if (data !== undefined) dataParts.push(data)
  }
  if (dataParts.length === 0) return { events: [], failed: false }

  const data = dataParts.join('\n')
  if (data.trim() === '[DONE]') return { events: state.finalize(), failed: false }

  let chunk: unknown
  try {
    chunk = JSON.parse(data)
  } catch {
    return { events: [], failed: false }
  }

  if (eventName === 'error' || get(chunk, 'error') !== undefined) {
    const { message, errorType } = extractChatSseError(chunk)
    return { events: [state.failedEvent(message, errorType)], failed: true }
  }

  return { events: state.handleChatChunk(chunk), failed: false }
}

export function createMessagesSseStreamFromChat(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = upstream.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const state = new ChatToMessagesState()
  let buffer = ''
  let failed = false

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) {
            if (!failed) for (const ev of state.finalize()) controller.enqueue(encoder.encode(ev))
            controller.close()
            return
          }
          buffer += decoder.decode(value, { stream: true })
          let sep: number
          while ((sep = indexOfBlockSeparator(buffer)) >= 0) {
            const block = buffer.slice(0, sep).trim()
            buffer = buffer.slice(sep).replace(/^(\r?\n){2}/, '')
            if (!block) continue
            const { events, failed: blockFailed } = feedSseBlock(state, block)
            for (const ev of events) controller.enqueue(encoder.encode(ev))
            if (blockFailed) {
              failed = true
              controller.close()
              await reader.cancel().catch(() => {})
              return
            }
          }
        }
      } catch (err) {
        controller.enqueue(encoder.encode(state.failedEvent(`Stream error: ${String(err)}`, 'stream_error')))
        controller.close()
      }
    },
    async cancel() {
      await reader.cancel().catch(() => {})
    },
  })
}

function indexOfBlockSeparator(buffer: string): number {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf < 0) return crlf
  if (crlf < 0) return lf
  return Math.min(lf, crlf)
}

export function convertChatSseText(input: string): string {
  const state = new ChatToMessagesState()
  const out: string[] = []
  for (const raw of input.split(/\r?\n\r?\n/)) {
    const block = raw.trim()
    if (!block) continue
    const { events, failed } = feedSseBlock(state, block)
    out.push(...events)
    if (failed) return out.join('')
  }
  out.push(...state.finalize())
  return out.join('')
}
