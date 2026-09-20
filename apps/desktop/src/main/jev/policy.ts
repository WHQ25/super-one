/**
 * The per-step decision table (research doc §3.6). Pure: answers in, decision out.
 *
 * Thresholds are starting points, calibrated against JEV_MODEL; the trace keeps
 * every probability so they can be re-fit from real runs.
 */

import { type ActionSpace, clickKindOf, elementByIndex, type SpaceElement } from './action-space'

import { NONE, type ActionOption, ACTION_OPTIONS, type Preset } from './questions'
import { type JevAnswer, readNoul, validateChoice } from './typesafe-client'

export const THRESHOLDS = {
  stillLoading: 0.7,
  /**
   * Jev's own completion verdict; the loop confirms it on a fresh observation
   * before finishing. Calibration (Wikipedia history task): 0.81–0.82 on the
   * finished page, at most 0.09 on every page before it.
   */
  goalSatisfied: 0.7,
  /**
   * Enough to finish only when the action head is also sure nothing on the page
   * advances the goal. Calibration, browser: finished pages read 0.63–0.86,
   * pages short of the goal at most 0.11. Desktop finished pages read lower —
   * 0.57 / 0.62 after TextEdit's Save (§10.9), 0.45 after an append and 0.49
   * after an Escape (§11.5–11.6), each with none_useful ≥ 0.64 — while every
   * unfinished desktop page read at most 0.18; at 0.5 two finished runs ended
   * in a no-progress pause instead.
   */
  goalSatisfiedIdle: 0.4,
  /**
   * Typing is gated (a wrong field gets wrong text); clicks are not — Jev's
   * risk verdict decides what needs a confirmation, and a wrong safe click
   * costs one re-observation.
   */
  write: 0.7,
  presetMatch: 0.7,
  /**
   * A click target this sure overrides an action head that said none_useful.
   * The action head weighs the whole page; the target head answers "which
   * one, if a click" and puts its mass on none_of_these when nothing fits.
   */
  overrideNone: 0.8,
  /** Jev's verdict that the chosen step is irreversible; at or above it the caller is asked first. */
  risk: 0.5,
} as const

export type PauseReason = 'uncertain' | 'risky' | 'no-progress' | 'budget'

export interface QuestionOption {
  key: string
  label: string
  probability?: number
}

export interface Question {
  id: string
  type: 'choice' | 'value'
  options?: QuestionOption[]
  schema?: Record<string, unknown>
  context: Record<string, unknown>
  reason: PauseReason
}

export type Decision =
  | { kind: 'wait'; why: string }
  /** Jev rates the goal satisfied; the loop re-observes once and asks again before it trusts this. */
  | { kind: 'done'; why: string; probability: number }
  | { kind: 'click'; key: string; element: SpaceElement; probability: number; risk: number }
  | { kind: 'type_text' | 'append'; element: SpaceElement; text: string; presetKey: string; probability: number; risk: number }
  /** `element` is the scroll area Jev chose; absent, the adapter scrolls its default one. */
  | { kind: 'scroll'; direction: 'down' | 'up'; element?: SpaceElement }
  /** Press Escape: the one key with a closed meaning the loop offers on its own. */
  | { kind: 'escape'; risk: number }
  /** Continue in another root of the same app; `element.root` names it. */
  | { kind: 'switch'; element: SpaceElement; probability: number; risk: number }
  | {
    kind: 'pause'
    question: Omit<Question, 'id'>
    /** What an answered element index means when the run resumes. */
    mode: 'click' | 'type_text' | 'append' | 'switch' | 'escape' | 'accept'
    element?: SpaceElement
    /** Preset already matched to the offered field, so a resume can type it without asking again. */
    presetKey?: string
  }

export interface DecideInput {
  answers: Record<string, JevAnswer>
  space: ActionSpace
  presets: readonly Preset[]
  /**
   * The caller supplied a machine condition. It is a fast path — the loop
   * checks it before every ask — not the only way to finish, so it only
   * changes how a completion is worded.
   */
  doneWhenGiven: boolean
  consecutiveWaits: number
  scrolledSinceChange: boolean
  page: { url: string; title: string }
}

/** A caller who gave a condition needs to know its own test never confirmed this. */
function doneWhy(satisfied: number, doneWhenGiven: boolean): string {
  const base = `goal_satisfied ${satisfied.toFixed(2)}`
  return doneWhenGiven ? `${base} (done_when never matched)` : base
}

function option(el: SpaceElement, probability?: number, prefix = ''): QuestionOption {
  return { key: `${prefix}${el.index}`, label: `${el.role} ${el.label}`, ...(probability != null ? { probability } : {}) }
}

function topK(space: ActionSpace, probabilities: Record<string, number>, k = 5): QuestionOption[] {
  return Object.entries(probabilities)
    .filter(([key]) => key !== NONE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .flatMap(([key, p]) => {
      const el = elementByIndex(space, key)
      return el ? [{ ...option(el, p), key }] : []
    })
}

const ABORT: QuestionOption = { key: 'abort', label: 'Stop; hand control back to you' }
/** Candidates offered in a no-progress pause; the rest are still visible in the snapshot. */
const MAX_PAUSE_OPTIONS = 24

function decisionSummary(answers: Record<string, JevAnswer>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [id, a] of Object.entries(answers)) {
    out[id] = a.type === 'noul' ? a.noul : { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities }
  }
  return out
}

/** Words too generic to identify a field on their own. */
const HINT_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'in', 'on', 'and', 'or', 'field', 'box', 'input', 'textbox', 'textarea', 'editor', 'area', 'text'])

function hintTokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !HINT_STOPWORDS.has(t))
}

/**
 * Presets whose `field` hint (or key) shares a meaningful word with the element
 * label — "the search box" matches "Search Wikipedia". The first wins.
 */
export function presetByHint(el: SpaceElement, presets: readonly Preset[]): Preset | undefined {
  const label = hintTokens(el.label)
  if (label.length === 0) return undefined
  return presets.find((p) => hintTokens(p.field ?? p.key).some((t) => label.includes(t)))
}

export function presetByJev(el: SpaceElement, presets: readonly Preset[], answers: Record<string, JevAnswer>, candidates: string[]): { preset: Preset; probability: number } | undefined {
  let best: { preset: Preset; probability: number } | undefined
  for (const preset of presets) {
    const a = validateChoice(answers[`field_for_${preset.key}`], [...candidates, NONE])
    if (!a || a.choice !== el.index) continue
    const p = a.probabilities[el.index]
    if (p >= THRESHOLDS.presetMatch && (!best || p > best.probability)) best = { preset, probability: p }
  }
  return best
}

export function decide(input: DecideInput): Decision {
  const { answers, space, presets, doneWhenGiven, consecutiveWaits, page } = input
  const summary = decisionSummary(answers)
  const loading = readNoul(answers.still_loading)
  if (loading != null && loading >= THRESHOLDS.stillLoading && consecutiveWaits < 3) {
    return { kind: 'wait', why: `still_loading ${loading.toFixed(2)}` }
  }
  // Completion is Jev's call: it sees the page, the caller does not. A given
  // done_when is checked before every ask, so reaching here means it has not
  // matched — but a condition bound to a ref the app has since replaced can
  // never match, and refusing to finish on that basis leaves a run circling a
  // goal it already reached. The verdict still stands; the wording says the
  // caller's condition did not confirm it.
  const satisfied = readNoul(answers.goal_satisfied)
  if (satisfied != null && satisfied >= THRESHOLDS.goalSatisfied) {
    return { kind: 'done', why: doneWhy(satisfied, doneWhenGiven), probability: satisfied }
  }
  const risk = readNoul(answers.next_step_risk) ?? 0

  const offered = ACTION_OPTIONS.filter((o) => {
    if (o === 'click') return space.clickCandidates.length > 0
    if (o === 'type_text') return space.typeCandidates.length > 0
    if (o === 'append') return space.appendCandidates.length > 0
    if (o === 'escape') return space.canEscape
    if (o === 'switch') return space.switchCandidates.length > 0
    if (o === 'scroll_down') return space.canScrollDown
    if (o === 'scroll_up') return space.canScrollUp
    return true
  })
  const action = validateChoice(answers.action, offered)
  const chosen: ActionOption | 'invalid' = action ? (action.choice as ActionOption) : 'invalid'

  // Two heads agreeing carry further than one: "nothing here advances the goal"
  // plus a middling completion verdict is a finished page whose evidence sits in
  // the viewport. Scrolling on instead scrolls that evidence away and the verdict
  // collapses (arXiv: 0.63 on the abstract page, 0.42 once scrolled to the
  // footer). A fresh observation still has to agree before the run ends.
  if (
    chosen === 'none_useful'
    && satisfied != null && satisfied >= THRESHOLDS.goalSatisfiedIdle
    && (action?.probabilities[chosen] ?? 0) >= THRESHOLDS.overrideNone
  ) {
    return { kind: 'done', why: `${doneWhy(satisfied, doneWhenGiven)} with no action left`, probability: satisfied }
  }

  /**
   * The scroll area for a direction: Jev's choice when it can move that way,
   * else the most likely area that can. The head is asked without knowing the
   * direction, so a sidebar already at its top may win for a scroll_up.
   */
  const scroll = (direction: 'down' | 'up'): Decision => {
    const area = validateChoice(answers.scroll_area, [...space.scrollCandidates, NONE])
    const movable = (key: string) => elementByIndex(space, key)?.scroll?.[direction] === true
    const key = area && area.choice !== NONE && movable(area.choice)
      ? area.choice
      : Object.entries(area?.probabilities ?? {}).filter(([k]) => k !== NONE && movable(k)).sort((a, b) => b[1] - a[1])[0]?.[0]
      ?? space.scrollCandidates.find(movable)
    return { kind: 'scroll', direction, ...(key ? { element: elementByIndex(space, key) } : {}) }
  }

  const noneUseful = (): Decision => {
    if (space.canScrollDown && !input.scrolledSinceChange) return scroll('down')
    const candidates = [...space.clickCandidates, ...space.typeCandidates.filter((k) => !space.clickCandidates.includes(`open:${k}`))]
    return {
      kind: 'pause',
      mode: 'click',
      question: {
        type: 'choice',
        reason: 'no-progress',
        options: [...candidates.slice(0, MAX_PAUSE_OPTIONS).flatMap((key) => {
          const el = elementByIndex(space, key)
          return el ? [{ ...option(el), key }] : []
        }), ABORT],
        context: {
          why: 'No offered action advances the goal; pick an element or take over',
          ...(candidates.length > MAX_PAUSE_OPTIONS ? { omitted: candidates.length - MAX_PAUSE_OPTIONS, hint: 'More elements exist than are offered; take a snapshot and act directly if the one you need is not listed.' } : {}),
          page,
          decision: summary,
        },
      },
    }
  }

  // Jev rated the step it picked as irreversible: the caller confirms that one
  // step (or redirects) before anything is submitted, paid, deleted or sent.
  const riskyPause = (mode: 'click' | 'type_text' | 'append' | 'switch', key: string, el: SpaceElement, probabilities: Record<string, number>, presetKey?: string): Decision => ({
    kind: 'pause',
    mode,
    element: el,
    presetKey,
    question: {
      type: 'choice',
      reason: 'risky',
      options: [
        { ...option(el, probabilities[key]), key, label: `${mode === 'type_text' ? 'type into' : mode === 'append' ? 'append to' : mode === 'switch' ? 'switch to' : clickKindOf(key) === 'submit' ? 'press Enter in' : 'click'} ${el.role} ${el.label}` },
        ...topK(space, probabilities).filter((o) => o.key !== key),
        ABORT,
      ],
      context: { why: `Jev rates this step irreversible (${risk.toFixed(2)}); confirm it, choose another target, or take over`, page, decision: summary },
    },
  })

  if (chosen === 'invalid') return noneUseful()
  if (chosen === 'scroll_down') return scroll('down')
  if (chosen === 'scroll_up') return scroll('up')
  if (chosen === 'escape') {
    // Escape cancels whatever is open; when Jev rates that irreversible (a
    // sheet whose changes would be discarded) the caller confirms the key.
    if (risk >= THRESHOLDS.risk) {
      return {
        kind: 'pause',
        mode: 'escape',
        question: {
          type: 'choice',
          reason: 'risky',
          options: [{ key: 'escape', label: 'press Escape', probability: action?.probabilities.escape }, ABORT],
          context: { why: `Jev rates pressing Escape here irreversible (${risk.toFixed(2)}); confirm it or take over`, page, decision: summary },
        },
      }
    }
    return { kind: 'escape', risk }
  }
  if (chosen === 'switch') {
    const target = validateChoice(answers.switch_target, [...space.switchCandidates, NONE])
    const el = target && target.choice !== NONE ? elementByIndex(space, target.choice) : undefined
    if (!target || !el) return noneUseful()
    if (risk >= THRESHOLDS.risk) return riskyPause('switch', target.choice, el, target.probabilities)
    return { kind: 'switch', element: el, probability: target.probabilities[target.choice], risk }
  }

  if (chosen === 'click' || chosen === 'none_useful') return clickAction(chosen, true)
  if (chosen === 'append') return writeText('append', false)
  return writeText('type_text', true)

  /**
   * "None of these" from a target head is narrower than "nothing here helps":
   * it rules out one kind of action, not the page. The action head weighs the
   * whole screen and gets that split wrong in both directions — System
   * Settings' sidebar answered click 0.57 while click_target said none_of_these
   * and the search box read 0.99, and the same screen with text already in the
   * box answered type_text 0.57 while type_text_target said none_of_these and
   * `submit:` on that box read 0.66. Either way the step was stranded into a
   * scroll and then a pause offering the entire sidebar.
   *
   * So each branch hands over to the other, but only when the other head's
   * answer would actually be acted on: typing must clear its own write gate,
   * while a click has no gate beyond naming a target. `mayHandOff` is false on
   * the receiving side, so a handoff never bounces back.
   */
  function clickTargetActionable(): boolean {
    const t = validateChoice(answers.click_target, [...space.clickCandidates, NONE])
    return !!t && t.choice !== NONE && !!elementByIndex(space, t.choice)
  }

  function typeTargetActionable(): boolean {
    const t = validateChoice(answers.type_text_target, [...space.typeCandidates, NONE])
    return !!t && t.choice !== NONE && (t.probabilities[t.choice] ?? 0) >= THRESHOLDS.write
  }

  function clickAction(mode: 'click' | 'none_useful', mayHandOff: boolean): Decision {
    const target = validateChoice(answers.click_target, [...space.clickCandidates, NONE])
    if (!target || target.choice === NONE) {
      return mayHandOff && mode === 'click' && typeTargetActionable() ? writeText('type_text', false) : noneUseful()
    }
    const el = elementByIndex(space, target.choice)
    const p = target.probabilities[target.choice]
    if (!el) return noneUseful()
    // A long list of mostly similar items makes the action head give up on the
    // page as a whole while the target head still singles out the one row
    // that matters (Finder: fifty apps and one folder).
    if (mode === 'none_useful' && p < THRESHOLDS.overrideNone) return noneUseful()
    // No confidence gate on clicks: Jev already judged the step's risk, and a
    // wrong click on a safe element costs one re-observation while a pause
    // costs the caller a whole turn (arXiv: the right "Search" link at 0.36).
    if (risk >= THRESHOLDS.risk) return riskyPause('click', target.choice, el, target.probabilities)
    return { kind: 'click', key: target.choice, element: el, probability: p, risk }
  }

  /**
   * type_text replaces a field; append adds to a text area. Both take their
   * text from a preset and share the write gate — a wrong target gets wrong
   * text either way — and differ only in the target head they read.
   */
  function writeText(kind: 'type_text' | 'append', mayHandOff: boolean): Decision {
    const candidates = kind === 'append' ? space.appendCandidates : space.typeCandidates
    const target = validateChoice(answers[kind === 'append' ? 'append_target' : 'type_text_target'], [...candidates, NONE])
    if (!target || target.choice === NONE) {
      return mayHandOff && clickTargetActionable() ? clickAction('click', false) : noneUseful()
    }
    const el = elementByIndex(space, target.choice)
    const p = target.probabilities[target.choice]
    if (!el) return noneUseful()
    const hinted = presetByHint(el, presets)
    const matched = hinted ? { preset: hinted, probability: 1 } : presetByJev(el, presets, answers, space.typeCandidates)
    if (p < THRESHOLDS.write) {
      return {
        kind: 'pause',
        mode: kind,
        presetKey: matched?.preset.key,
        question: {
          type: 'choice',
          reason: 'uncertain',
          options: [...topK(space, target.probabilities), ABORT],
          context: { why: `Low confidence ${kind} target (${p.toFixed(2)})`, page, decision: summary },
        },
      }
    }
    if (matched) {
      if (risk >= THRESHOLDS.risk) return riskyPause(kind, target.choice, el, target.probabilities, matched.preset.key)
      return { kind, element: el, text: matched.preset.value, presetKey: matched.preset.key, probability: matched.probability, risk }
    }
    return {
      kind: 'pause',
      mode: kind,
      element: el,
      question: {
        type: 'value',
        reason: 'uncertain',
        schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        context: {
          why: `Jev wants to ${kind === 'append' ? 'append to' : 'type into'} [${el.index}] ${el.label} but no preset matches`,
          target: { index: el.index, role: el.role, label: el.label, value: el.value },
          presets: presets.map((pr) => pr.key),
          page,
          decision: summary,
        },
      },
    }
  }

}
