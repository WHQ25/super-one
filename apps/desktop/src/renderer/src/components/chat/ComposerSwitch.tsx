import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type ReactNode, type TransitionEvent } from 'react'
import { cn } from '@superone/ui/lib/utils'

type Phase = 'steady' | 'leaving' | 'entering' | 'settling'

const ANIMATION_DEADLINE_MS = 600

interface ComposerSwitchProps<K extends string> {
  /** Which composer should be on screen. */
  kind: K
  /** Distinguishes consecutive requests that use the same composer. */
  transitionKey?: string
  render: (kind: K) => ReactNode
  /**
   * `kind` grows to at least `to`'s resting height, so their top edges line up and
   * the hand-off does not change the slot. Every other composer keeps its own height;
   * the slot eases to it once the newcomer has risen.
   */
  align?: { kind: K; to: K }
  className?: string
  /** Caps a tall composer while keeping its contents inside a scrollable slot. */
  maxHeight?: number | string
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
export function ComposerSwitch<K extends string>({ kind, transitionKey = kind, render, align, className, maxHeight }: ComposerSwitchProps<K>) {
  const [shown, setShown] = useState(kind)
  const [shownKey, setShownKey] = useState(transitionKey)
  const [phase, setPhase] = useState<Phase>('steady')
  const [height, setHeight] = useState<number | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  // Keep the outgoing request's props intact until it drops out. Reading the
  // latest render closure would replace its contents before the animation starts.
  const shownRender = useRef(render)
  const sameEntry = kind === shown && transitionKey === shownKey
  // Height of each composer as last seen at rest. The commit that flips `kind` can
  // also be the commit that empties the outgoing composer (hanging up drops the
  // call store to idle, and the voice mark reads that store), so measuring at
  // hand-off time would pin a collapsed slot. Measure only while nothing is
  // changing hands.
  const restingHeights = useRef<Partial<Record<K, number>>>({})
  useLayoutEffect(() => {
    if (phase === 'steady' && sameEntry && stageRef.current) {
      shownRender.current = render
      restingHeights.current[shown] = stageRef.current.offsetHeight
    }
  })
  const floor = align?.kind === shown ? restingHeights.current[align.to] : undefined

  useEffect(() => {
    if (sameEntry) {
      // Flipped back before the exit finished: nothing to hand off any more.
      if (phase === 'leaving') setPhase('steady')
      return
    }
    if (!motionEnabled()) {
      shownRender.current = render
      setShown(kind)
      setShownKey(transitionKey)
      setPhase('steady')
      return
    }
    if (phase === 'steady') {
      setHeight(restingHeights.current[shown] ?? stageRef.current?.offsetHeight ?? null)
      setPhase('leaving')
    }
  }, [kind, transitionKey, phase, shown, sameEntry, render])

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
      shownRender.current = render
      setShown(kind)
      setShownKey(transitionKey)
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
  }, [phase, kind, transitionKey]) // the deadline follows the latest target

  return (
    <div
      data-testid="composer-slot"
      data-height-lock={height === null ? undefined : 'on'}
      onTransitionEnd={handleTransitionEnd}
      className={cn(
        // Composers hug the slot's bottom edge, so a shorter newcomer rises to the
        // same baseline the outgoing one dropped from.
        'flex shrink-0 flex-col justify-end',
        // Clip only while a composer is on its way in or out. At rest the text
        // composer's popups (@ mentions, / commands, todo) sit above the slot with
        // `absolute bottom-full`, and a standing overflow clip would hide them.
        phase !== 'steady' && 'overflow-hidden',
        maxHeight !== undefined && 'overflow-hidden',
        phase === 'settling' && 'transition-[height] duration-200 ease-out',
        className,
      )}
      style={{
        ...(height === null ? {} : { height }),
        ...(maxHeight === undefined ? {} : { maxHeight }),
      }}
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
        {(phase === 'steady' && sameEntry ? render : shownRender.current)(shown)}
      </div>
    </div>
  )
}
