import type { SendMessageRequest } from '@superone/shared/agent-types'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { mcpAppModelContextInput, mcpAppModelInput, type McpAppMessage } from '@superone/shared/mcp-apps-state'

/** Codex's explicit prompt is the model input when present; content is the chat bubble. */
export function withMcpAppContext(request: SendMessageRequest, messages: readonly McpAppMessage[], extraApps: readonly ToolAppAttachment[] = []): SendMessageRequest {
  const context = mcpAppModelContextInput(messages, extraApps)
  if (!context.text && !context.images.length) return request
  const input = mcpAppModelInput({ text: request.content, prompt: request.codex?.prompt, images: request.images }, context)
  return {
    ...request,
    content: input.text,
    ...(input.images?.length ? { images: input.images } : {}),
    ...(request.codex?.prompt !== undefined ? { codex: { ...request.codex, prompt: input.prompt } } : {}),
  }
}
