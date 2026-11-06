import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'

const STOP_COLOR = '#E24B4A'

const HOLD_DURATION = 600
const DEAD_ZONE = 100

interface StopButtonProps {
  onInterrupt: () => void | Promise<void>
  /** Session-scoped request state survives composer remounts and pane switches. */
  stopping?: boolean
}

export function StopButton({ onInterrupt, stopping = false }: StopButtonProps) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const [progress, setProgress] = useState(0)
  const [requested, setRequested] = useState(false)
  const cancelling = stopping || requested
  const startTimeRef = useRef<number | null>(null)
  const rafRef = useRef<number>(0)
  const triggeredRef = useRef(false)

  const reset = useCallback(() => {
    startTimeRef.current = null
    triggeredRef.current = false
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setProgress(0)
    setRequested(false)
  }, [])

  const fireInterrupt = useCallback(() => {
    if (triggeredRef.current) return
    triggeredRef.current = true
    setProgress(1)
    setRequested(true)
    void Promise.resolve().then(onInterrupt).then(reset, reset)
  }, [onInterrupt, reset])

  const animate = useCallback(() => {
    if (startTimeRef.current === null || triggeredRef.current) return
    const elapsed = Date.now() - startTimeRef.current
    if (elapsed < DEAD_ZONE) {
      rafRef.current = requestAnimationFrame(animate)
      return
    }
    const p = Math.min((elapsed - DEAD_ZONE) / (HOLD_DURATION - DEAD_ZONE), 1)
    setProgress(p)
    if (p >= 1) {
      fireInterrupt()
      return
    }
    rafRef.current = requestAnimationFrame(animate)
  }, [fireInterrupt])

  const startHold = useCallback(() => {
    if (startTimeRef.current !== null || triggeredRef.current || cancelling) return
    startTimeRef.current = Date.now()
    triggeredRef.current = false
    rafRef.current = requestAnimationFrame(animate)
  }, [animate, cancelling])

  const endHold = useCallback(() => {
    if (!triggeredRef.current) reset()
  }, [reset])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.repeat) startHold()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endHold()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [startHold, endHold])

  const isHolding = progress > 0 && !cancelling
  const showRing = isHolding || cancelling
  const size = 24
  const r = size / 2 - 1
  const circumference = 2 * Math.PI * r
  // Keep the stop square visible while the completion receipt is in flight.
  const segmentLen = circumference / 16

  return (
    <IconButton
      variant="ghost"
      aria-label={t(cancelling ? 'chat.stoppingGeneration' : 'chat.stopGeneration')}
      title={t(cancelling ? 'chat.stoppingGeneration' : 'chat.stopGeneration')}
      aria-busy={cancelling || undefined}
      aria-disabled={cancelling || undefined}
      onClick={() => {
        if (!triggeredRef.current && !cancelling) fireInterrupt()
      }}
      className={[
        'relative size-6 rounded-full border border-border',
        cancelling ? 'pointer-events-none' : '',
      ].filter(Boolean).join(' ')}
    >
      {showRing && (
        <motion.svg
          aria-hidden="true"
          animate={{ rotate: cancelling && !reducedMotion ? 360 : 0 }}
          transition={cancelling && !reducedMotion ? { duration: 0.85, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
          viewBox={`0 0 ${size} ${size}`}
          className="pointer-events-none absolute inset-0 size-full"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={STOP_COLOR}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={
              cancelling
                ? `${segmentLen} ${segmentLen}`
                : circumference
            }
            strokeDashoffset={cancelling ? 0 : circumference * (1 - progress)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </motion.svg>
      )}
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3">
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="2"
          fill="none"
          stroke={showRing ? STOP_COLOR : 'currentColor'}
          strokeWidth="2"
        />
        {showRing && (
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="2"
            fill={STOP_COLOR}
            opacity={cancelling ? 1 : progress}
          />
        )}
      </svg>
    </IconButton>
  )
}
