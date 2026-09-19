/**
 * Action-space construction. Pure; no CDP, no Jev.
 *
 * Every actionable element on the page is a candidate. Risk is not decided
 * here: the main model dispatches with a goal and no knowledge of the page,
 * and a label whitelist would only make it copy the page into `allow`. Jev
 * sees the page, so Jev rates the step it picks (research doc §8.15); the one
 * hard exclusion is a password field, which no fast loop may ever fill.
 */

import type { RawElement, RunObservation } from './observation'

export interface SpaceElement extends RawElement {
  index: string
}

export interface HistoryEntry {
  node: number
  kind: 'click' | 'submit' | 'type_text' | 'scroll' | 'wait'
  label: string
  changedPage: boolean | null
  /** Set once the dispatch finished, so `completed_actions` lists real steps only. */
  completed?: true
  /** Jev rated the step risky and the caller approved it. */
  approved?: boolean
}

export interface ActionSpaceInput {
  page: RunObservation
  history: readonly HistoryEntry[]
}

export interface ActionSpace {
  elements: SpaceElement[]
  /**
   * Candidate keys for Jev's click head: `"3"` for an element, `"open:3"` for
   * opening an editable field's popup, `"submit:3"` for pressing Enter in a
   * filled field.
   */
  clickCandidates: string[]
  typeCandidates: string[]
  canScrollDown: boolean
  canScrollUp: boolean
}

export function buildActionSpace(input: ActionSpaceInput): ActionSpace {
  const { page, history } = input
  const stuck = new Set<string>()
  // Since the page last changed, a candidate that did nothing is not offered
  // again. This resets on the first observed change, so a slow submit is not
  // retried but a later, genuinely new form can be.
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (h.changedPage === true) break
    if (h.kind === 'wait' || h.kind === 'scroll') continue
    if (h.changedPage === false) stuck.add(`${h.node}:${h.kind}`)
  }
  const elements: SpaceElement[] = page.elements.map((raw, i) => ({ ...raw, index: String(i + 1) }))
  const clickCandidates: string[] = []
  const typeCandidates: string[] = []
  for (const el of elements) {
    // A password field is never a candidate of either kind: the loop cannot
    // fill it (no preset may hold a password) and clicking it achieves nothing.
    if (el.password || el.disabled) continue
    if (el.editable) {
      if (!stuck.has(`${el.node}:type_text`)) typeCandidates.push(el.index)
      if (!stuck.has(`${el.node}:click`)) clickCandidates.push(`open:${el.index}`)
      // Enter in a filled field is how many search boxes submit when their
      // button loses the race against an autocomplete blur (npm, GitHub).
      if (el.value && el.canSubmit !== false && !stuck.has(`${el.node}:submit`)) clickCandidates.push(`submit:${el.index}`)
      continue
    }
    if (el.clickable === false) continue
    if (!stuck.has(`${el.node}:click`)) clickCandidates.push(el.index)
  }
  return {
    elements,
    clickCandidates,
    typeCandidates,
    canScrollDown: page.canScroll?.down ?? page.scroll.y + page.scroll.viewport < page.scroll.height - 2,
    canScrollUp: page.canScroll?.up ?? page.scroll.y > 0,
  }
}

export type ClickKind = 'click' | 'open' | 'submit'

export function clickKindOf(key: string): ClickKind {
  return key.startsWith('open:') ? 'open' : key.startsWith('submit:') ? 'submit' : 'click'
}

/**
 * The verb Jev sees for a click candidate and later in completed_actions. A
 * collapsed control (`aria-expanded=false`: hamburger menus, disclosure
 * buttons) is offered as "Expand" so revealing hidden navigation reads as a
 * step rather than a property Jev must infer.
 */
export function clickVerb(kind: ClickKind, el: Pick<RawElement, 'expanded'>): 'Open' | 'Press Enter in' | 'Expand' | 'Click' {
  if (kind === 'open') return 'Open'
  if (kind === 'submit') return 'Press Enter in'
  return el.expanded === 'false' ? 'Expand' : 'Click'
}

export function elementByIndex(space: ActionSpace, key: string): SpaceElement | undefined {
  const index = key.replace(/^(open|submit):/, '')
  return space.elements.find((el) => el.index === index)
}
