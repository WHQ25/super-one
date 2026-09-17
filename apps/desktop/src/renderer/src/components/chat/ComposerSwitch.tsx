import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type ReactNode, type TransitionEvent } from 'react'
import { cn } from '@superone/ui/lib/utils'

type Phase = 'steady' | 'leaving' | 'entering' | 'settling'

const ANIMATION_DEADLINE_MS = 600

interface ComposerSwitchProps<K extends string> {
  /** Which composer should be on screen. */
  kind: K
  render: (kind: K) => ReactNode
  /**
   * A composer whose resting height every other composer should at least fill,
   * so their top edges line up and the hand-off does not change the slot.
   */
  alignTo?: K
  className?: string
}

/** Motion is a preference, and jsdom has no animations to end — both mean "switch now". */
function motionEnabled(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Hands the composer slot from one composer to another as a hand-off rather than
 * a cut: the outgoing one drops out through the bottom edge, then the incoming
 * one rises from where it left. Both directions (voice → text on hang-up, text →
 * voice on start) use the same choreography so the swap reads as one gesture.
 *
 * The slot's height is pinned at the outgoing composer's height for the whole
 * hand-off, and only once the newcomer has fully risen does it ease to the
 * newcomer's own height. The transcript above fills the remaining space, so any
 * earlier change would pull chat history down into the slot while the newcomer
 * is still on its way up — it would rise over history instead of empty ground.
 *
 * The outgoing composer stays mounted until its exit animation ends, so a call
 * that ends mid-caption still slides away intact instead of vanishing.
 */
export function ComposerSwitch<K extends string>({ kind, render, alignTo, className }: ComposerSwitchProps<K>) {
  const [shown, setShown] = useState(kind)
  const [phase, setPhase] = useState<Phase>('steady')
  const [height, setHeight] = useState<number | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  // Height of each composer as last seen at rest. The commit that flips `kind` can
  // also be the commit that empties the outgoing composer (hanging up drops the
  // call store to idle, and the voice mark reads that store), so measuring at
  // hand-off time would pin a collapsed slot. Measure only while nothing is
  // changing hands.
  const restingHeights = useRef<Partial<Record<K, number>>>({})
  useLayoutEffect(() => {
    if (phase === 'steady' && kind === shown && stageRef.current) {
      restingHeights.current[shown] = stageRef.current.offsetHeight
    }
  })
  const floor = alignTo !== undefined && alignTo !== shown ? restingHeights.current[alignTo] : undefined

  useEffect(() => {
    if (kind === shown) {
      // Flipped back before the exit finished: nothing to hand off any more.
      if (phase === 'leaving') setPhase('steady')
      return
    }
    if (!motionEnabled()) {
      setShown(kind)
      setPhase('steady')
      return
    }
    if (phase === 'steady') {
      setHeight(restingHeights.current[shown] ?? stageRef.current?.offsetHeight ?? null)
      setPhase('leaving')
    }
  }, [kind, phase, shown])

  // The newcomer has settled: now ease the slot to its height, then let it go.
  // A slot already at that height has nothing to transition and goes straight to rest.
  useLayoutEffect(() => {
    if (phase === 'steady') {
      setHeight(null)
      return
    }
    if (phase !== 'settling') return
    const target = stageRef.current?.offsetHeight ?? null
    if (target === null || target === height) setPhase('steady')
    else setHeight(target)
  }, [phase]) // `height` is only compared, never driven, here

  const advance = () => {
    if (phase === 'leaving') {
      setShown(kind)
      setPhase('entering')
    } else if (phase === 'entering') {
      setPhase('settling')
    } else if (phase === 'settling') {
      setPhase('steady')
    }
  }
  const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) advance()
  }
  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.propertyName === 'height' && phase === 'settling') advance()
  }
  // An animation that never ends (hidden window, display:none) must not strand
  // the wrong composer on screen; the deadline sits well past the longest step.
  useEffect(() => {
    if (phase === 'steady') return
    const deadline = window.setTimeout(advance, ANIMATION_DEADLINE_MS)
    return () => window.clearTimeout(deadline)
  }, [phase, kind]) // `advance` only reads phase/kind

  return (
    <div
      data-testid="composer-slot"
      data-height-lock={height === null ? undefined : 'on'}
      onTransitionEnd={handleTransitionEnd}
      className={cn(
        // Composers hug the slot's bottom edge, so a shorter newcomer rises to the
        // same baseline the outgoing one dropped from.
        'flex shrink-0 flex-col justify-end overflow-hidden',
        phase === 'settling' && 'transition-[height] duration-200 ease-out',
        className,
      )}
      style={height === null ? undefined : { height }}
    >
      <div
        ref={stageRef}
        data-testid="composer-switch"
        data-phase={phase}
        onAnimationEnd={handleAnimationEnd}
        style={floor === undefined ? undefined : { minHeight: floor }}
        className={cn(
          'flex flex-col',
          phase === 'leaving' && 'animate-[composer-drop_200ms_ease-in_forwards]',
          phase === 'entering' && 'animate-[composer-rise_240ms_ease-out]',
        )}
      >
        {render(shown)}
      </div>
    </div>
  )
}
