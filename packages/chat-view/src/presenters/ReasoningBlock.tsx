import { useTranscriptState } from '@superone/ui/lib/transcript-state'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, ChevronRight } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

export interface ReasoningBlockProps {
  onRetry?: () => void
  onExpandedChange?: (expanded: boolean) => void
  text: string
  blockDone: boolean
  startedAt?: number
  endedAt?: number
  showContent?: boolean
  collapseOnDone?: boolean
  isFirst?: boolean
}

export const ReasoningBlock = memo(function ReasoningBlock({
  onRetry,
  onExpandedChange,
  text,
  blockDone,
  startedAt,
  endedAt,
  showContent = true,
  collapseOnDone = true,
  isFirst = false,
}: ReasoningBlockProps) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  // Streaming stays collapsed. A click opens it; finishing closes it again
  // unless collapseOnDone is false.
  const [expanded, setExpanded] = useTranscriptState('reasoning', false)
  // A block can finish while evicted. Remember observed completion separately
  // from expansion so only manual expansion after completion survives a remount.
  const [previousDone, setPreviousDone] = useTranscriptState('reasoning-done', false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)

  // Prefer persisted timestamps (Claude): derived from data, they survive session
  // switches / history reload instead of resetting on remount. Providers that don't
  // stamp them (Codex) fall back to mount-time measurement — same as the old behavior.
  const [fallbackStart, setFallbackStart] = useTranscriptState('reasoning-start', 0)
  const [fallbackEnd, setFallbackEnd] = useTranscriptState('reasoning-end', 0)
  const start = startedAt ?? (fallbackStart || undefined)
  const end = startedAt != null ? endedAt : (fallbackEnd || undefined)
  useEffect(() => {
    if (!blockDone && !fallbackStart && startedAt == null) setFallbackStart(Date.now())
  }, [blockDone, fallbackStart, startedAt])
  const elapsed = start == null
    ? 0
    : Math.max(0, Math.round(((blockDone ? (end ?? now) : now) - start) / 1000))

  useEffect(() => {
    if (blockDone || start == null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [blockDone, start])

  useEffect(() => {
    if (!blockDone) {
      if (previousDone) setPreviousDone(false)
      return
    }
    // Freeze the fallback end once so a (Codex) block that finishes without
    // persisted timestamps keeps a stable duration instead of drifting.
    if (startedAt == null && start != null && !fallbackEnd) {
      const ended = Date.now()
      setFallbackEnd(ended)
      setNow(ended)
    }
    if (collapseOnDone && !previousDone) setExpanded(false)
    if (!previousDone) setPreviousDone(true)
  }, [blockDone, collapseOnDone, startedAt, start, fallbackEnd, previousDone])

  useEffect(() => {
    if (!showContent) return
    if (!expanded) return
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
    return () => cancelAnimationFrame(rafRef.current)
  }, [expanded, showContent, text])

  useEffect(() => { onExpandedChange?.(expanded) }, [expanded, onExpandedChange])

  const active = !blockDone
  const label = active
    ? (elapsed >= 1 ? t('chat.reasoning.thinkingSeconds', { count: elapsed }) : t('chat.reasoning.thinking'))
    : (start != null && elapsed >= 1 ? t('chat.reasoning.thoughtSeconds', { count: elapsed }) : t('chat.reasoning.thought'))

  return (
    <div className={cn('thinking-node mb-2', isFirst ? 'mt-0' : 'mt-2')}>
      <div
        className={cn(
          'flex items-center gap-1.5 text-xs text-muted-foreground',
          showContent && 'cursor-pointer select-none transition-colors hover:text-foreground',
        )}
        onClick={showContent ? () => setExpanded((v) => !v) : undefined}
      >
        {active
          ? <Brain className="size-3 animate-pulse" />
          : <Brain className="size-3" />
        }
        <span>{label}</span>
        {showContent && (
          <ChevronRight className={cn('size-3 transition-transform duration-200', expanded && 'rotate-90')} />
        )}
      </div>
      {showContent && expanded && (
        <div
          ref={scrollRef}
          className="thinking-content mt-1 max-h-32 overflow-y-auto pl-2 text-xs leading-relaxed text-muted-foreground/80 whitespace-pre-wrap"
        >
          {text}
          {onRetry && <button type="button" className="ml-2 underline" onClick={onRetry}>{t('common.retry')}</button>}
        </div>
      )}
    </div>
  )
})
