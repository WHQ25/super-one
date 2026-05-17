import { useEffect, useRef, useState } from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { useMockT } from "../i18n"

export function ReasoningBlock({
  text,
  blockDone,
  showContent = true,
  collapseOnDone = true,
  isFirst = false,
  frame,
  fps,
}: {
  text: string
  blockDone: boolean
  showContent?: boolean
  collapseOnDone?: boolean
  isFirst?: boolean
  frame?: number
  fps?: number
}) {
  const t = useMockT()
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(!blockDone ? Date.now() : 0)
  const [expanded, setExpanded] = useState(showContent && (!blockDone || !collapseOnDone))
  const autoExpandedRef = useRef(showContent && !blockDone)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    if (blockDone || !startRef.current) return
    const id = setInterval(() => {
      setElapsed(Math.round((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [blockDone])

  useEffect(() => {
    if (showContent && !blockDone && !autoExpandedRef.current) {
      autoExpandedRef.current = true
      setExpanded(true)
    }
  }, [showContent, blockDone])

  useEffect(() => {
    if (!showContent) return
    if (!blockDone) return
    if (startRef.current) setElapsed(Math.round((Date.now() - startRef.current) / 1000))
    if (collapseOnDone) setExpanded(false)
  }, [blockDone, showContent, collapseOnDone])

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
    ? (elapsed >= 1 ? t("chat.reasoning.thinkingSeconds", { count: elapsed }) : t("chat.reasoning.thinking"))
    : (startRef.current > 0 && elapsed >= 1 ? t("chat.reasoning.thoughtSeconds", { count: elapsed }) : t("chat.reasoning.thought"))

  const frameDriven = frame !== undefined && fps !== undefined && fps > 0
  const breathingOpacity = frameDriven
    ? 0.75 + 0.25 * Math.cos((2 * Math.PI * (frame as number)) / (2 * (fps as number)))
    : undefined

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
          ? (
            <Brain
              className={cn('size-3', !frameDriven && 'animate-pulse')}
              style={frameDriven ? { opacity: breathingOpacity } : undefined}
            />
          )
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
}
