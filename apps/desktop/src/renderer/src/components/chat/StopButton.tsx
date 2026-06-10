import { useState, useRef, useCallback, useEffect } from 'react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
const STOP_COLOR = '#E24B4A'

const HOLD_DURATION = 600
const DEAD_ZONE = 100

interface StopButtonProps {
  onInterrupt: () => void
}

export function StopButton({ onInterrupt }: StopButtonProps) {
  const [progress, setProgress] = useState(0)
  const startTimeRef = useRef<number | null>(null)
  const rafRef = useRef<number>(0)
  const triggeredRef = useRef(false)

  const reset = useCallback(() => {
    startTimeRef.current = null
    triggeredRef.current = false
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setProgress(0)
  }, [])

  const animate = useCallback(() => {
    if (!startTimeRef.current || triggeredRef.current) return
    const elapsed = Date.now() - startTimeRef.current
    if (elapsed < DEAD_ZONE) {
      rafRef.current = requestAnimationFrame(animate)
      return
    }
    const p = Math.min((elapsed - DEAD_ZONE) / (HOLD_DURATION - DEAD_ZONE), 1)
    setProgress(p)
    if (p >= 1) {
      triggeredRef.current = true
      onInterrupt()
      setTimeout(reset, 300)
      return
    }
    rafRef.current = requestAnimationFrame(animate)
  }, [onInterrupt, reset])

  const startHold = useCallback(() => {
    if (startTimeRef.current) return
    startTimeRef.current = Date.now()
    triggeredRef.current = false
    rafRef.current = requestAnimationFrame(animate)
  }, [animate])

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

  const isHolding = progress > 0
  const size = 28
  const r = size / 2 - 1
  const circumference = 2 * Math.PI * r

  return (
    <IconButton
      variant="ghost"
      onClick={() => {
        if (!triggeredRef.current) onInterrupt()
      }}
      className="relative size-7 rounded-full border border-border"
    >
      {isHolding && (
        <svg
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
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
      )}
      <svg viewBox="0 0 24 24" className="size-3">
        <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke={isHolding ? STOP_COLOR : 'currentColor'} strokeWidth="2" />
        {isHolding && (
          <rect x="3" y="3" width="18" height="18" rx="2" fill={STOP_COLOR} opacity={progress} />
        )}
      </svg>
    </IconButton>
  )
}
