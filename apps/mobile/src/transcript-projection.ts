import type { ChatMessage } from '@superone/shared/agent-types'

/** Cross the RN/WebView bridge with changed rows, not the growing transcript. */
export class TranscriptProjection {
  private order: string[] = []
  private previous = new Map<string, ChatMessage>()
  project(messages: ChatMessage[], hydrate: boolean) {
    const messagePatches = messages.filter(message => this.previous.get(message.id) !== message)
    const order = messages.map(message => message.id)
    const orderChanged = order.length !== this.order.length || order.some((id, index) => id !== this.order[index])
    this.order = order
    this.previous = new Map(messages.map(message => [message.id, message]))
    return hydrate ? { messages } : { messagePatches, ...(orderChanged ? { messageOrder: order } : {}) }
  }
}
