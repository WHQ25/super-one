/**
 * The per-step decision table (research doc §3.6). Pure: answers in, decision out.
 *
 * Thresholds are starting points, calibrated against JEV_MODEL; the trace keeps
 * every probability so they can be re-fit from real runs.
 */

import { type ActionSpace, elementByIndex, type SpaceElement } from './action-space'

import { NONE, type ActionOption, ACTION_OPTIONS, type Preset } from './questions'
import { type JevAnswer, readNoul, validateChoice } from './typesafe-client'

export const THRESHOLDS = {
  stillLoading: 0.7,
  goalSatisfied: 0.85,
  /** Official confidence-routing floor: below this the model is not acted on at all. */
  read: 0.6,
  write: 0.7,
  presetMatch: 0.7,
} as const

export type PauseReason = 'uncertain' | 'guarded-only' | 'no-progress' | 'budget'

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
  | { kind: 'done'; why: string }
  | { kind: 'click'; key: string; element: SpaceElement; probability: number }
  | { kind: 'type_text'; element: SpaceElement; text: string; presetKey: string; probability: number }
  | { kind: 'scroll'; direction: 'down' | 'up' }
  | {
    kind: 'pause'
    question: Omit<Question, 'id'>
    /** What an answered element index means when the run resumes. */
    mode: 'click' | 'type_text' | 'accept'
    element?: SpaceElement
    /** Preset already matched to the offered field, so a resume can type it without asking again. */
    presetKey?: string
  }

export interface DecideInput {
  answers: Record<string, JevAnswer>
  space: ActionSpace
  presets: readonly Preset[]
  doneWhenGiven: boolean
  consecutiveWaits: number
  scrolledSinceChange: boolean
  page: { url: string; title: string }
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
/** Safe candidates appended to a guarded-only pause; the rest are still visible in the snapshot. */
const MAX_SAFE_OPTIONS = 20

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
  const satisfied = readNoul(answers.goal_satisfied)
  if (satisfied != null && satisfied >= THRESHOLDS.goalSatisfied && !doneWhenGiven) {
    return {
      kind: 'pause',
      mode: 'accept',
      question: {
        type: 'choice',
        reason: 'uncertain',
        options: [
          { key: 'accept', label: 'Goal looks complete — finish', probability: satisfied },
          { key: 'continue', label: 'Not done yet — keep going' },
          ABORT,
        ],
        context: { why: `Jev thinks the goal is satisfied (${satisfied.toFixed(2)}) but no done_when was given`, page, decision: summary },
      },
    }
  }

  const offered = ACTION_OPTIONS.filter((o) => {
    if (o === 'click') return space.clickCandidates.length > 0
    if (o === 'type_text') return space.typeCandidates.length > 0
    if (o === 'scroll_down') return space.canScrollDown
    if (o === 'scroll_up') return space.canScrollUp
    return true
  })
  const action = validateChoice(answers.action, offered)
  const chosen: ActionOption | 'invalid' = action ? (action.choice as ActionOption) : 'invalid'

  const noneUseful = (): Decision => {
    if (space.guarded.length > 0 || space.guardedSubmits.length > 0) {
      // Guarded first, then the safe candidates Jev declined: the caller may
      // know a safe click is right after all (a button whose first click was
      // swallowed) and should be able to say so instead of aborting.
      const safe = space.clickCandidates.slice(0, MAX_SAFE_OPTIONS).flatMap((key) => {
        const el = elementByIndex(space, key)
        return el ? [{ ...option(el), key }] : []
      })
      return {
        kind: 'pause',
        mode: 'click',
        question: {
          type: 'choice',
          reason: 'guarded-only',
          options: [
            ...space.guarded.map((el) => option(el)),
            ...space.guardedSubmits.map((el) => ({ key: `submit:${el.index}`, label: `press Enter in ${el.role} ${el.label}` })),
            ...safe,
            ABORT,
          ],
          context: {
            why: 'No safe action advances the goal; guarded elements remain. Safe candidates are listed after them in case one should be retried.',
            guarded: [
              ...space.guarded.map((el) => ({ index: el.index, label: el.label, reason: el.reason })),
              ...space.guardedSubmits.map((el) => ({ index: `submit:${el.index}`, label: `Enter in ${el.label}`, reason: 'submit' })),
            ],
            page,
            decision: summary,
          },
        },
      }
    }
    if (space.canScrollDown && !input.scrolledSinceChange) return { kind: 'scroll', direction: 'down' }
    return {
      kind: 'pause',
      mode: 'click',
      question: {
        type: 'choice',
        reason: 'no-progress',
        options: [...space.elements.filter((el) => !el.password && el.clickable !== false).map((el) => option(el)), ABORT],
        context: { why: 'No offered action advances the goal and nothing is guarded; pick an element or take over', page, decision: summary },
      },
    }
  }

  if (chosen === 'invalid' || chosen === 'none_useful') return noneUseful()
  if (chosen === 'scroll_down') return { kind: 'scroll', direction: 'down' }
  if (chosen === 'scroll_up') return { kind: 'scroll', direction: 'up' }

  if (chosen === 'click') {
    const target = validateChoice(answers.click_target, [...space.clickCandidates, NONE])
    if (!target || target.choice === NONE) return noneUseful()
    const el = elementByIndex(space, target.choice)
    const p = target.probabilities[target.choice]
    if (!el) return noneUseful()
    // Only the target head is gated. The action head is a 4–5 way choice whose
    // confidence is structurally low even when "click vs type" is obvious, and
    // picking the wrong operation on the right element is cheap and reversible.
    if (p < THRESHOLDS.read) {
      return {
        kind: 'pause',
        mode: 'click',
        question: {
          type: 'choice',
          reason: 'uncertain',
          options: [...topK(space, target.probabilities), ABORT],
          context: { why: `Low confidence click target (${p.toFixed(2)})`, page, decision: summary },
        },
      }
    }
    return { kind: 'click', key: target.choice, element: el, probability: p }
  }

  // type_text
  const target = validateChoice(answers.type_text_target, [...space.typeCandidates, NONE])
  if (!target || target.choice === NONE) return noneUseful()
  const el = elementByIndex(space, target.choice)
  const p = target.probabilities[target.choice]
  if (!el) return noneUseful()
  const hinted = presetByHint(el, presets)
  const matched = hinted ? { preset: hinted, probability: 1 } : presetByJev(el, presets, answers, space.typeCandidates)
  if (p < THRESHOLDS.write) {
    return {
      kind: 'pause',
      mode: 'type_text',
      presetKey: matched?.preset.key,
      question: {
        type: 'choice',
        reason: 'uncertain',
        options: [...topK(space, target.probabilities), ABORT],
        context: { why: `Low confidence type_text target (${p.toFixed(2)})`, page, decision: summary },
      },
    }
  }
  if (matched) {
    return { kind: 'type_text', element: el, text: matched.preset.value, presetKey: matched.preset.key, probability: matched.probability }
  }
  return {
    kind: 'pause',
    mode: 'type_text',
    element: el,
    question: {
      type: 'value',
      reason: 'uncertain',
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      context: {
        why: `Jev wants to type into [${el.index}] ${el.label} but no preset matches`,
        target: { index: el.index, role: el.role, label: el.label, value: el.value },
        presets: presets.map((pr) => pr.key),
        page,
        decision: summary,
      },
    },
  }
}
