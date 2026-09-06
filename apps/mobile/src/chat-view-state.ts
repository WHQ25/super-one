import type { HostInbound, HostOutbound } from '@superone/chat-view'

export type ChatViewState = Extract<HostOutbound, { type: 'viewState' }>

export const CHAT_VIEW_STATE_KEY = 'superone:chat-view-state'

/** Hydration already follows the latest turn. Only restore an intentional history position. */
export function restoredChatWindow(saved?: ChatViewState): Extract<HostInbound, { type: 'setWindow' }> | null {
  if (!saved || saved.atBottom || !saved.range || saved.range.end <= saved.range.start) return null
  return { type: 'setWindow', range: saved.range, anchorId: saved.anchorId }
}

export function parseStoredChatViewStates(raw: string): Record<string, ChatViewState> {
  try {
    return JSON.parse(raw) as Record<string, ChatViewState>
  } catch {
    return {}
  }
}
