/**
 * Action-space construction and risk classification. Pure; no CDP, no Jev.
 *
 * Every observed element is `safe` or `guarded`. Safe is a whitelist — what the
 * loop does not recognise is guarded — because Jev never judges risk: it only
 * chooses among the candidates this file hands it, and it is never handed a
 * guarded one. Guarded elements reach the main model through a pause instead.
 */

import type { RunObservation, RawElement } from './observation'

export type Risk = 'safe' | 'guarded'

export interface SpaceElement extends RawElement {
  index: string
  risk: Risk
  /** Why a guarded element is guarded — surfaced in the pause context and trace. */
  reason?: string
  highRisk: boolean
}

export interface HistoryEntry {
  node: number
  kind: 'click' | 'submit' | 'type_text' | 'scroll' | 'wait'
  label: string
  changedPage: boolean | null
  guarded: boolean
  /** Input finished dispatching; this does not claim its intended effect worked. */
  completed?: true
}

export interface ActionSpaceInput {
  page: RunObservation
  origins: ReadonlySet<string>
  allow: readonly string[]
  avoid: readonly string[]
  history: readonly HistoryEntry[]
}

export interface ActionSpace {
  elements: SpaceElement[]
  /**
   * Candidate keys for Jev's click head: `"3"` for an element, `"open:3"` for
   * opening an editable field's popup, `"submit:3"` for pressing Enter in a
   * filled field (only when the caller allowed submitting).
   */
  clickCandidates: string[]
  typeCandidates: string[]
  guarded: SpaceElement[]
  /**
   * Filled editable fields whose Enter is withheld — submitting a form is as
   * irreversible as its button, so it takes the same pause unless allowed.
   */
  guardedSubmits: SpaceElement[]
  canScrollDown: boolean
  canScrollUp: boolean
}

/** Navigation-shaped button labels that may be clicked without asking. */
const NAV_LABEL = /^(issues?|pull requests?|new(\s+\w+)?|next|previous|prev|back|search|filter(s)?|sort(\s+by)?|open|show more|load more|more|view(\s+\w+)?|expand|collapse|close|cancel|dismiss|skip|got it|ok|accept all|accept|agree|continue|menu|tabs?|sign in|log in|login)$/i

/** Labels that always stay guarded, even when the role would otherwise be safe. */
const HIGH_RISK_LABEL = /\b(create|submit|send|post|publish|pay|buy|purchase|order|checkout|delete|remove|confirm|resolve|merge|approve|reject|close issue|archive|transfer|unsubscribe|deactivate|revoke)\b/i

const SAFE_ROLES = new Set(['tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'treeitem'])

function matchesAny(label: string, patterns: readonly string[]): boolean {
  const l = label.toLowerCase()
  return patterns.some((p) => p && l.includes(p.toLowerCase()))
}

/** `allow: ["Enter"]` / `["submit"]` lets the loop press Enter in any filled field; a field label allows just that field. */
function submitAllowed(el: RawElement, allow: readonly string[]): boolean {
  return matchesAny(el.label, allow) || allow.some((a) => /^(enter|submit)$/i.test(a.trim()))
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function classify(el: RawElement, origins: ReadonlySet<string>, allow: readonly string[]): { risk: Risk; reason?: string; highRisk: boolean } {
  const highRisk = !!el.riskHint?.highRisk || HIGH_RISK_LABEL.test(el.label)
  if (matchesAny(el.label, allow)) return { risk: 'safe', highRisk }
  if (highRisk) return { risk: 'guarded', reason: el.riskHint?.reason ?? 'high-risk label', highRisk }
  if (el.riskHint) return { risk: el.riskHint.risk, reason: el.riskHint.reason, highRisk }
  if (el.editable) return { risk: 'safe', highRisk }
  if (el.role === 'link') {
    const origin = el.href ? originOf(el.href) : null
    if (origin && origins.has(origin)) return { risk: 'safe', highRisk }
    return { risk: 'guarded', reason: 'cross-origin link', highRisk }
  }
  if (SAFE_ROLES.has(el.role)) return { risk: 'safe', highRisk }
  if (el.role === 'button') {
    if (el.submit) return { risk: 'guarded', reason: 'submit', highRisk }
    if (el.expanded != null) return { risk: 'safe', highRisk }
    if (NAV_LABEL.test(el.label.trim())) return { risk: 'safe', highRisk }
    return { risk: 'guarded', reason: el.label.trim() ? 'unrecognised button' : 'unlabelled button', highRisk }
  }
  if (el.role === 'checkbox' || el.role === 'radio' || el.role === 'switch') return { risk: 'guarded', reason: 'state toggle', highRisk }
  return { risk: 'guarded', reason: `role ${el.role}`, highRisk }
}

export function buildActionSpace(input: ActionSpaceInput): ActionSpace {
  const { page, origins, allow, avoid, history } = input
  const stuck = new Set<string>()
  // Since the page last changed: a candidate that did nothing is not offered
  // again, and an executed guarded element is withheld (double-submit guard).
  // Both reset on the first observed change, so a slow submit is not retried
  // but a later, genuinely new form can be.
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (h.changedPage === true) break
    if (h.kind === 'wait' || h.kind === 'scroll') continue
    if (h.changedPage === false || h.guarded || h.kind === 'submit') stuck.add(`${h.node}:${h.kind}`)
  }
  const elements: SpaceElement[] = []
  for (const raw of page.elements) {
    if (raw.disabled || raw.password || matchesAny(raw.label, avoid)) continue
    const c = classify(raw, origins, allow)
    elements.push({ ...raw, index: String(elements.length + 1), risk: c.risk, reason: c.reason, highRisk: c.highRisk })
  }
  const clickCandidates: string[] = []
  const typeCandidates: string[] = []
  const guarded: SpaceElement[] = []
  const guardedSubmits: SpaceElement[] = []
  for (const el of elements) {
    // A password field is never a candidate of either kind: the loop cannot
    // fill it (no preset may hold a password) and clicking it achieves nothing.
    if (el.password) continue
    if (el.risk === 'guarded') {
      if (el.clickable !== false && !stuck.has(`${el.node}:click`)) guarded.push(el)
      continue
    }
    if (el.editable) {
      if (!stuck.has(`${el.node}:type_text`)) typeCandidates.push(el.index)
      if (el.clickable !== false && !stuck.has(`${el.node}:click`)) clickCandidates.push(`open:${el.index}`)
      // Enter in a filled field is how many search boxes submit when their
      // button loses the race against an autocomplete blur (npm, GitHub).
      if (el.canSubmit !== false && el.value && !stuck.has(`${el.node}:submit`)) {
        if (submitAllowed(el, allow)) clickCandidates.push(`submit:${el.index}`)
        else guardedSubmits.push(el)
      }
      continue
    }
    if (el.clickable !== false && !stuck.has(`${el.node}:click`)) clickCandidates.push(el.index)
  }
  return {
    elements,
    clickCandidates,
    typeCandidates,
    guarded,
    guardedSubmits,
    canScrollDown: page.canScroll?.down ?? page.scroll.y + page.scroll.viewport < page.scroll.height - 2,
    canScrollUp: page.canScroll?.up ?? page.scroll.y > 0,
  }
}

export type ClickKind = 'click' | 'open' | 'submit'

export function clickKindOf(key: string): ClickKind {
  return key.startsWith('open:') ? 'open' : key.startsWith('submit:') ? 'submit' : 'click'
}

export function elementByIndex(space: ActionSpace, key: string): SpaceElement | undefined {
  const index = key.replace(/^(open|submit):/, '')
  return space.elements.find((el) => el.index === index)
}
