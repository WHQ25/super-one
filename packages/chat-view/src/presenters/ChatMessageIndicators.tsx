import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronRight, Loader2, Minimize2, X } from 'lucide-react'
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
      && !parseTurnMetaMarker(message),
  )?.id
}

export function TurnMetaIndicator({ meta }: { meta: TurnMetaMarker }) {
  const { t } = useTranslation()
  if (meta.kind === 'recap') {
    return (
      <div
        className="mt-0.5 mb-2.5 text-xs leading-snug text-muted-foreground"
        data-turn-meta="recap"
        role="note"
      >
        <span className="mr-1.5 font-medium text-muted-foreground/80">{t('chat.turnMeta.recapLabel')}</span>
        {meta.text}
      </div>
    )
  }
  return (
    <div
      className="my-0.5 text-xs leading-snug text-muted-foreground"
      data-turn-meta="summary"
      role="note"
    >
      <span className="mr-1.5 font-medium text-muted-foreground/80">{t('chat.turnMeta.summaryLabel')}</span>
      {meta.text}
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
    <div
      className="mt-2 text-xs leading-snug text-muted-foreground"
      data-turn-meta="summary"
      role="note"
    >
      <span className="mr-1.5 font-medium text-muted-foreground/80">{t('chat.turnMeta.summaryLabel')}</span>
      {text}
    </div>
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
    <div className="my-0.5 flex items-start gap-1.5 rounded bg-primary/10 px-2 py-1.5 text-xs">
      <Minimize2 className="mt-0.5 size-3 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="font-medium text-primary">Conversation compacted</span>
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
      {onToggle && (
        <button onClick={onToggle} className="flex shrink-0 items-center gap-0.5 text-primary/60 transition-colors hover:text-primary">
          <ChevronRight className={expanded ? 'size-3 -rotate-90' : 'size-3 rotate-90'} />
          <span>{expanded ? 'Hide history' : 'Show history'}</span>
        </button>
      )}
    </div>
  )
}

export function CompactingIndicator() {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())
  useEffect(() => {
    startRef.current = Date.now()
    setElapsed(0)
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)),
      1000,
    )
    return () => clearInterval(id)
  }, [])
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
}: {
  info: { attempt: number; maxRetries?: number; delayMs: number; message?: string }
}) {
  const [remaining, setRemaining] = useState(info.delayMs)
  const startRef = useRef(Date.now())
  useEffect(() => {
    startRef.current = Date.now()
    setRemaining(info.delayMs)
    if (info.delayMs <= 0) return
    const id = setInterval(() => {
      const left = Math.max(0, info.delayMs - (Date.now() - startRef.current))
      setRemaining(left)
      if (left <= 0) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [info.attempt, info.delayMs])
  const seconds = Math.ceil(remaining / 1000)
  return (
    <div className="my-0.5 flex items-center gap-1.5 rounded bg-warning/10 px-2 py-1.5 text-xs">
      <Loader2 className="size-3 shrink-0 animate-spin text-warning" />
      <span className="font-medium text-warning" title={info.message}>
        Retrying API request ({info.attempt}{info.maxRetries ? `/${info.maxRetries}` : ''})…{' '}
        {seconds > 0 && <>{seconds}s</>}
      </span>
    </div>
  )
}

export { formatCompactDuration }
