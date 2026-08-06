import { responsesToChatCompletions } from './request'
import type { CodexChatReasoningConfig } from './reasoning'
import { chatCompletionToResponse, chatErrorToResponseError } from './response'
import { createResponsesSseStreamFromChat } from './stream'

function passthroughHeaders(source: Headers, contentType: string): Headers {
  const headers = new Headers()
  for (const [key, value] of source.entries()) {
    const lower = key.toLowerCase()
    if (lower === 'content-length' || lower === 'content-encoding' || lower === 'content-type') continue
    headers.set(key, value)
  }
  headers.set('Content-Type', contentType)
  return headers
}

export interface CodexResponsesTransformerConfig {
  apiBaseUrl: string
  apiKey: string
  reasoningConfig?: CodexChatReasoningConfig
  /** When set, strip `name,` prefix from inbound model ids (musistudio compatibility). */
  providerName?: string
}

export class CodexResponsesTransformer {
  name = 'codex-responses'
  endPoint = '/responses'
  private readonly reasoningConfig: CodexChatReasoningConfig | undefined
  private readonly apiBaseUrl: string | undefined
  private readonly apiKey: string | undefined
  private readonly providerName: string | undefined

  constructor(reasoningConfigOrConfig?: CodexChatReasoningConfig | CodexResponsesTransformerConfig) {
    if (reasoningConfigOrConfig && 'apiBaseUrl' in reasoningConfigOrConfig) {
      this.apiBaseUrl = reasoningConfigOrConfig.apiBaseUrl
      this.apiKey = reasoningConfigOrConfig.apiKey
      this.reasoningConfig = reasoningConfigOrConfig.reasoningConfig
      this.providerName = reasoningConfigOrConfig.providerName
    } else {
      this.reasoningConfig = reasoningConfigOrConfig
    }
  }

  async transformRequestOut(request: unknown): Promise<Record<string, unknown>> {
    const body = request && typeof request === 'object' ? { ...(request as Record<string, unknown>) } : {}
    if (this.providerName && typeof body.model === 'string') {
      const prefix = `${this.providerName},`
      if (body.model.startsWith(prefix)) body.model = body.model.slice(prefix.length)
    }
    return responsesToChatCompletions(body, this.reasoningConfig)
  }

  async transformResponseIn(response: Response): Promise<Response> {
    const contentType = response.headers.get('Content-Type') ?? ''

    if (contentType.includes('text/event-stream') && response.body) {
      return new Response(createResponsesSseStreamFromChat(response.body), {
        status: response.status,
        statusText: response.statusText,
        headers: passthroughHeaders(response.headers, 'text/event-stream'),
      })
    }

    if (contentType.includes('application/json')) {
      const json = await response.json()
      const body =
        !response.ok || (json && typeof json === 'object' && 'error' in json)
          ? chatErrorToResponseError(json)
          : chatCompletionToResponse(json)
      return new Response(JSON.stringify(body), {
        status: response.status,
        statusText: response.statusText,
        headers: passthroughHeaders(response.headers, 'application/json'),
      })
    }

    return response
  }

  async forward(request: Request): Promise<Response> {
    if (!this.apiBaseUrl || this.apiKey === undefined) {
      throw new Error('CodexResponsesTransformer.forward requires apiBaseUrl and apiKey')
    }
    const body = await request.json().catch(() => ({}))
    const chatRequest = await this.transformRequestOut(body)
    const upstreamResponse = await fetch(this.apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(chatRequest),
    })
    return this.transformResponseIn(upstreamResponse)
  }
}
