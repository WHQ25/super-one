import { responsesToChatCompletions } from './request'
import type { CodexChatReasoningConfig } from './reasoning'
import { chatCompletionToResponse, chatErrorToResponseError } from './response'
import { createResponsesSseStreamFromChat } from './stream'
import { asArray, asObject, asString } from './helpers'

function toolSummary(body: unknown) {
  const tools = asArray(asObject(body)?.tools) ?? []
  const summary = { total: tools.length, function: 0, namespace: 0, other: 0, superone: 0 }
  for (const tool of tools) {
    const entry = asObject(tool)
    if (entry?.type === 'function') summary.function++
    else if (entry?.type === 'namespace') summary.namespace++
    else summary.other++
    const name = asString(entry?.name) ?? asString(asObject(entry?.function)?.name)
    if (name?.startsWith('mcp__superone__')) summary.superone++
  }
  return summary
}

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
    const result = responsesToChatCompletions(request, this.reasoningConfig)
    // This sidecar's stderr is persisted by llm-proxy-manager in packaged builds.
    // Counts distinguish MCP discovery from provider conversion; no prompts,
    // tool descriptions, schemas, arguments, or credentials enter the log.
    process.stderr.write(`[codex-mcp-tools] ${JSON.stringify({ input: toolSummary(request), output: toolSummary(result) })}\n`)
    return result
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
