import { useState, useEffect, useRef } from 'react'
import { createCodePlugin } from '@streamdown/code'
import { createStreamdownCodeComponent } from './CodeBlock'

/** Shared code highlighter plugin instance — reused across all chat components. */
export const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] })

/** Shared Streamdown plugins config. */
export const streamdownPlugins = { code: codePlugin }

/** Shared Streamdown controls config. */
export const streamdownControls = { table: false }

/** Shared Streamdown code component. */
export const streamdownComponents: Record<string, ReturnType<typeof createStreamdownCodeComponent>> = {
  code: createStreamdownCodeComponent(codePlugin),
}

const TOKEN_ANIMATION_MIN_DURATION_MS = 300

/** Format token count: plain number if < 1k, otherwise k with 1 decimal. */
export function formatTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** Duration for token animations, with a minimum to avoid abrupt jumps. */
export function getTokenAnimationDurationMs(from: number, to: number): number {
  const delta = Math.abs(to - from)
  // < 1000: 100 tokens/s; >= 1000: 10 display-steps/s × 100 = 1000 tokens/s
  const rate = to >= 1000 ? 1000 : 100
  return Math.max(TOKEN_ANIMATION_MIN_DURATION_MS, (delta / rate) * 1000)
}

/** Animate a number ticking up: < 1k by 1 (100/s), >= 1k by 0.1k (10 updates/s). */
export function useAnimatedTokens(target: number): number {
  const [display, setDisplay] = useState(target)
  const ref = useRef({ from: target, to: target, rafId: 0, start: 0, lastSet: 0 })

  useEffect(() => {
    if (target === ref.current.to) return
    ref.current.from = ref.current.to
    ref.current.to = target
    ref.current.start = performance.now()
    ref.current.lastSet = 0

    const duration = getTokenAnimationDurationMs(ref.current.from, ref.current.to)
    // Throttle setState: < 1000 → 100 calls/s (10ms), >= 1000 → 30 calls/s (~33ms)
    const minInterval = ref.current.to >= 1000 ? 33 : 10

    const tick = (now: number) => {
      const p = Math.min((now - ref.current.start) / duration, 1)
      if (p >= 1) {
        setDisplay(ref.current.to)
        return
      }
      if (now - ref.current.lastSet >= minInterval) {
        const eased = 1 - (1 - p) ** 3
        const raw = ref.current.from + (ref.current.to - ref.current.from) * eased
        const snapped = raw >= 1000 ? Math.round(raw / 100) * 100 : Math.round(raw)
        setDisplay(snapped)
        ref.current.lastSet = now
      }
      ref.current.rafId = requestAnimationFrame(tick)
    }

    cancelAnimationFrame(ref.current.rafId)
    ref.current.rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(ref.current.rafId)
  }, [target])

  return display
}
