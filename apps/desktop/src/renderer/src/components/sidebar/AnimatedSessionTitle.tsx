import { useRef } from 'react'
import { motion } from 'motion/react'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore } from '@/stores/chat'

const TARGET_MS = 1000
const FADE_MS = 350
const EASE = [0.3, 0, 0.2, 1] as const

export function useSessionTitleByAgent(
  sessionId: string | null | undefined,
  fallback: string | null | undefined,
): string {
  const agentTitle = useChatStore((s) => (sessionId ? s.agentTitles[sessionId] : undefined))
  return agentTitle ?? fallback ?? ''
}

interface SessionTitleAnimatedProps {
  sessionId: string | null | undefined
  fallback: string | null | undefined
  className?: string
}

export function SessionTitleAnimated({ sessionId, fallback, className }: SessionTitleAnimatedProps) {
  const title = useSessionTitleByAgent(sessionId, fallback)
  const initialTitleRef = useRef(title)
  const animate = title !== initialTitleRef.current

  const chars = [...title]
  const stagger = chars.length > 1 ? (TARGET_MS - FADE_MS) / (chars.length - 1) : 0

  return (
    <span className={cn('relative min-w-0 truncate', className)}>
      <span key={title} className="block truncate">
        {chars.map((ch, i) => (
          <motion.span
            key={i}
            initial={animate ? { opacity: 0, y: 6 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: FADE_MS / 1000,
              delay: (i * stagger) / 1000,
              ease: EASE,
            }}
            style={{ display: 'inline-block', whiteSpace: 'pre' }}
          >
            {ch}
          </motion.span>
        ))}
      </span>
    </span>
  )
}
