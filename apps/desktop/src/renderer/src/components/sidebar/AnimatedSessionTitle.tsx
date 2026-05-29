import { useEffect, useRef, useState } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore } from '@/stores/chat'
import { resolveSessionTitle } from './session-state-utils'

const OUT_MS = 220
const CHAR_STAGGER_MS = 55
const FLIP_DURATION_MS = 360
const IN_TAIL_MS = 120

type Phase = 'idle' | 'out' | 'in'

export function useSessionTitleByAgent(
  sessionId: string | null | undefined,
  fallback: string | null | undefined,
): string {
  const agentTitle = useChatStore((s) => (sessionId ? s.agentTitles[sessionId] : undefined))
  return resolveSessionTitle(agentTitle, undefined, fallback, '')
}

interface SessionTitleAnimatedProps {
  sessionId: string | null | undefined
  fallback: string | null | undefined
  className?: string
}

export function SessionTitleAnimated({ sessionId, fallback, className }: SessionTitleAnimatedProps) {
  const targetTitle = useSessionTitleByAgent(sessionId, fallback)
  const [displayTitle, setDisplayTitle] = useState(targetTitle)
  const [phase, setPhase] = useState<Phase>('idle')
  const [writeKey, setWriteKey] = useState(0)
  const prevTitleRef = useRef(targetTitle)
  const prevSessionIdRef = useRef(sessionId)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    if (sessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = sessionId
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
      prevTitleRef.current = targetTitle
      setDisplayTitle(targetTitle)
      setPhase('idle')
      return
    }

    if (targetTitle === prevTitleRef.current) return

    timersRef.current.forEach(clearTimeout)

    const nextTitle = targetTitle
    setPhase('out')

    const inMs = Math.max(0, nextTitle.length - 1) * CHAR_STAGGER_MS + FLIP_DURATION_MS + IN_TAIL_MS

    const t1 = setTimeout(() => {
      prevTitleRef.current = nextTitle
      setDisplayTitle(nextTitle)
      setWriteKey((k) => k + 1)
      setPhase('in')
    }, OUT_MS)

    const t2 = setTimeout(() => {
      setPhase('idle')
    }, OUT_MS + inMs)

    timersRef.current = [t1, t2]

    return () => {
      timersRef.current.forEach(clearTimeout)
    }
  }, [targetTitle, sessionId])

  const chars = [...displayTitle]
  const isWriting = phase === 'in'

  return (
    <span
      className={cn('animated-title-wrap relative inline-block min-w-0 max-w-full align-middle', className)}
      data-phase={phase}
    >
      <span className="animated-title-inner">
        {chars.map((ch, i) => (
          <span
            key={`${writeKey}-${i}`}
            className={cn('animated-title-ch', isWriting && 'is-flip')}
            style={isWriting ? { animationDelay: `${i * CHAR_STAGGER_MS}ms` } : undefined}
          >
            {ch}
          </span>
        ))}
      </span>
    </span>
  )
}
