import { trace } from '../agent/event-trace'
import { claudeMessagesToChatCompletions } from './request'
import { chatCompletionToMessage, chatErrorToMessageError } from './response'
import { createMessagesSseStreamFromChat } from './stream'

export interface ClaudeMessagesTransformerConfig {
  providerName: string
  apiBaseUrl: string
  apiKey: string
}

export class ClaudeMessagesTransformer {
  name = 'claude-messages'
  endPoint = '/v1/messages'

  private config: ClaudeMessagesTransformerConfig

  constructor(config: ClaudeMessagesTransformerConfig) {
    this.config = config
  }

  transformRequestOut(request: unknown): Record<string, unknown> {
    const chat = claudeMessagesToChatCompletions(request, this.config.providerName)
    return chat
  }

  async transformResponseIn(response: Response): Promise<Response> {
    const contentType = response.headers.get('Content-Type') ?? ''

    if (contentType.includes('text/event-stream') && response.body) {
      const stream = createMessagesSseStreamFromChat(response.body)
      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: this.passthroughHeaders(response.headers, 'text/event-stream'),
      })
    }

    if (contentType.includes('application/json')) {
      const body = await response.json()
      if (!response.ok || (body && typeof body === 'object' && 'error' in body)) {
        const errorBody = chatErrorToMessageError(body)
        return new Response(JSON.stringify(errorBody), {
          status: response.status,
          statusText: response.statusText,
          headers: this.passthroughHeaders(response.headers, 'application/json'),
        })
      }
      const messageBody = chatCompletionToMessage(body)
      return new Response(JSON.stringify(messageBody), {
        status: response.status,
        statusText: response.statusText,
        headers: this.passthroughHeaders(response.headers, 'application/json'),
      })
    }

    return response
  }

  async forward(request: Request): Promise<Response> {
    const body = await request.json().catch(() => ({}))
    trace('llm-proxy.in', 'raw_request', body, request.headers.get('x-request-id') ?? undefined)

    const chatRequest = this.transformRequestOut(body)
    trace('llm-proxy.in', 'openai_request', chatRequest, request.headers.get('x-request-id') ?? undefined)

    const upstreamResponse = await fetch(this.config.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(chatRequest),
    })

    trace('llm-proxy.upstream', 'status', { status: upstreamResponse.status }, request.headers.get('x-request-id') ?? undefined)

    const converted = await this.transformResponseIn(upstreamResponse)
    trace('llm-proxy.out', 'response', converted, request.headers.get('x-request-id') ?? undefined)

    return converted
  }

  private passthroughHeaders(source: Headers, contentType: string): Headers {
    const headers = new Headers()
    for (const [key, value] of source.entries()) {
      const lower = key.toLowerCase()
      if (lower === 'content-length' || lower === 'content-encoding' || lower === 'content-type') continue
      headers.set(key, value)
    }
    headers.set('Content-Type', contentType)
    return headers
  }
}
