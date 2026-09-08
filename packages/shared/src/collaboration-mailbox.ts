/** Human-facing mailbox data. Never includes collaboration bearer credentials. */
export interface CollaborationMailboxMessage {
  id: string
  fromSessionId: string
  fromTitle: string
  content: string
  createdAt: string
}

export const COLLABORATION_MAILBOX_CHANNELS = {
  list: 'collaboration-mailbox:list',
  changed: 'collaboration-mailbox:changed',
} as const

export interface CollaborationMailboxAPI {
  list(sessionId: string): Promise<CollaborationMailboxMessage[]>
  onChanged(callback: (sessionId: string) => void): () => void
}
