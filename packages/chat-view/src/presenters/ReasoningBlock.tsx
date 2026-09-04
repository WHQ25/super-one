import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, ChevronRight } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

export interface ReasoningBlockProps {
  text: string
  blockDone: boolean
  startedAt?: number
  endedAt?: number
  showContent?: boolean
  collapseOnDone?: boolean
  isFirst?: boolean
}

export const ReasoningBlock = memo(function ReasoningBlock({
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
  const [expanded, setExpanded] = useState(showContent && (!blockDone || !collapseOnDone))
  const autoExpandedRef = useRef(showContent && !blockDone)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)

  // Prefer persisted timestamps (Claude): derived from data, they survive session
  // switches / history reload instead of resetting on remount. Providers that don't
  // stamp them (Codex) fall back to mount-time measurement — same as the old behavior.
  const mountStartRef = useRef(!blockDone ? Date.now() : 0)
  const fallbackEndRef = useRef(0)
  const start = startedAt ?? (mountStartRef.current || undefined)
  const end = startedAt != null ? endedAt : (fallbackEndRef.current || undefined)
  const elapsed = start == null
    ? 0
    : Math.max(0, Math.round(((blockDone ? (end ?? now) : now) - start) / 1000))

  useEffect(() => {
    if (blockDone || start == null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [blockDone, start])

  useEffect(() => {
    if (showContent && !blockDone && !autoExpandedRef.current) {
      autoExpandedRef.current = true
      setExpanded(true)
    }
  }, [showContent, blockDone])

  useEffect(() => {
    if (!blockDone) return
    // Freeze the fallback end once so a (Codex) block that finishes without
    // persisted timestamps keeps a stable duration instead of drifting.
    if (startedAt == null && start != null && !fallbackEndRef.current) {
      fallbackEndRef.current = Date.now()
      setNow(fallbackEndRef.current)
    }
    if (showContent && collapseOnDone) setExpanded(false)
  }, [blockDone, showContent, collapseOnDone, startedAt, start])

  useEffect(() => {
    if (!showContent) return
    if (!expanded) return
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
    return () => cancelAnimationFrame(rafRef.current)
  }, [expanded, showContent, text])

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
        </div>
      )}
    </div>
  )
})
