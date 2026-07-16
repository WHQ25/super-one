import {
  appendReasoningContent,
  asArray,
  asObject,
  asString,
  canonicalizeToolArguments,
  canonicalizeJsonStringIfParseable,
  canonicalJsonString,
  extractReasoningFieldText,
  extractReasoningSummaryText,
  get,
  isOpenAiOSeries,
  supportsReasoningEffort,
  type JsonValue,
} from './helpers'

type Message = Record<string, unknown>

const EXTRA_CHAT_PASSTHROUGH_FIELDS = [
  'frequency_penalty',
  'logit_bias',
  'logprobs',
  'metadata',
  'n',
  'parallel_tool_calls',
  'presence_penalty',
  'response_format',
  'seed',
  'service_tier',
  'stop',
  'stream_options',
  'top_logprobs',
  'user',
] as const

export function responsesToChatCompletions(body: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const src = asObject(body) ?? {}

  if ('model' in src) result.model = src.model

  const messages: Message[] = []
  const instructions = instructionText(src.instructions)
  if (instructions) messages.push({ role: 'system', content: instructions })
  appendResponsesInputAsChatMessages(src.input, messages)
  result.messages = collapseSystemMessagesToHead(messages)

  const model = asString(src.model) ?? ''
  if (src.max_output_tokens !== undefined) {
    if (isOpenAiOSeries(model)) result.max_completion_tokens = src.max_output_tokens
    else result.max_tokens = src.max_output_tokens
  }
  if (src.max_tokens !== undefined) result.max_tokens = src.max_tokens
  if (src.max_completion_tokens !== undefined) result.max_completion_tokens = src.max_completion_tokens

  for (const key of ['temperature', 'top_p', 'stream'] as const) {
    if (src[key] !== undefined) result[key] = src[key]
  }

  const effort = asString(get(src.reasoning, 'effort'))
  if (effort && supportsReasoningEffort(model)) result.reasoning_effort = effort

  const tools = asArray(src.tools)
  if (tools) {
    const chatTools = tools
      .map(responsesToolToChatTool)
      .filter((t): t is Record<string, unknown> => t !== undefined)
    if (chatTools.length > 0) result.tools = chatTools
  }

  if (src.tool_choice !== undefined) result.tool_choice = responsesToolChoiceToChat(src.tool_choice)

  for (const key of EXTRA_CHAT_PASSTHROUGH_FIELDS) {
    if (src[key] !== undefined) result[key] = src[key]
  }

  if (result.stream === true) {
    const opts = asObject(result.stream_options)
    result.stream_options = { ...(opts ?? {}), include_usage: true }
  }

  return result
}

function instructionText(value: unknown): string {
  const str = asString(value)
  if (str !== undefined) return str
  const arr = asArray(value)
  if (arr) {
    return arr
      .map((part) => asString(get(part, 'text')) ?? asString(part))
      .filter((s): s is string => !!s)
      .join('\n\n')
  }
  return ''
}

interface WalkState {
  pendingToolCalls: Record<string, unknown>[]
  pendingReasoning: string | undefined
  lastAssistantIndex: number | undefined
}

function appendResponsesInputAsChatMessages(input: unknown, messages: Message[]): void {
  const state: WalkState = { pendingToolCalls: [], pendingReasoning: undefined, lastAssistantIndex: undefined }

  const str = asString(input)
  if (str !== undefined) {
    messages.push({ role: 'user', content: str })
  } else {
    const items = asArray(input)
    if (items) {
      for (const item of items) appendResponsesItem(item, messages, state)
    } else if (asObject(input)) {
      appendResponsesItem(input, messages, state)
    }
  }

  flushPendingToolCalls(messages, state)
  backfillToolCallReasoningPlaceholders(messages)
}

function appendResponsesItem(item: unknown, messages: Message[], state: WalkState): void {
  const itemType = asString(get(item, 'type'))
  switch (itemType) {
    case 'function_call': {
      appendUniquePendingReasoning(state, extractReasoningFieldText(item))
      state.pendingToolCalls.push(responsesFunctionCallToChatToolCall(item))
      return
    }
    case 'function_call_output': {
      flushPendingToolCalls(messages, state)
      const callId = asString(get(item, 'call_id')) ?? ''
      messages.push({ role: 'tool', tool_call_id: callId, content: functionCallOutput(get(item, 'output')) })
      return
    }
    case 'reasoning': {
      const reasoning = extractReasoningSummaryText(item)
      const attached =
        state.pendingToolCalls.length === 0 && attachReasoningToLastAssistant(messages, state.lastAssistantIndex, reasoning)
      if (!attached) appendPendingReasoning(state, reasoning)
      return
    }
    default: {
      flushPendingToolCalls(messages, state)
      if (get(item, 'role') !== undefined || get(item, 'content') !== undefined) {
        const message = responsesMessageItemToChatMessage(item, state)
        updateLastAssistantIndex(messages, message, state)
        messages.push(message)
      }
    }
  }
}

function functionCallOutput(output: unknown): string {
  const str = asString(output)
  if (str !== undefined) return canonicalizeJsonStringIfParseable(str)
  if (output === undefined) return ''
  return canonicalJsonString(output as JsonValue)
}

function flushPendingToolCalls(messages: Message[], state: WalkState): void {
  if (state.pendingToolCalls.length === 0) return
  const message: Message = { role: 'assistant', content: null, tool_calls: state.pendingToolCalls }
  state.pendingToolCalls = []
  attachPendingReasoningToAssistant(message, state)
  state.lastAssistantIndex = messages.length
  messages.push(message)
}

function responsesMessageItemToChatMessage(item: unknown, state: WalkState): Message {
  const role = asString(get(item, 'role')) ?? 'user'
  const chatRole = responsesRoleToChatRole(role)
  const content = 'content' in (asObject(item) ?? {}) ? responsesContentToChatContent(get(item, 'content')) : null

  const message: Message = { role: chatRole, content }

  if (chatRole === 'assistant') {
    appendPendingReasoning(state, extractReasoningFieldText(item))
    attachPendingReasoningToAssistant(message, state)
  } else if (state.pendingReasoning !== undefined) {
    state.pendingReasoning = undefined
  }

  return message
}

function responsesRoleToChatRole(role: string): string {
  switch (role) {
    case 'system':
    case 'developer':
      return 'system'
    case 'assistant':
      return 'assistant'
    case 'tool':
      return 'tool'
    default:
      return 'user'
  }
}

function updateLastAssistantIndex(messages: Message[], message: Message, state: WalkState): void {
  const role = asString(message.role)
  if (role === 'assistant') state.lastAssistantIndex = messages.length
  else if (role !== 'tool') state.lastAssistantIndex = undefined
}

function appendPendingReasoning(state: WalkState, reasoning: string | undefined): void {
  const trimmed = reasoning?.trim()
  if (!trimmed) return
  state.pendingReasoning = state.pendingReasoning ? `${state.pendingReasoning}\n\n${trimmed}` : trimmed
}

function appendUniquePendingReasoning(state: WalkState, reasoning: string | undefined): void {
  const trimmed = reasoning?.trim()
  if (!trimmed) return
  if (state.pendingReasoning?.includes(trimmed)) return
  state.pendingReasoning = state.pendingReasoning ? `${state.pendingReasoning}\n\n${trimmed}` : trimmed
}

function attachPendingReasoningToAssistant(message: Message, state: WalkState): void {
  const reasoning = state.pendingReasoning
  state.pendingReasoning = undefined
  if (reasoning && reasoning.trim()) appendReasoningContent(message, reasoning)
}

function attachReasoningToLastAssistant(
  messages: Message[],
  lastAssistantIndex: number | undefined,
  reasoning: string | undefined,
): boolean {
  const trimmed = reasoning?.trim()
  if (!trimmed) return true
  if (lastAssistantIndex === undefined) return false
  const message = messages[lastAssistantIndex]
  if (!message || asString(message.role) !== 'assistant') return false
  appendReasoningContent(message, trimmed)
  return true
}

function backfillToolCallReasoningPlaceholders(messages: Message[]): void {
  for (const message of messages) {
    const isToolCall =
      asString(message.role) === 'assistant' && (asArray(message.tool_calls)?.length ?? 0) > 0
    if (isToolCall && !asString(message.reasoning_content)?.trim()) {
      message.reasoning_content = 'tool call'
    }
  }
}

function responsesContentToChatContent(content: unknown): JsonValue {
  if (content === null || content === undefined) return null
  const str = asString(content)
  if (str !== undefined) return str
  const parts = asArray(content)
  if (!parts) return content as JsonValue

  const chatParts: Record<string, JsonValue>[] = []
  let hasNonText = false

  for (const part of parts) {
    const partType = asString(get(part, 'type')) ?? ''
    if (partType === 'input_text' || partType === 'output_text' || partType === 'text') {
      const text = asString(get(part, 'text'))
      if (text) chatParts.push({ type: 'text', text })
    } else if (partType === 'refusal') {
      const text = asString(get(part, 'refusal'))
      if (text) chatParts.push({ type: 'text', text })
    } else if (partType === 'input_image') {
      const imageUrl = get(part, 'image_url')
      if (imageUrl !== undefined) {
        const value = asObject(imageUrl) ? (imageUrl as JsonValue) : { url: asString(imageUrl) ?? '' }
        chatParts.push({ type: 'image_url', image_url: value })
        hasNonText = true
      }
    }
  }

  if (!hasNonText) {
    return chatParts.map((part) => asString(part.text) ?? '').join('\n')
  }
  return chatParts
}

function responsesFunctionCallToChatToolCall(item: unknown): Record<string, unknown> {
  const callId = asString(get(item, 'call_id')) ?? asString(get(item, 'id')) ?? ''
  const name = asString(get(item, 'name')) ?? ''
  return {
    id: callId,
    type: 'function',
    function: { name, arguments: canonicalizeToolArguments(get(item, 'arguments')) },
  }
}

function responsesToolToChatTool(tool: unknown): Record<string, unknown> | undefined {
  if (asString(get(tool, 'type')) !== 'function') return undefined
  const fn = asObject(get(tool, 'function'))
  if (fn) {
    const cloned = { ...(asObject(tool) as Record<string, unknown>) }
    const strict = cloned.strict
    if (strict !== undefined) {
      const fnCopy = { ...fn }
      if (fnCopy.strict === undefined) fnCopy.strict = strict
      cloned.function = fnCopy
      delete cloned.strict
    }
    return cloned
  }
  const fnObj: Record<string, unknown> = {
    name: asString(get(tool, 'name')) ?? '',
    description: get(tool, 'description') ?? null,
    parameters: get(tool, 'parameters') ?? {},
  }
  if (get(tool, 'strict') !== undefined) fnObj.strict = get(tool, 'strict')
  return { type: 'function', function: fnObj }
}

function responsesToolChoiceToChat(toolChoice: unknown): unknown {
  const obj = asObject(toolChoice)
  if (obj && asString(obj.type) === 'function') {
    return { type: 'function', function: { name: asString(obj.name) ?? '' } }
  }
  return toolChoice
}

function collapseSystemMessagesToHead(messages: Message[]): Message[] {
  const systemChunks: string[] = []
  const rest: Message[] = []
  for (const msg of messages) {
    if (asString(msg.role) === 'system') {
      const text = asString(msg.content)
      if (text !== undefined) {
        if (text.trim()) systemChunks.push(text)
        continue
      }
    }
    rest.push(msg)
  }
  if (systemChunks.length === 0) return rest
  return [{ role: 'system', content: systemChunks.join('\n\n') }, ...rest]
}
