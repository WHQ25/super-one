import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type ReactNode } from 'react'
import { cn } from '@superone/ui/lib/utils'

type Phase = 'steady' | 'leaving' | 'entering'

const ANIMATION_DEADLINE_MS = 600

/** The element whose enter animation is the approval card's rise. */
export function composerStageFrom(node: Node | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>('[data-composer-stage]') : null
}

interface ComposerSwitchProps<K extends string> {
  /** Which composer should be on screen. */
  kind: K
  /** Distinguishes consecutive requests that use the same composer. */
  transitionKey?: string
  render: (kind: K) => ReactNode
  /** Align the voice composer to the measured resting text height. */
  align?: { kind: K; to: K }
  className?: string
  /** Caps a tall composer while keeping its contents inside a scrollable slot. */
  maxHeight?: number | string
  /** Untransformed overlap above the baseline, for user-controlled tail reveal. */
  onOverhangChange?: (px: number) => void
}

/** Motion is a preference, and jsdom has no animations to end — both mean "switch now". */
function motionEnabled(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Bottom-anchored overlay. Only the resting base height participates in layout;
 * the outgoing card drops, then the incoming card rises over the transcript.
 * Neither transform changes the viewport or waits for space to be reclaimed.
 */
export function ComposerSwitch<K extends string>({ kind, transitionKey = kind, render, align, className, maxHeight, onOverhangChange }: ComposerSwitchProps<K>) {
  const [shown, setShown] = useState(kind)
  const [shownKey, setShownKey] = useState(transitionKey)
  const [phase, setPhase] = useState<Phase>('steady')
  const [baseHeight, setBaseHeight] = useState<number | null>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  // Keep the outgoing request's props intact until it drops out. Reading the
  // latest render closure would replace its contents before the animation starts.
  const shownRender = useRef(render)
  const shownMaxHeight = useRef(maxHeight)
  const sameEntry = kind === shown && transitionKey === shownKey
  const heightCap = sameEntry ? maxHeight : shownMaxHeight.current
  // Height of each composer as last seen at rest. The commit that flips `kind` can
  // also be the commit that empties the outgoing composer (hanging up drops the
  // call store to idle, and the voice mark reads that store), so measuring at
  // hand-off time would pin a collapsed slot. Measure only while nothing is
  // changing hands.
  const restingHeights = useRef<Partial<Record<K, number>>>({})
  const initialKind = useRef(kind)
  const base = align?.to ?? initialKind.current
  // The base composer at rest updates the baseline. It can grow without a render
  // (an editor wrapping a line), so the observer measures it, not a commit.
  const baseAtRest = useRef(false)
  // The base composer's shortest height at the slot's current width (a narrower
  // pane can wrap its placeholder). Every composer, the base one growing with its
  // draft included, reports overhang against it, so history keeps one baseline.
  const baseline = useRef<{ width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    baseAtRest.current = phase === 'steady' && sameEntry && shown === base
    if (phase === 'steady' && sameEntry && stageRef.current) {
      shownRender.current = render
      shownMaxHeight.current = maxHeight
      restingHeights.current[shown] = stageRef.current.offsetHeight
    }
  })
  const floor = align?.kind === shown ? restingHeights.current[align.to] : undefined

  // Observe the untransformed stage, never animation frames. A fixed baseline
  // leaves the transcript laid out and painted underneath the moving composer.
  useLayoutEffect(() => {
    const slot = slotRef.current
    const stage = stageRef.current
    if (!slot || !stage) return
    const measure = () => {
      const width = slot.offsetWidth
      // Hidden panes report zero; do not turn that into a permanent baseline.
      if (baseAtRest.current && stage.offsetHeight > 0) {
        const previous = baseline.current?.width === width ? baseline.current.height : Infinity
        baseline.current = { width, height: Math.min(stage.offsetHeight, previous) }
        setBaseHeight(baseline.current.height)
        slot.style.height = `${baseline.current.height}px`
      }
      onOverhangChange?.(Math.max(0, stage.offsetHeight - slot.offsetHeight))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    observer.observe(slot)
    return () => observer.disconnect()
  }, [phase, shown, base, onOverhangChange])

  useLayoutEffect(() => () => onOverhangChange?.(0), [onOverhangChange])

  useEffect(() => {
    if (sameEntry) {
      // Flipped back before the exit finished: nothing to hand off any more.
      if (phase === 'leaving') setPhase('steady')
      return
    }
    if (!motionEnabled()) {
      shownRender.current = render
      shownMaxHeight.current = maxHeight
      setShown(kind)
      setShownKey(transitionKey)
      setPhase('steady')
      return
    }
    if (phase === 'steady') {
      setPhase('leaving')
    }
  }, [kind, transitionKey, phase, shown, sameEntry, render])

  const advance = () => {
    if (phase === 'leaving') {
      shownRender.current = render
      shownMaxHeight.current = maxHeight
      setShown(kind)
      setShownKey(transitionKey)
      setPhase('entering')
    } else if (phase === 'entering') {
      setPhase('steady')
    }
  }
  const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) advance()
  }
  // An animation that never ends (hidden window, display:none) must not strand
  // the wrong composer on screen; the deadline sits well past the longest step.
  useEffect(() => {
    if (phase === 'steady') return
    const deadline = window.setTimeout(advance, ANIMATION_DEADLINE_MS)
    return () => window.clearTimeout(deadline)
  }, [phase, kind, transitionKey]) // the deadline follows the latest target

  return (
    <div
      ref={slotRef}
      data-testid="composer-slot"
      className={cn(
        'relative isolate shrink-0 pointer-events-none',
        className,
      )}
      style={{
        // Native image mode absorbs the full text composer (including its status
        // bar). Use its measured height so wrapping and chat density stay aligned.
        ...(base === undefined || restingHeights.current[base] === undefined ? {} : { '--composer-base-height': `${restingHeights.current[base]}px` }),
        // Clip the slide at the bottom without cutting off the empty chat's
        // directory hint (absolute bottom-full) before it can leave with the box.
        ...(phase === 'steady' ? {} : { clipPath: 'inset(-100vh 0 0)' }),
        // Sessions can open directly on a decision before text has been measured.
        height: baseHeight ?? 'calc(var(--spacing) * 28.5)',
      }}
    >
      <div
        ref={stageRef}
        data-testid="composer-switch"
        data-composer-stage=""
        data-phase={phase}
        onAnimationEnd={handleAnimationEnd}
        style={{ ...(floor === undefined ? {} : { minHeight: floor }), ...(heightCap === undefined ? {} : { maxHeight: heightCap }) }}
        className={cn(
          // Its own capped height controls motion and hit testing, not layout.
          'absolute inset-x-0 bottom-0 flex flex-col bg-background pointer-events-auto',
          heightCap !== undefined && 'overflow-hidden',
          phase === 'leaving' && 'animate-[composer-drop_200ms_ease-in_forwards]',
          phase === 'entering' && 'animate-[composer-rise_240ms_ease-out]',
        )}
      >
        {(phase === 'steady' && sameEntry ? render : shownRender.current)(shown)}
      </div>
    </div>
  )
}
