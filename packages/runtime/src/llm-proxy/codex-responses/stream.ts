import {
  asArray,
  asString,
  canonicalizeToolArguments,
  extractReasoningFieldText,
  get,
  splitLeadingThinkBlock,
  stripLeadingThinkOpenTag,
  type JsonValue,
} from './helpers'
import { chatUsageToResponsesUsage, responseIdFromChatId } from './response'

type InlineThinkMode = 'detecting' | 'reasoning' | 'text'

interface TextItemState {
  outputIndex?: number
  itemId: string
  text: string
  added: boolean
  done: boolean
}

interface ToolCallState {
  outputIndex?: number
  itemId: string
  callId: string
  name: string
  arguments: string
  reasoningContent: string
  added: boolean
  done: boolean
}

function newTextItem(): TextItemState {
  return { itemId: '', text: '', added: false, done: false }
}

function newToolCall(): ToolCallState {
  return { itemId: '', callId: '', name: '', arguments: '', reasoningContent: '', added: false, done: false }
}

export function sseEvent(event: string, data: JsonValue): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export class ChatToResponsesState {
  private responseStarted = false
  private completed = false
  private responseId = 'resp_ccswitch'
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

  handleChatChunk(chunk: unknown): string[] {
    const events: string[] = []

    const id = asString(get(chunk, 'id'))
    if (id) this.responseId = responseIdFromChatId(id)
    const model = asString(get(chunk, 'model'))
    if (model) this.model = model
    const created = get(chunk, 'created')
    if (typeof created === 'number') this.createdAt = created

    events.push(...this.ensureStarted())

    const usage = get(chunk, 'usage')
    if (usage !== null && usage !== undefined) this.latestUsage = chatUsageToResponsesUsage(usage) as JsonValue

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
    const status = this.finishReason === 'length' ? 'incomplete' : 'completed'
    const response = this.baseResponse(status, this.completedOutputItems())
    if (status === 'incomplete') response.incomplete_details = { reason: 'max_output_tokens' }
    events.push(sseEvent('response.completed', { type: 'response.completed', response }))
    this.completed = true
    return events
  }

  failedEvent(message: string, errorType?: string): string {
    this.completed = true
    const error: Record<string, JsonValue> = { message }
    if (errorType) error.type = errorType
    const response = this.baseResponse('failed', this.completedOutputItems())
    response.error = error
    return sseEvent('response.failed', { type: 'response.failed', response })
  }

  private ensureStarted(): string[] {
    if (this.responseStarted) return []
    this.responseStarted = true
    return [
      sseEvent('response.created', { type: 'response.created', response: this.baseResponse('in_progress', []) }),
      sseEvent('response.in_progress', { type: 'response.in_progress', response: this.baseResponse('in_progress', []) }),
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
      this.reasoning.itemId = `rs_${this.responseId}`
      this.reasoning.added = true
      events.push(
        sseEvent('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: outputIndex,
          item: { id: this.reasoning.itemId, type: 'reasoning', status: 'in_progress', summary: [] },
        }),
      )
      events.push(
        sseEvent('response.reasoning_summary_part.added', {
          type: 'response.reasoning_summary_part.added',
          item_id: this.reasoning.itemId,
          output_index: outputIndex,
          summary_index: 0,
          part: { type: 'summary_text', text: '' },
        }),
      )
    }
    this.reasoning.text += delta
    events.push(
      sseEvent('response.reasoning_summary_text.delta', {
        type: 'response.reasoning_summary_text.delta',
        item_id: this.reasoning.itemId,
        output_index: this.reasoning.outputIndex ?? 0,
        summary_index: 0,
        delta,
      }),
    )
    return events
  }

  private pushTextDelta(delta: string): string[] {
    const events: string[] = []
    if (!this.text.added) {
      const outputIndex = this.allocIndex()
      this.text.outputIndex = outputIndex
      this.text.itemId = `${this.responseId}_msg`
      this.text.added = true
      events.push(
        sseEvent('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: outputIndex,
          item: { id: this.text.itemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
        }),
      )
      events.push(
        sseEvent('response.content_part.added', {
          type: 'response.content_part.added',
          item_id: this.text.itemId,
          output_index: outputIndex,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        }),
      )
    }
    this.text.text += delta
    events.push(
      sseEvent('response.output_text.delta', {
        type: 'response.output_text.delta',
        item_id: this.text.itemId,
        output_index: this.text.outputIndex ?? 0,
        content_index: 0,
        delta,
      }),
    )
    return events
  }

  private currentReasoningText(): string | undefined {
    const trimmed = this.reasoning.text.trim()
    return trimmed ? trimmed : undefined
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
      state.itemId = `fc_${state.callId}`
      events.push(
        sseEvent('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: assigned,
          item: functionCallItem(state.itemId, 'in_progress', state.callId, state.name, '', state.reasoningContent),
        }),
      )
      if (state.arguments) {
        events.push(
          sseEvent('response.function_call_arguments.delta', {
            type: 'response.function_call_arguments.delta',
            item_id: state.itemId,
            output_index: assigned,
            delta: state.arguments,
          }),
        )
      }
    } else if (state.added && argsDelta) {
      events.push(
        sseEvent('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: state.itemId,
          output_index: state.outputIndex ?? 0,
          delta: argsDelta,
        }),
      )
    }

    return events
  }

  private finalizeReasoning(): string[] {
    if (!this.reasoning.added || this.reasoning.done) return []
    const outputIndex = this.reasoning.outputIndex ?? 0
    const text = this.reasoning.text
    const item: JsonValue = { id: this.reasoning.itemId, type: 'reasoning', summary: [{ type: 'summary_text', text }] }
    this.outputItems.push([outputIndex, item])
    this.reasoning.done = true
    return [
      sseEvent('response.reasoning_summary_text.done', {
        type: 'response.reasoning_summary_text.done',
        item_id: this.reasoning.itemId,
        output_index: outputIndex,
        summary_index: 0,
        text,
      }),
      sseEvent('response.reasoning_summary_part.done', {
        type: 'response.reasoning_summary_part.done',
        item_id: this.reasoning.itemId,
        output_index: outputIndex,
        summary_index: 0,
        part: { type: 'summary_text', text },
      }),
      sseEvent('response.output_item.done', { type: 'response.output_item.done', output_index: outputIndex, item }),
    ]
  }

  private finalizeText(): string[] {
    if (!this.text.added || this.text.done) return []
    const outputIndex = this.text.outputIndex ?? 0
    const text = this.text.text
    const item: JsonValue = {
      id: this.text.itemId,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    }
    this.outputItems.push([outputIndex, item])
    this.text.done = true
    return [
      sseEvent('response.output_text.done', {
        type: 'response.output_text.done',
        item_id: this.text.itemId,
        output_index: outputIndex,
        content_index: 0,
        text,
      }),
      sseEvent('response.content_part.done', {
        type: 'response.content_part.done',
        item_id: this.text.itemId,
        output_index: outputIndex,
        content_index: 0,
        part: { type: 'output_text', text, annotations: [] },
      }),
      sseEvent('response.output_item.done', { type: 'response.output_item.done', output_index: outputIndex, item }),
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
        state.itemId = `fc_${state.callId}`
        events.push(
          sseEvent('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: assigned,
            item: functionCallItem(state.itemId, 'in_progress', state.callId, state.name, '', state.reasoningContent),
          }),
        )
      }
      const outputIndex = state.outputIndex ?? 0
      const args = canonicalizeToolArguments(state.arguments || '')
      const item = functionCallItem(state.itemId, 'completed', state.callId, state.name, args, state.reasoningContent)
      state.done = true
      this.outputItems.push([outputIndex, item])
      events.push(
        sseEvent('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          item_id: state.itemId,
          output_index: outputIndex,
          arguments: args,
        }),
      )
      events.push(sseEvent('response.output_item.done', { type: 'response.output_item.done', output_index: outputIndex, item }))
    }
    return events
  }

  private completedOutputItems(): JsonValue[] {
    return [...this.outputItems].sort((a, b) => a[0] - b[0]).map(([, item]) => item)
  }

  private baseResponse(status: string, output: JsonValue[]): Record<string, JsonValue> {
    return {
      id: this.responseId,
      object: 'response',
      created_at: this.createdAt,
      status,
      model: this.model,
      output,
      usage: this.latestUsage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    }
  }

  private allocIndex(): number {
    return this.nextIndex++
  }
}

function functionCallItem(
  itemId: string,
  status: string,
  callId: string,
  name: string,
  args: string,
  reasoning: string,
): JsonValue {
  const item: Record<string, JsonValue> = {
    id: itemId,
    type: 'function_call',
    status,
    call_id: callId,
    name,
    arguments: args,
  }
  if (reasoning.trim()) item.reasoning_content = reasoning.trim()
  return item
}

type ThinkDecision = 'need_more' | 'reasoning' | 'text'

function leadingThinkPrefixDecision(buffer: string): ThinkDecision {
  const trimmed = buffer.trimStart()
  if (!trimmed) return 'need_more'
  if (trimmed.startsWith('<think>')) return 'reasoning'
  if ('<think>'.startsWith(trimmed)) return 'need_more'
  return 'text'
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

export function feedSseBlock(state: ChatToResponsesState, block: string): { events: string[]; failed: boolean } {
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

export function createResponsesSseStreamFromChat(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = upstream.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const state = new ChatToResponsesState()
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
  const state = new ChatToResponsesState()
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
