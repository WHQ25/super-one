import type { ChatMessage, Locale, TodoItem } from '@superone/shared/agent-types'
import type { ChatWindowRange } from './chat-window'

export interface ReductionProjection {
  messages?: ChatMessage[]
  todos?: TodoItem[] | Record<string, TodoItem>
  labels?: Record<string, string>
  mentionArtwork?: Record<string, string>
  pendingPermission?: {
    requestId: string
    toolName: string
    toolUseId?: string
  } | null
}

export type HostInbound =
  | ({ type: 'initialize' | 'hydrate' } & ReductionProjection)
  | ({ type: 'applyReductionPatch' } & ReductionProjection)
  | ({ type: 'prependHistory' } & ReductionProjection)
  | { type: 'reset' }
  | { type: 'setConnection'; state: string; epoch: number }
  | { type: 'setTheme'; hue?: number; scheme?: 'light' | 'dark' }
  | {
      type: 'setViewport'
      safeArea?: { top?: number; right?: number; bottom?: number; left?: number }
      fontScale?: number
      locale?: Locale
    }
  | { type: 'setWindow'; range: ChatWindowRange; anchorId?: string }
  | { type: 'scrollToTurn'; turnId: string; behavior?: 'auto' | 'smooth' }
  | { type: 'nativeActionResult'; requestId: string; result?: unknown; error?: string }
  | { type: 'nativeActionProgress'; requestId: string; progress: unknown }

export type HostOutbound =
  | { type: 'ready' }
  | { type: 'error'; fatal: true; message: string }
  | { type: 'requestNative'; requestId: string; action: string; payload?: unknown }
  | {
      type: 'viewState'
      range: ChatWindowRange
      atBottom: boolean
      anchorId?: string
      expandedKeys?: string[]
    }

export function parseHostInbound(value: unknown): HostInbound | null {
  let candidate = value
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate)
    } catch {
      return null
    }
  }
  if (!candidate || typeof candidate !== 'object') return null
  const type = (candidate as { type?: unknown }).type
  return typeof type === 'string' ? candidate as HostInbound : null
}
