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

export function chatCompletionToResponse(body: unknown): Record<string, unknown> {
  const choices = asArray(get(body, 'choices'))
  if (!choices) throw new Error('No choices in chat response')
  const choice = choices[0]
  if (choice === undefined) throw new Error('Empty choices in chat response')
  const message = get(choice, 'message')
  if (message === undefined) throw new Error('No message in chat choice')

  const responseId = responseIdFromChatId(asString(get(body, 'id')))
  const model = asString(get(body, 'model')) ?? ''
  const createdAt = typeof get(body, 'created') === 'number' ? (get(body, 'created') as number) : 0
  const finishReason = asString(get(choice, 'finish_reason'))

  const reasoning = chatReasoningText(message)
  const output: Record<string, unknown>[] = []
  const reasoningItem = chatReasoningToOutputItem(reasoning, responseId)
  if (reasoningItem) output.push(reasoningItem)
  const messageItem = chatMessageToOutputItem(message, responseId)
  if (messageItem) output.push(messageItem)
  output.push(...chatToolCallsToOutputItems(message, reasoning))

  const response: Record<string, unknown> = {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: responseStatusFromFinishReason(finishReason),
    model,
    output,
    usage: chatUsageToResponsesUsage(get(body, 'usage')),
  }
  if (finishReason === 'length') response.incomplete_details = { reason: 'max_output_tokens' }

  return response
}

function chatReasoningToOutputItem(reasoning: string | undefined, responseId: string): Record<string, unknown> | undefined {
  if (!reasoning) return undefined
  return {
    id: `rs_${responseId}`,
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: reasoning }],
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

function chatMessageToOutputItem(message: unknown, responseId: string): Record<string, unknown> | undefined {
  const content: Record<string, JsonValue>[] = []

  const text = asString(get(message, 'content'))
  if (text !== undefined) {
    const answer = splitLeadingThinkBlock(text)?.answer ?? text
    if (answer) content.push({ type: 'output_text', text: answer, annotations: [] })
  } else {
    const parts = asArray(get(message, 'content'))
    if (parts) {
      for (const part of parts) {
        const partType = asString(get(part, 'type')) ?? ''
        if (partType === 'text' || partType === 'output_text') {
          const t = asString(get(part, 'text'))
          if (t) content.push({ type: 'output_text', text: t, annotations: [] })
        } else if (partType === 'refusal') {
          const t = asString(get(part, 'refusal'))
          if (t) content.push({ type: 'refusal', refusal: t })
        }
      }
    }
  }

  const refusal = asString(get(message, 'refusal'))
  if (refusal) content.push({ type: 'refusal', refusal })

  if (content.length === 0) return undefined
  return {
    id: `${responseId}_msg`,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content,
  }
}

function chatToolCallsToOutputItems(message: unknown, reasoning: string | undefined): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = []
  const toolCalls = asArray(get(message, 'tool_calls'))
  if (toolCalls) {
    toolCalls.forEach((toolCall, index) => output.push(chatToolCallToOutputItem(toolCall, index, reasoning)))
  } else {
    const functionCall = get(message, 'function_call')
    if (functionCall !== undefined) output.push(chatLegacyFunctionCallToOutputItem(functionCall, reasoning))
  }
  return output
}

function functionCallItem(
  itemId: string,
  callId: string,
  name: string,
  args: string,
  reasoning: string | undefined,
): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: itemId,
    type: 'function_call',
    status: 'completed',
    call_id: callId,
    name,
    arguments: args,
  }
  if (reasoning?.trim()) item.reasoning_content = reasoning.trim()
  return item
}

function chatToolCallToOutputItem(toolCall: unknown, index: number, reasoning: string | undefined): Record<string, unknown> {
  const callId = asString(get(toolCall, 'id'))?.trim() || `call_${index}`
  const fn = get(toolCall, 'function')
  const name = asString(get(fn, 'name')) ?? ''
  const args = canonicalizeToolArguments(get(fn, 'arguments'))
  return functionCallItem(`fc_${callId}`, callId, name, args, reasoning)
}

function chatLegacyFunctionCallToOutputItem(functionCall: unknown, reasoning: string | undefined): Record<string, unknown> {
  const callId = asString(get(functionCall, 'id'))?.trim() || 'call_0'
  const name = asString(get(functionCall, 'name')) ?? ''
  const args = canonicalizeToolArguments(get(functionCall, 'arguments'))
  return functionCallItem(`fc_${callId}`, callId, name, args, reasoning)
}

export function chatUsageToResponsesUsage(usage: unknown): Record<string, unknown> {
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
  if (cached !== undefined) result.input_tokens_details = { cached_tokens: cached }

  if (obj.completion_tokens_details !== undefined) result.output_tokens_details = obj.completion_tokens_details
  if (obj.cache_read_input_tokens !== undefined) result.cache_read_input_tokens = obj.cache_read_input_tokens
  if (obj.cache_creation_input_tokens !== undefined) result.cache_creation_input_tokens = obj.cache_creation_input_tokens

  return result
}

export function responseIdFromChatId(id: string | undefined): string {
  const value = id ?? 'ccswitch'
  return value.startsWith('resp_') ? value : `resp_${value}`
}

function responseStatusFromFinishReason(finishReason: string | undefined): string {
  return finishReason === 'length' ? 'incomplete' : 'completed'
}

export function chatErrorToResponseError(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) {
    return {
      error: { message: 'Upstream returned an empty error response', type: 'upstream_error', code: null, param: null },
    }
  }
  const str = asString(body)
  if (str !== undefined) {
    return { error: { message: str, type: 'upstream_error', code: null, param: null } }
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
  const code = get(source, 'code') ?? get(get(source, 'base_resp'), 'status_code') ?? null
  const param = get(source, 'param') ?? null

  return { error: { message, type: errorType, code: code as JsonValue, param: param as JsonValue } }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return 'Upstream error'
  }
}
