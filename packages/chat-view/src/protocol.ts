import type { AgentStatus, ChatMessage, Locale } from '@superone/shared/agent-types'
import type { ChatWindowRange } from './chat-window'

/** Wire shape of the retry banner; mirrors what `ApiRetryIndicator` renders. */
export interface ProjectedApiRetry {
  attempt: number
  maxRetries?: number
  delayMs: number
  message?: string
  phase?: 'retrying' | 'exhausted' | 'failed'
}

/**
 * Session-level facts a turn cannot derive from its own `status`. Without them a
 * turn left in `streaming` by a dropped connection spins forever, and the footer
 * has no live token counter — see `PortableTurnFooter`.
 */
export interface SessionProjection {
  /** Mirrors the host's session status; gates the live-turn spinner. */
  sessionStatus?: AgentStatus
  streamingTokens?: { input: number; output: number }
  isCompacting?: boolean
  compactingStartedAt?: number | null
  isRecapping?: boolean
  compactError?: string | null
  apiRetry?: ProjectedApiRetry | null
  /**
   * A turn the phone has sent but the host has not started answering. Until the
   * assistant's `message_start` lands there is no live turn to carry a footer,
   * so this stands in under the last user bubble: `creating` while the session
   * itself is still being created on the host, `sending` once the message is on
   * the wire. `null` once the reply (or an error) arrives.
   */
  pendingTurn?: 'creating' | 'sending' | null
  /**
   * Absolute project root on the host. Used only to turn project-relative
   * markdown file links into paths `previewFile` can act on — the WebView has no
   * transport for host files, so media srcs are deliberately left alone. Tool
   * screenshots and generated images are the one exception: `PortableHostImage`
   * asks the host for them through the `loadImage` native action, and
   * `PortableHostVideo` asks for a clip's first frame through `loadVideoPoster`.
   * Any picture the transcript does display opens fullscreen through `previewImage`. A
   * mermaid expand is the same idea: `previewMermaid` opens a page of its own
   * so pinch-zoom cannot scale the chat document.
   */
  projectPath?: string | null
}

export interface ReductionProjection extends SessionProjection {
  /** Optional reliable-delivery receipt; legacy hosts can keep sending bare projections. */
  delivery?: { channelId: string; sequence: number }
  messagePatches?: ChatMessage[]
  messageOrder?: string[]
  hasMoreHistory?: boolean
  historyNavigation?: boolean
  messages?: ChatMessage[]
  labels?: Record<string, string>
  mentionArtwork?: Record<string, string>
  /** MCP server name → icon src (https or data:image). Omitted patches keep the previous map. */
  mcpIcons?: Record<string, string>
  pendingPermission?: {
    requestId: string
    toolName: string
    toolUseId?: string
  } | null
}

export type HostInbound =
  | ({ type: 'detailUpdate' } & import('./detail-stream').DetailUpdate)
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
  | { type: 'transcriptApplied'; channelId: string; sequence: number }
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
