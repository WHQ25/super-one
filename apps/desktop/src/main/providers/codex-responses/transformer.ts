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

export class CodexResponsesTransformer {
  name = 'codex-responses'
  endPoint = '/responses'
  private readonly reasoningConfig: CodexChatReasoningConfig | undefined

  constructor(reasoningConfig?: CodexChatReasoningConfig) {
    this.reasoningConfig = reasoningConfig
  }

  async transformRequestOut(request: unknown): Promise<Record<string, unknown>> {
    return responsesToChatCompletions(request, this.reasoningConfig)
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
}
