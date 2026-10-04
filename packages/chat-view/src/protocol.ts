import type { AgentEvent, AgentStatus, AskUserQuestionRequest, ChatMessage, Locale } from '@superone/shared/agent-types'
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
  /** The question the session waits on; the document draws its form above the composer. */
  pendingQuestion?: AskUserQuestionRequest | null
  /** Output of a command that is not a chat message, shown above the composer until dismissed. */
  slashCommandOutput?: { command: string; content: string } | null
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
  | { type: 'channelToken'; token: string }
  | { type: 'exitMcpAppFullscreen' }
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
  /**
   * The Markdown file a `markdown-document` view renders (`view-mode.ts`).
   * `directory` is the file's folder on the host: relative links resolve
   * against it, as they do in the desktop's Markdown editor.
   */
  | { type: 'showMarkdownDocument'; text: string; directory: string }
  /**
   * The session the document draws mods for, as the client id the desktop
   * stamps this phone with; `null` when the session's harness draws none.
   */
  | { type: 'setModSession'; sessionId: string | null; clientId: string | null }
  /** A `mod_*` session event, which the native runtime does not reduce. */
  | { type: 'modEvent'; event: AgentEvent }
  | { type: 'nativeActionResult'; requestId: string; result?: unknown; error?: string }
  | { type: 'nativeActionProgress'; requestId: string; progress: unknown }

export type HostOutbound =
  | { type: 'ready' }
  | { type: 'transcriptApplied'; channelId: string; sequence: number }
  | { type: 'error'; fatal: true; message: string }
  | { type: 'requestNative'; requestId: string; action: string; payload?: unknown }
  /** A `markdown-document` view painted the document `showMarkdownDocument` sent. */
  | { type: 'documentRendered' }
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
