import type { ChatMessage } from '@superone/shared/agent-types'

/** Paint transient previews across the WebView bridge without changing saved tool input. */
export class StreamingInputProjection {
  private previous = new Map<string, { source: ChatMessage; previews: unknown[]; message: ChatMessage }>()

  project(messages: ChatMessage[], previews: Record<string, Record<string, unknown>>): ChatMessage[] {
    const next = new Map<string, { source: ChatMessage; previews: unknown[]; message: ChatMessage }>()
    const projected = messages.map((source) => {
      const values = source.content.map((block) => block.type === 'tool_use' && block.status === 'streaming' ? previews[block.toolUseId] : undefined)
      const cached = this.previous.get(source.id)
      if (cached?.source === source && values.every((value, index) => value === cached.previews[index])) {
        next.set(source.id, cached)
        return cached.message
      }
      const message = values.some(Boolean) ? { ...source, content: source.content.map((block, index) =>
        values[index] && block.type === 'tool_use' ? { ...block, input: JSON.stringify(values[index]) } : block) } : source
      next.set(source.id, { source, previews: values, message })
      return message
    })
    this.previous = next
    return projected
  }
}
