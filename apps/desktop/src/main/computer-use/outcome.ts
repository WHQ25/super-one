import type { ActionOutcome, StateDiff, UiAction, UiOutlineNode } from './types'

export type OutcomeStep = {
  applied: boolean
  confirmedNoEffect?: boolean
  unknown?: boolean
}

/**
 * Base outcome from native step flags only (no successor re-observation).
 * AX press often lands as applied+unknown because the control's own value does not change.
 */
export function deriveOutcomeFromSteps(steps: OutcomeStep[]): ActionOutcome {
  if (steps.length === 0) return 'didnt'
  // Any hard failure → didnt (even if other steps claimed unknown).
  if (steps.some((s) => s.confirmedNoEffect || !s.applied)) {
    if (steps.every((s) => !s.applied || s.confirmedNoEffect)) return 'didnt'
  }
  if (steps.some((s) => s.unknown)) return 'unknown'
  if (steps.every((s) => s.applied && !s.confirmedNoEffect)) return 'worked'
  if (steps.some((s) => s.confirmedNoEffect || !s.applied)) return 'didnt'
  return 'unknown'
}

/**
 * Whether a successor outline diff is strong enough to treat an applied-but-unknown
 * action as successful. Tuned for navigation (press History) without promoting
 * ambient single-field churn (clock, weather).
 */
export function diffIndicatesEffect(diff: StateDiff): boolean {
  const structural = diff.added.length + diff.removed.length
  const changed = diff.changed.length
  // Topology rewrite / full re-root — e.g. page navigations with unstable refs.
  if (diff.fullViewFallback) return true
  // Several nodes entered/left the tree (panel open, route change).
  if (structural >= 3) return true
  // One structural shift plus several field updates (tab switch with stable refs).
  if (structural >= 1 && changed >= 3) return true
  // Stable ref identity but many labels/values swapped (content region refresh).
  if (changed >= 8) return true
  return false
}

function outlineContainsText(outline: UiOutlineNode, text: string): boolean {
  if (!text) return false
  const stack = [outline]
  while (stack.length) {
    const n = stack.pop()!
    if ((n.name ?? '').includes(text) || (n.value ?? '').includes(text)) return true
    if (n.children) stack.push(...n.children)
  }
  return false
}

/**
 * Lift step-level unknown to worked when re-observation proves an effect.
 * Never upgrades didnt; never invents success when no step applied.
 */
export function refineActOutcome(options: {
  steps: OutcomeStep[]
  actions: UiAction[]
  successorOutline: UiOutlineNode
  diff: StateDiff
  /** Result of evaluating options.expect against the successor, when provided. */
  expectHolds?: boolean | null
}): ActionOutcome {
  let outcome = deriveOutcomeFromSteps(options.steps)

  if (options.expectHolds === true && outcome === 'unknown') outcome = 'worked'
  if (options.expectHolds === false && outcome === 'worked') outcome = 'didnt'
  // Explicit expect failure always wins over diff heuristics.
  if (options.expectHolds === false) {
    if (outcome === 'unknown') outcome = 'didnt'
    return outcome
  }

  // Typed/set text appears in successor outline → worked.
  if (outcome === 'unknown') {
    for (const a of options.actions) {
      if ((a.type === 'typeText' || a.type === 'setText') && a.text) {
        if (outlineContainsText(options.successorOutline, a.text)) {
          outcome = 'worked'
          break
        }
      }
    }
  }

  // Step-level before/after already confirmed (setText readback).
  if (outcome === 'unknown') {
    const confirmed = options.steps.some(
      (s) => s.applied && !s.unknown && !s.confirmedNoEffect,
    )
    if (confirmed) outcome = 'worked'
  }

  // Applied press/click/etc. with no per-control readback, but successor tree moved.
  // Covers semantic press on "历史" where the button label stays the same.
  if (outcome === 'unknown') {
    const allApplied = options.steps.length > 0
      && options.steps.every((s) => s.applied && !s.confirmedNoEffect)
    if (allApplied && diffIndicatesEffect(options.diff)) {
      outcome = 'worked'
    }
  }

  return outcome
}
