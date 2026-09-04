import type { HostOutbound } from '@superone/chat-view'

export type ChatViewState = Extract<HostOutbound, { type: 'viewState' }>

export const CHAT_VIEW_STATE_KEY = 'superone:chat-view-state'

export function parseStoredChatViewStates(raw: string): Record<string, ChatViewState> {
  try {
    return JSON.parse(raw) as Record<string, ChatViewState>
  } catch {
    return {}
  }
}
