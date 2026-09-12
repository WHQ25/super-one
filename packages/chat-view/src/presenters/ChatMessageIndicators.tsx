import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronRight, Loader2, Minimize2, X } from 'lucide-react'
import { isRealtimeVoiceMessage } from '@superone/shared/realtime-transcript'
import type { ChatMessage } from '@superone/shared/agent-types'
import { formatCompactDuration } from './duration-format'

export function parseCompactMarker(message: ChatMessage): {
  trigger: string
  preTokens: number
  postTokens?: number
  durationMs?: number
} | null {
  if (message.providerId !== 'system') return null
  const firstBlock = message.content[0]
  if (!firstBlock || firstBlock.type !== 'text') return null
  const match = firstBlock.text.match(/^__compact__:(manual|auto):(\d+)(?::(\d*):(\d*))?$/)
  if (!match) return null
  return {
    trigger: match[1],
    preTokens: parseInt(match[2], 10),
    postTokens: match[3] ? parseInt(match[3], 10) : undefined,
    durationMs: match[4] ? parseInt(match[4], 10) : undefined,
  }
}

export type TurnMetaMarker =
  | { kind: 'summary'; text: string }
  | { kind: 'recap'; text: string; auto?: boolean }

export function parseTurnMetaMarker(message: ChatMessage): TurnMetaMarker | null {
  if (message.providerId !== 'system') return null
  const firstBlock = message.content[0]
  if (!firstBlock || firstBlock.type !== 'text') return null
  const prefix = '__turn_meta__:'
  if (!firstBlock.text.startsWith(prefix)) return null
  try {
    const raw = JSON.parse(firstBlock.text.slice(prefix.length)) as Record<string, unknown>
    const text = typeof raw.text === 'string' ? raw.text.trim() : ''
    if (!text) return null
    if (raw.kind === 'summary') return { kind: 'summary', text }
    if (raw.kind === 'recap') {
      return {
        kind: 'recap',
        text,
        ...(typeof raw.auto === 'boolean' ? { auto: raw.auto } : {}),
      }
    }
    return null
  } catch {
    return null
  }
}

export function isRedundantTurnSummaryMarker(
  meta: TurnMetaMarker,
  messages: readonly ChatMessage[],
): boolean {
  if (meta.kind !== 'summary') return false
  const text = meta.text.trim()
  if (!text) return false
  return messages.some(
    (message) => message.role === 'assistant'
      && message.providerId !== 'system'
      && (message.metadata?.turnSummary?.trim() ?? '') === text,
  )
}

/**
 * The live assistant turn, skipping the system marker rows that render as
 * indicators rather than as a reply.
 *
 * Compact / turn-meta markers carry `role: 'assistant'` for persistence, but
 * render as standalone indicators. They must never take `isLastAssistant` from
 * the actual reply, regardless of where snapshot reconciliation places them.
 */
export function findLastAssistantMessageId(
  messages: readonly ChatMessage[],
): string | undefined {
  return messages.findLast(
    (message) => message.role === 'assistant'
      && !parseCompactMarker(message)
      && !parseTurnMetaMarker(message)
      // A spoken reply is complete the moment it is transcribed. Letting one at the
      // tail claim this would take the spinner off the Codex turn actually running.
      && !isRealtimeVoiceMessage(message),
  )?.id
}

/** Shared “Summary:” / “Recap:” chrome — same label weight and colon on both surfaces. */
function TurnMetaChrome({
  kind,
  label,
  text,
  className,
}: {
  kind: 'summary' | 'recap'
  label: string
  text: string
  className: string
}) {
  return (
    <div className={className} data-turn-meta={kind} role="note">
      <span className="mr-1.5 font-medium text-muted-foreground/80">{label}</span>
      {text}
    </div>
  )
}

export function TurnMetaIndicator({ meta }: { meta: TurnMetaMarker }) {
  const { t } = useTranslation()
  if (meta.kind === 'recap') {
    return (
      <TurnMetaChrome
        kind="recap"
        label={t('chat.turnMeta.recapLabel')}
        text={meta.text}
        className="mt-0.5 mb-2.5 text-xs leading-snug text-muted-foreground"
      />
    )
  }
  return (
    <TurnMetaChrome
      kind="summary"
      label={t('chat.turnMeta.summaryLabel')}
      text={meta.text}
      className="my-0.5 text-xs leading-snug text-muted-foreground"
    />
  )
}

/**
 * The phone's stand-in for a live turn that has no assistant row yet: the user
 * bubble is painted optimistically, and this is what shows the turn is on its
 * way — creating the session first when it is the first message. Mirrors the
 * `PortableTurnFooter` "Sending…" meta so the label reads the same before and
 * after the assistant row appears.
 */
export function PendingTurnIndicator({ phase }: { phase: 'creating' | 'sending' }) {
  const { t } = useTranslation()
  return (
    <div
      className="mt-0.5 mb-2.5 flex items-center gap-1.5 text-xs leading-snug text-muted-foreground"
      data-pending-turn={phase}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
      <span>{t(phase === 'creating' ? 'chat.creatingSession' : 'chat.sending')}</span>
    </div>
  )
}

export function RecappingIndicator() {
  const { t } = useTranslation()
  return (
    <div
      className="mt-0.5 mb-2.5 flex items-center gap-1.5 text-xs leading-snug text-muted-foreground"
      data-turn-meta="recap-pending"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground/80" aria-hidden />
      <span className="font-medium text-muted-foreground/80">{t('chat.turnMeta.generatingRecap')}</span>
    </div>
  )
}

export function TurnSummaryAboveFooter({ summary }: { summary: string }) {
  const { t } = useTranslation()
  const text = summary.trim()
  if (!text) return null
  return (
    <TurnMetaChrome
      kind="summary"
      label={t('chat.turnMeta.summaryLabel')}
      text={text}
      className="mt-2 text-xs leading-snug text-muted-foreground"
    />
  )
}

export function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

export function CompactIndicator({
  trigger,
  preTokens,
  postTokens,
  durationMs,
  expanded,
  onToggle,
}: {
  trigger: string
  preTokens: number
  postTokens?: number
  durationMs?: number
  expanded?: boolean
  onToggle?: () => void
}) {
  const pillClass = 'inline-flex items-center whitespace-nowrap rounded bg-primary/15 px-1.5 py-px text-xs text-primary/80'
  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded bg-primary/10 px-2 py-1.5 text-xs">
      <Minimize2 className="size-3 shrink-0 text-primary" />
      <span className="shrink-0 font-medium text-primary">Conversation Compacted</span>
      {/* The leftover slot between the title and the toggle owns the pills.
          When it cannot hold them, drop the whole group rather than wrapping. */}
      <div className="@container min-w-0 flex-1 overflow-hidden">
        <div className="compact-indicator-meta">
          <span className={pillClass}>{trigger === 'auto' ? 'auto' : 'manual'}</span>
          {preTokens > 0 && (
            <span className={pillClass}>
              {formatCompactTokens(preTokens)}
              {postTokens !== undefined ? ` → ${formatCompactTokens(postTokens)}` : ''}
            </span>
          )}
          {durationMs !== undefined && durationMs > 0 && (
            <span className={pillClass}>{formatCompactDuration(durationMs)}</span>
          )}
        </div>
      </div>
      {onToggle && (
        <button type="button" aria-expanded={expanded ?? false} onClick={onToggle} className="flex shrink-0 items-center gap-1 text-primary/60 transition-colors hover:text-primary">
          <span>{expanded ? 'Hide history' : 'Show history'}</span>
          <ChevronRight aria-hidden className={expanded ? 'size-3 -rotate-90' : 'size-3 rotate-90'} />
        </button>
      )}
    </div>
  )
}

export function CompactingIndicator({ startedAt }: { startedAt?: number | null }) {
  // Mount time is only the fallback for callers that do not track the start in
  // session state. Anchoring on it would restart the count every time the chat
  // remounts — which is exactly what switching sessions and back does.
  const mountedAtRef = useRef(Date.now())
  const start = startedAt ?? mountedAtRef.current
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const elapsed = Math.max(0, Math.floor((now - start) / 1000))
  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded bg-warning/10 px-2 py-1.5 text-xs">
      <Loader2 className="size-3 shrink-0 animate-spin text-warning" />
      <span className="font-medium text-warning">Compacting conversation…</span>
      {elapsed > 0 && <span className="text-warning/60">{elapsed}s</span>}
    </div>
  )
}

export function CompactErrorIndicator({
  error,
  onDismiss,
}: {
  error: string
  onDismiss?: () => void
}) {
  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded bg-error/10 px-2 py-1.5 text-xs">
      <AlertTriangle className="size-3 shrink-0 text-error" />
      <span className="font-medium text-error">Compaction failed</span>
      <span className="truncate text-error/60">{error}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="ml-auto shrink-0 text-error/60 transition-colors hover:text-error">
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

export function ApiRetryIndicator({
  info,
  onRetry,
}: {
  info: {
    attempt: number
    maxRetries?: number
    delayMs: number
    message?: string
    phase?: 'retrying' | 'exhausted' | 'failed'
  }
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  const phase = info.phase ?? 'retrying'
  const terminal = phase === 'exhausted' || phase === 'failed'
  const [remaining, setRemaining] = useState(info.delayMs)
  const startRef = useRef(Date.now())
  useEffect(() => {
    startRef.current = Date.now()
    setRemaining(info.delayMs)
    if (terminal || info.delayMs <= 0) return
    const id = setInterval(() => {
      const left = Math.max(0, info.delayMs - (Date.now() - startRef.current))
      setRemaining(left)
      if (left <= 0) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [info.attempt, info.delayMs, terminal])
  const seconds = Math.ceil(remaining / 1000)
  const label = terminal
    ? t(phase === 'exhausted' ? 'chat.apiRetry.exhausted' : 'chat.apiRetry.failed')
    : info.maxRetries
      ? t('chat.apiRetry.retrying', { attempt: info.attempt, max: info.maxRetries })
      : t('chat.apiRetry.retryingNoMax', { attempt: info.attempt })
  return (
    <div className={terminal
      ? 'my-0.5 flex items-center gap-1.5 rounded bg-error/10 px-2 py-1.5 text-xs'
      : 'my-0.5 flex items-center gap-1.5 rounded bg-warning/10 px-2 py-1.5 text-xs'}
    >
      {terminal
        ? <AlertTriangle className="size-3 shrink-0 text-error" />
        : <Loader2 className="size-3 shrink-0 animate-spin text-warning" />}
      <span
        className={terminal ? 'min-w-0 truncate font-medium text-error' : 'min-w-0 truncate font-medium text-warning'}
        title={info.message}
      >
        {label}
        {info.message ? ` — ${info.message}` : ''}
        {!terminal && seconds > 0 && <> {seconds}s</>}
      </span>
      {terminal && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-auto shrink-0 text-error/80 underline-offset-2 transition-colors hover:text-error hover:underline"
        >
          {t('chat.apiRetry.tryAgain')}
        </button>
      )}
    </div>
  )
}

export { formatCompactDuration }
