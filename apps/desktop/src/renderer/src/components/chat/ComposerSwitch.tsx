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
   * the hand-off does not change the slot. The slot grows with a taller newcomer
   * and shrinks to a shorter one once it has risen.
   */
  align?: { kind: K; to: K }
  className?: string
  /** Caps a tall composer while keeping its contents inside a scrollable slot. */
  maxHeight?: number | string
  /**
   * Reports, on every slot resize, how much taller the slot is than `align.to`'s
   * resting height. Content centred above the slot uses it to stay put while
   * another composer stands in.
   */
  onOverhangChange?: (px: number) => void
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
 * The slot holds the outgoing height during exit, then grows with a taller
 * newcomer's rise so its top stays inside the clipping edge. A shorter newcomer
 * keeps the outgoing space until it has fully risen, then the slot eases down;
 * chat history does not reclaim that space while the composer is still entering.
 * The slot marks itself `data-composer-handoff` meanwhile, and the transcript
 * keeps its scroll position instead of re-pinning to the bottom: history stays
 * still, and anything the taller newcomer displaces stays reachable by scrolling.
 *
 * The outgoing composer stays mounted until its exit animation ends, so a call
 * that ends mid-caption still slides away intact instead of vanishing.
 */
export function ComposerSwitch<K extends string>({ kind, transitionKey = kind, render, align, className, maxHeight, onOverhangChange }: ComposerSwitchProps<K>) {
  const [shown, setShown] = useState(kind)
  const [shownKey, setShownKey] = useState(transitionKey)
  const [phase, setPhase] = useState<Phase>('steady')
  const [height, setHeight] = useState<number | null>(null)
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
  useLayoutEffect(() => {
    if (phase === 'steady' && sameEntry && stageRef.current) {
      shownRender.current = render
      shownMaxHeight.current = maxHeight
      restingHeights.current[shown] = stageRef.current.offsetHeight
    }
  })
  const floor = align?.kind === shown ? restingHeights.current[align.to] : undefined

  // ResizeObserver delivers after layout and before paint, so the report lands
  // in the same frame as each step of the slot's height transition.
  const base = align?.to
  useLayoutEffect(() => {
    const slot = slotRef.current
    if (!slot || !onOverhangChange || base === undefined) return
    const observer = new ResizeObserver(() => {
      const resting = restingHeights.current[base]
      onOverhangChange(resting === undefined ? 0 : slot.offsetHeight - resting)
    })
    observer.observe(slot)
    return () => {
      observer.disconnect()
      onOverhangChange(0)
    }
  }, [base, onOverhangChange])

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
      setHeight(restingHeights.current[shown] ?? stageRef.current?.offsetHeight ?? null)
      setPhase('leaving')
    }
  }, [kind, transitionKey, phase, shown, sameEntry, render])

  // Growth shares the rise's duration and easing: the clipping edge moves up at
  // least as fast as the newcomer's top. Shrinking waits until the rise finishes.
  useLayoutEffect(() => {
    if (phase === 'steady') {
      setHeight(null)
      return
    }
    const target = stageRef.current?.offsetHeight ?? null
    if (phase === 'entering') {
      if (target !== null && height !== null && target > height) setHeight(target)
      return
    }
    if (phase !== 'settling') return
    if (target === null || target === height) setPhase('steady')
    else setHeight(target)
  }, [phase]) // `height` is only compared, never driven, here

  const advance = () => {
    if (phase === 'leaving') {
      shownRender.current = render
      shownMaxHeight.current = maxHeight
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
      ref={slotRef}
      data-testid="composer-slot"
      data-height-lock={height === null ? undefined : 'on'}
      // The transcript reads this to hold its scroll position while the slot resizes.
      data-composer-handoff={phase === 'steady' ? undefined : ''}
      onTransitionEnd={handleTransitionEnd}
      className={cn(
        // Composers hug the slot's bottom edge, so a shorter newcomer rises to the
        // same baseline the outgoing one dropped from.
        'flex shrink-0 flex-col justify-end',
        // Clip only while a composer is on its way in or out. At rest the text
        // composer's popups (@ mentions, / commands, todo) sit above the slot with
        // `absolute bottom-full`, and a standing overflow clip would hide them.
        phase !== 'steady' && 'overflow-hidden',
        heightCap !== undefined && 'overflow-hidden',
        phase === 'entering' && 'transition-[height] duration-240 ease-[ease-out]',
        phase === 'settling' && 'transition-[height] duration-200 ease-out',
        className,
      )}
      style={{
        ...(height === null ? {} : { height }),
        ...(heightCap === undefined ? {} : { maxHeight: heightCap }),
      }}
    >
      <div
        ref={stageRef}
        data-testid="composer-switch"
        data-phase={phase}
        onAnimationEnd={handleAnimationEnd}
        style={{ ...(floor === undefined ? {} : { minHeight: floor }), ...(heightCap === undefined ? {} : { maxHeight: heightCap }) }}
        className={cn(
          // Measure the newcomer's own (capped) height, independently of the locked slot.
          'flex shrink-0 flex-col',
          phase === 'leaving' && 'animate-[composer-drop_200ms_ease-in_forwards]',
          phase === 'entering' && 'animate-[composer-rise_240ms_ease-out]',
        )}
      >
        {(phase === 'steady' && sameEntry ? render : shownRender.current)(shown)}
      </div>
    </div>
  )
}
