import {
  asArray,
  asObject,
  asString,
  canonicalizeToolArguments,
  extractReasoningFieldText,
  get,
  splitLeadingThinkBlock,
  type JsonValue,
} from './helpers'

export function chatCompletionToMessage(body: unknown): Record<string, unknown> {
  const choices = asArray(get(body, 'choices'))
  if (!choices) throw new Error('No choices in chat response')
  const choice = choices[0]
  if (choice === undefined) throw new Error('Empty choices in chat response')
  const message = get(choice, 'message')
  if (message === undefined) throw new Error('No message in chat choice')

  const messageId = messageIdFromChatId(asString(get(body, 'id')))
  const model = asString(get(body, 'model')) ?? ''
  const createdAt = typeof get(body, 'created') === 'number' ? (get(body, 'created') as number) : 0
  const finishReason = asString(get(choice, 'finish_reason'))

  const reasoning = chatReasoningText(message)
  const output: Record<string, unknown>[] = []

  const reasoningItem = chatReasoningToOutputItem(reasoning, messageId)
  if (reasoningItem) output.push(reasoningItem)

  const messageItem = chatMessageToOutputItem(message, messageId)
  if (messageItem) output.push(messageItem)

  output.push(...chatToolCallsToOutputItems(message))

  const response: Record<string, unknown> = {
    id: messageId,
    type: 'message',
    role: 'assistant',
    content: output,
    model,
    stop_reason: stopReasonFromFinishReason(finishReason),
    stop_sequence: null,
    usage: chatUsageToMessageUsage(get(body, 'usage')),
  }

  return response
}

function chatReasoningToOutputItem(reasoning: string | undefined, messageId: string): Record<string, unknown> | undefined {
  if (!reasoning) return undefined
  return {
    type: 'thinking',
    thinking: reasoning,
    signature: '',
  }
}

function chatReasoningText(message: unknown): string | undefined {
  const field = extractReasoningFieldText(message)
  if (field) return field
  const content = asString(get(message, 'content'))
  if (content) {
    const split = splitLeadingThinkBlock(content)
    if (split && split.reasoning) return split.reasoning
  }
  return undefined
}

function chatMessageToOutputItem(message: unknown, messageId: string): Record<string, unknown> | undefined {
  const content: Record<string, JsonValue>[] = []

  const text = asString(get(message, 'content'))
  if (text !== undefined) {
    const answer = splitLeadingThinkBlock(text)?.answer ?? text
    if (answer) content.push({ type: 'text', text: answer, annotations: [] })
  } else {
    const parts = asArray(get(message, 'content'))
    if (parts) {
      for (const part of parts) {
        const partType = asString(get(part, 'type')) ?? ''
        if (partType === 'text' || partType === 'output_text') {
          const t = asString(get(part, 'text'))
          if (t) content.push({ type: 'text', text: t, annotations: [] })
        } else if (partType === 'refusal') {
          const t = asString(get(part, 'refusal'))
          if (t) content.push({ type: 'text', text: t, annotations: [] })
        }
      }
    }
  }

  if (content.length === 0) return undefined
  const allText = content.map((c) => (c as Record<string, JsonValue>).text as string).join('\n')
  return {
    type: 'text',
    text: allText,
    annotations: [],
  }
}

function chatToolCallsToOutputItems(message: unknown): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = []
  const toolCalls = asArray(get(message, 'tool_calls'))
  if (toolCalls) {
    toolCalls.forEach((toolCall, index) => output.push(chatToolCallToOutputItem(toolCall, index)))
  } else {
    const functionCall = get(message, 'function_call')
    if (functionCall !== undefined) output.push(chatLegacyFunctionCallToOutputItem(functionCall))
  }
  return output
}

function chatToolCallToOutputItem(toolCall: unknown, index: number): Record<string, unknown> {
  const callId = asString(get(toolCall, 'id'))?.trim() || `call_${index}`
  const fn = get(toolCall, 'function')
  const name = asString(get(fn, 'name')) ?? ''
  const args = canonicalizeToolArguments(get(fn, 'arguments'))
  return {
    type: 'tool_use',
    id: callId,
    name,
    input: safeJsonParse(args),
  }
}

function chatLegacyFunctionCallToOutputItem(functionCall: unknown): Record<string, unknown> {
  const callId = asString(get(functionCall, 'id'))?.trim() || 'call_0'
  const name = asString(get(functionCall, 'name')) ?? ''
  const args = canonicalizeToolArguments(get(functionCall, 'arguments'))
  return {
    type: 'tool_use',
    id: callId,
    name,
    input: safeJsonParse(args),
  }
}

export function chatUsageToMessageUsage(usage: unknown): Record<string, unknown> {
  const obj = asObject(usage)
  if (!obj) return { input_tokens: 0, output_tokens: 0, total_tokens: 0 }

  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
  const inputTokens = num(obj.prompt_tokens) ?? num(obj.input_tokens) ?? 0
  const outputTokens = num(obj.completion_tokens) ?? num(obj.output_tokens) ?? 0
  const totalTokens = num(obj.total_tokens) ?? inputTokens + outputTokens

  const result: Record<string, unknown> = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  }

  const cached =
    num(get(get(obj, 'prompt_tokens_details'), 'cached_tokens')) ??
    num(get(get(obj, 'input_tokens_details'), 'cached_tokens'))
  if (cached !== undefined) result.cache_read_input_tokens = cached

  const cacheCreation = num(obj.cache_creation_input_tokens)
  if (cacheCreation !== undefined) result.cache_creation_input_tokens = cacheCreation

  return result
}

export function messageIdFromChatId(id: string | undefined): string {
  const value = id ?? 'ccswitch'
  return value.startsWith('msg_') ? value : `msg_${value}`
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

export function chatErrorToMessageError(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) {
    return {
      type: 'error',
      error: { type: 'upstream_error', message: 'Upstream returned an empty error response' },
    }
  }
  const str = asString(body)
  if (str !== undefined) {
    return { type: 'error', error: { type: 'upstream_error', message: str } }
  }

  const source = get(body, 'error') ?? body

  const message =
    asString(get(source, 'message')) ??
    asString(get(source, 'detail')) ??
    asString(get(source, 'status_msg')) ??
    asString(get(get(source, 'base_resp'), 'status_msg')) ??
    asString(source) ??
    safeStringify(source)

  const errorType = asString(get(source, 'type')) ?? 'upstream_error'

  return {
    type: 'error',
    error: { type: errorType, message },
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return 'Upstream error'
  }
}

function safeJsonParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
