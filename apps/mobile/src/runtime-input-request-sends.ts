import type { PermissionRequest } from '@superone/shared/agent-types'
import type { ChatCoreSession } from '@superone/chat-core'
import { parseInputRequestError } from '@superone/shared/input-request'

/** The host may reject values before claiming a widget form. Keep it editable in that case. */
export class InputRequestSends {
  private readonly pending = new Map<string, PermissionRequest>()
  private readonly errors = new Map<string, string>()
  capture(messageId: string, request: PermissionRequest) { this.pending.set(messageId, request); this.errors.delete(request.requestId) }
  complete(messageId: string) { this.pending.delete(messageId) }
  pendingRequests() { return [...this.pending.values()] }
  errorFor(requestId: string) { return this.errors.get(requestId) }
  clear() { this.pending.clear(); this.errors.clear() }
  reject(session: ChatCoreSession, messageId: string, error: string, queued: boolean): Partial<ChatCoreSession> | null {
    const request = this.pending.get(messageId)
    const rejection = parseInputRequestError(error)
    if (!request || rejection?.code !== 'invalid') return null
    this.pending.delete(messageId)
    this.errors.set(request.requestId, rejection.message)
    return {
      messages: session.messages.filter(message => message.id !== messageId),
      queuedMessages: session.queuedMessages.filter(message => message.id !== messageId),
      pendingPermissions: session.pendingPermissions.some(item => item.requestId === request.requestId)
        ? session.pendingPermissions : [...session.pendingPermissions, request],
      ...(!queued ? { awaitingAssistantReply: false } : {}),
    }
  }
}
