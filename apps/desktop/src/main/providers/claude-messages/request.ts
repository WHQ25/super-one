import {
  asArray,
  asObject,
  asString,
  canonicalizeToolArguments,
  get,
  isOpenAiOSeries,
  type JsonValue,
} from './helpers'
import { mapThinkingToEffort, supportsReasoningEffort, stripModelPrefix } from './capabilities'

type Message = Record<string, unknown>

const PASSTHROUGH_FIELDS = [
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

export function claudeMessagesToChatCompletions(
  body: unknown,
  providerName: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const src = asObject(body) ?? {}

  const rawModel = asString(src.model) ?? ''
  const model = stripModelPrefix(rawModel, providerName)
  result.model = model

  const maxTokens = typeof src.max_tokens === 'number' ? src.max_tokens : undefined
  if (maxTokens !== undefined) {
    if (isOpenAiOSeries(model)) result.max_completion_tokens = maxTokens
    else result.max_tokens = maxTokens
  }
  if (src.max_completion_tokens !== undefined && isOpenAiOSeries(model)) {
    result.max_completion_tokens = src.max_completion_tokens
  }
  if (src.max_tokens !== undefined && !isOpenAiOSeries(model)) {
    result.max_tokens = src.max_tokens
  }

  for (const key of ['temperature', 'top_p', 'stream'] as const) {
    if (src[key] !== undefined) result[key] = src[key]
  }

  if (src.stop_sequences !== undefined) result.stop = src.stop_sequences

  const effort = mapThinkingToEffort(src.thinking, maxTokens)
  if (effort !== null && supportsReasoningEffort(model)) {
    result.reasoning_effort = effort
  }

  const messages: Message[] = []
  const systemText = systemTextFromClaude(src.system)
  if (systemText) messages.push({ role: 'system', content: systemText })

  appendClaudeMessagesAsChat(src.messages, messages)
  result.messages = collapseSystemMessagesToHead(messages)

  const tools = asArray(src.tools)
  if (tools) {
    const chatTools = tools
      .map(claudeToolToChatTool)
      .filter((t): t is Record<string, unknown> => t !== undefined)
    if (chatTools.length > 0) result.tools = chatTools
  }

  if (src.tool_choice !== undefined) result.tool_choice = claudeToolChoiceToChat(src.tool_choice)

  for (const key of PASSTHROUGH_FIELDS) {
    if (src[key] !== undefined) result[key] = src[key]
  }

  if (result.stream === true) {
    const opts = asObject(result.stream_options)
    result.stream_options = { ...(opts ?? {}), include_usage: true }
  }

  return result
}

function systemTextFromClaude(value: unknown): string {
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

function appendClaudeMessagesAsChat(src: unknown, messages: Message[]): void {
  const arr = asArray(src)
  if (!arr) return

  for (const item of arr) {
    const role = asString(get(item, 'role'))
    if (role === 'assistant') {
      messages.push(claudeAssistantToChat(item))
    } else if (role === 'user') {
      messages.push(claudeUserToChat(item))
    } else if (role === 'system') {
      const text = contentToText(get(item, 'content'))
      if (text) messages.push({ role: 'system', content: text })
    } else if (role === 'tool') {
      messages.push(claudeToolResultToChat(item))
    }
  }
}

function claudeUserToChat(item: unknown): Message {
  const content = get(item, 'content')
  const parts = asArray(content)

  if (parts) {
    const chatParts: Record<string, JsonValue>[] = []
    let hasNonText = false
    for (const part of parts) {
      const partType = asString(get(part, 'type')) ?? ''
      if (partType === 'text' || partType === 'input_text') {
        const t = asString(get(part, 'text'))
        if (t) chatParts.push({ type: 'text', text: t })
      } else if (partType === 'image' || partType === 'input_image') {
        hasNonText = true
        const source = asObject(get(part, 'source'))
        const imageUrl = get(part, 'image_url')
        let url: string | undefined
        if (source) {
          const mediaType = asString(get(source, 'media_type')) ?? 'image/png'
          const data = asString(get(source, 'data'))
          if (data) url = `data:${mediaType};base64,${data}`
        } else if (imageUrl !== undefined) {
          url = asString(imageUrl) ?? ''
        }
        if (url) chatParts.push({ type: 'image_url', image_url: { url } })
      }
    }
    if (chatParts.length > 0) {
      if (hasNonText) return { role: 'user', content: chatParts }
      return { role: 'user', content: chatParts.map((p) => p.text as string).join('\n') }
    }
  }

  const text = contentToText(content)
  return { role: 'user', content: text ?? '' }
}

function claudeAssistantToChat(item: unknown): Message {
  const content = get(item, 'content')
  const text = contentToText(content)

  const message: Message = { role: 'assistant', content: text ?? null }

  const reasoning = extractThinkingFromAssistant(item)
  if (reasoning) message.reasoning_content = reasoning

  const toolCalls = asArray(get(item, 'tool_calls'))
  if (toolCalls) {
    message.tool_calls = toolCalls
      .map(claudeToolUseToChatToolCall)
      .filter((t): t is Record<string, unknown> => t !== undefined)
  }

  const functionCall = get(item, 'function_call')
  if (functionCall !== undefined && !toolCalls) {
    message.tool_calls = [claudeFunctionCallToChatToolCall(functionCall)]
  }

  return message
}

function extractThinkingFromAssistant(item: unknown): string | undefined {
  const content = asArray(get(item, 'content'))
  if (content) {
    for (const part of content) {
      if (asString(get(part, 'type')) === 'thinking') {
        const thinking = asString(get(part, 'thinking'))
        if (thinking) return thinking
      }
    }
  }
  return asString(get(item, 'reasoning_content'))
}

function claudeToolUseToChatToolCall(item: unknown): Record<string, unknown> | undefined {
  const callId = asString(get(item, 'id')) ?? asString(get(item, 'tool_use_id'))
  const name = asString(get(item, 'name'))
  if (!callId || !name) return undefined

  const input = get(item, 'input') ?? get(item, 'arguments')
  return {
    id: callId,
    type: 'function',
    function: { name, arguments: canonicalizeToolArguments(input) },
  }
}

function claudeFunctionCallToChatToolCall(functionCall: unknown): Record<string, unknown> {
  const callId = asString(get(functionCall, 'id')) ?? 'call_0'
  const name = asString(get(functionCall, 'name')) ?? ''
  const args = canonicalizeToolArguments(get(functionCall, 'arguments'))
  return { id: callId, type: 'function', function: { name, arguments: args } }
}

function claudeToolResultToChat(item: unknown): Message {
  const toolUseId = asString(get(item, 'tool_use_id')) ?? asString(get(item, 'call_id')) ?? ''
  const content = get(item, 'content')
  const text = contentToText(content)
  const isError = get(item, 'is_error') === true

  return {
    role: 'tool',
    tool_call_id: toolUseId,
    content: text ?? '',
    ...(isError ? { role: 'tool' } : {}),
  }
}

function claudeToolToChatTool(tool: unknown): Record<string, unknown> | undefined {
  const name = asString(get(tool, 'name'))
  if (!name) return undefined

  const schema = asObject(get(tool, 'input_schema'))
  const parameters = schema ?? asObject(get(tool, 'parameters')) ?? {}

  return {
    type: 'function',
    function: {
      name,
      description: get(tool, 'description') ?? null,
      parameters,
      ...(get(tool, 'strict') !== undefined ? { strict: get(tool, 'strict') } : {}),
    },
  }
}

function claudeToolChoiceToChat(toolChoice: unknown): unknown {
  const obj = asObject(toolChoice)
  if (obj) {
    const type = asString(obj.type)
    if (type === 'tool' || type === 'function') {
      const name = asString(obj.name) ?? asString(get(obj, 'function.name'))
      if (name) return { type: 'function', function: { name } }
    }
    if (type === 'any') return 'required'
    if (type === 'auto' || type === 'none') return type
  }
  if (asString(toolChoice) === 'none' || asString(toolChoice) === 'auto' || asString(toolChoice) === 'required') {
    return toolChoice
  }
  return toolChoice
}

function contentToText(content: unknown): string | undefined {
  if (content === null || content === undefined) return undefined
  const str = asString(content)
  if (str !== undefined) return str
  const parts = asArray(content)
  if (!parts) return undefined
  const textParts = parts
    .map((part) => {
      const partType = asString(get(part, 'type')) ?? ''
      if (partType === 'text' || partType === 'input_text') return asString(get(part, 'text'))
      if (partType === 'thinking') return asString(get(part, 'thinking'))
      return undefined
    })
    .filter((s): s is string => s !== undefined)
  if (textParts.length === 0) return undefined
  return textParts.join('\n')
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
