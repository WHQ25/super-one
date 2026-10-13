/** Pending provider input, separate from the host's unsent composer queue. */
export interface SessionInboxItem {
  id: string
  text: string
  delivery: 'steer' | 'queue'
  createdAt: number
  attachmentCount: number
  clientMessageId?: string
}

export interface HarnessConnectionState {
  state: 'connected' | 'recovering' | 'disconnected'
  attempt: number
}
