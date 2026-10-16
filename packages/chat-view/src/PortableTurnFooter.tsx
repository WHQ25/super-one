import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowDown, ArrowUp, Check, Clock, Copy, Loader2 } from 'lucide-react'
import type { ChatMessage } from '@superone/shared/agent-types'
import { formatTokens } from '@superone/shared/format-tokens'
import { cn } from '@superone/ui/lib/utils'
import { MessageErrorBadge } from './presenters/MessageErrorBadge'
import {
  formatTerminalReason,
  turnFooterModel,
  ZERO_TURN_TOKENS,
  type TurnTokenCounts,
} from './presenters/turn-footer-model'
import { requestNative } from './bridge'

function copyErrorText(text: string): boolean {
  requestNative('copyText', { text })
  return true
}

/**
 * One icon + label pair, centred inside the metadata row's 16px text line.
 */
function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-4 shrink-0 items-center gap-1.5', className)}>{children}</span>
}

function Token({ value, direction }: { value: number; direction: 'up' | 'down' }) {
  if (value <= 0) return null
  return (
    <span className="inline-flex items-center gap-0.5 tabular-nums">
      {direction === 'up' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      <span>{formatTokens(value)}</span>
    </span>
  )
}

/** Elapsed ms for a live turn, anchored on `createdAt` so a remount does not restart it. */
function useElapsedMs(message: ChatMessage, isStreaming: boolean): number {
  const startRef = useRef<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!isStreaming) return
    if (startRef.current == null) {
      const created = message.createdAt ? new Date(message.createdAt).getTime() : 0
      startRef.current = created > 0 ? created : Date.now()
    }
    const tick = () => setElapsed(Date.now() - startRef.current!)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isStreaming, message.createdAt])
  return elapsed
}

export interface PortableTurnFooterProps {
  message: ChatMessage
  /** This turn is live AND the session is still producing it. */
  isStreaming: boolean
  streamingTokens: TurnTokenCounts
  /** Plain-text transcript of the turn; omitted while streaming, which hides copy. */
  /** The text, or a loader for a reply the transcript window holds in part. */
  copyText?: string | (() => Promise<string>)
}

/**
 * Remote-Control counterpart of the desktop `DurationFooter`. It renders the
 * slice a phone can support — duration, spend, failure, copy — off the same
 * `turnFooterModel` derivation, so the two never disagree about which number a
 * turn is worth showing. Desktop-only affordances (fork, MCP startup, stall
 * tinting, running slash command) are deliberately absent.
 */
export function PortableTurnFooter({
  message,
  isStreaming,
  streamingTokens,
  copyText,
}: PortableTurnFooterProps) {
  const { t } = useTranslation()
  const elapsedMs = useElapsedMs(message, isStreaming)
  const frozenRef = useRef(ZERO_TURN_TOKENS)
  if (isStreaming && (streamingTokens.input > 0 || streamingTokens.output > 0)) {
    frozenRef.current = streamingTokens
  }
  const footer = turnFooterModel({
    message,
    isStreaming,
    streamingTokens,
    frozenTokens: frozenRef.current,
    elapsedMs,
  })
  const [copied, setCopied] = useState<'copied' | 'copying' | 'failed' | false>(false)
  const showCopy = !isStreaming && Boolean(copyText)
  // A turn under a second has no clock yet, and on the phone the footer is the
  // only place a live turn announces itself — so the sending label stands in
  // until the clock is worth showing.
  const showSending = isStreaming && !footer.showDuration

  if (footer.isEmpty && !showCopy && !showSending) return null

  const separator = <span aria-hidden>·</span>

  return (
    <div className={cn('mt-2 flex flex-wrap items-start gap-1.5 text-xs text-muted-foreground', message.metadata?.turnSummary && 'mt-1')}>
      {showCopy && (
        <button
          type="button"
          disabled={copied === 'copying'}
          onClick={() => {
            const settle = (state: 'copied' | 'failed') => { setCopied(state); setTimeout(() => setCopied(false), 1500) }
            if (typeof copyText !== 'function') { requestNative('copyText', { text: copyText }); settle('copied'); return }
            setCopied('copying')
            copyText().then((text) => { requestNative('copyText', { text }); settle('copied') }, () => settle('failed'))
          }}
          aria-label={copied === 'failed' ? t('chat.messageMenu.copyFailed') : t('chat.messageMenu.copy')}
          className="flex h-4 shrink-0 items-center"
        >
          {copied === 'copied' ? <Check className="size-3 text-success" />
            : copied === 'copying' ? <Loader2 className="size-3 animate-spin" />
              : copied === 'failed' ? <AlertTriangle className="size-3 text-error" />
                : <Copy className="size-3" />}
        </button>
      )}
      {footer.showDuration && (
        <Meta>
          {isStreaming ? <Loader2 className="size-3 animate-spin" /> : <Clock className="size-3" />}
          <span>{footer.durationLabel}</span>
        </Meta>
      )}
      {showSending && (
        <Meta>
          <Loader2 className="size-3 animate-spin" />
          <span>{t('chat.sending')}</span>
        </Meta>
      )}
      {footer.hasTokens && (
        <>
          {(footer.showDuration || showSending) && separator}
          <Token value={footer.tokenInput} direction="up" />
          <Token value={footer.tokenOutput} direction="down" />
        </>
      )}
      {footer.showError && (
        <>
          {(footer.showDuration || footer.hasTokens) && separator}
          <MessageErrorBadge info={footer.errorInfo!} onCopy={copyErrorText} />
        </>
      )}
      {footer.showTerminalReason && (
        <>
          {(footer.showDuration || footer.hasTokens) && separator}
          <Meta>
            <AlertTriangle className="size-3" />
            <span>{formatTerminalReason(footer.terminalReason!)}</span>
          </Meta>
        </>
      )}
    </div>
  )
}
