import type { SendMessageRequest } from '@superone/shared/agent-types'
import { mcpAppModelContextText, mcpAppModelInput, type McpAppMessage } from '@superone/shared/mcp-apps-state'

/** Codex's explicit prompt is the model input when present; content is the chat bubble. */
export function withMcpAppContext(request: SendMessageRequest, messages: readonly McpAppMessage[]): SendMessageRequest {
  const context = mcpAppModelContextText(messages)
  if (!context) return request
  const input = mcpAppModelInput({ text: request.content, prompt: request.codex?.prompt }, context)
  return {
    ...request,
    content: input.text,
    ...(request.codex?.prompt !== undefined ? { codex: { ...request.codex, prompt: input.prompt } } : {}),
  }
}
