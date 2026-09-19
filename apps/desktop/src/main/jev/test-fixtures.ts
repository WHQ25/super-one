import type { PageObservation, RawElement } from './browser-page'
import type { JevAnswer } from './typesafe-client'

export function el(partial: Partial<RawElement> & { node: number; role: string; label: string }): RawElement {
  return { value: '', editable: false, password: false, submit: false, disabled: false, ...partial }
}

export function page(elements: RawElement[], overrides: Partial<PageObservation> = {}): PageObservation {
  return {
    url: 'https://github.com/browser-use/jev-ultrafast',
    title: 'jev-ultrafast',
    text: 'Repository home',
    elements,
    omitted: 0,
    scroll: { y: 0, height: 2000, viewport: 800 },
    loading: false,
    marker: ['m', overrides.url ?? 'https://github.com/browser-use/jev-ultrafast', overrides.text ?? 'Repository home', elements.map((e) => [e.node, e.value])],
    pageKey: ['k'],
    guards: Object.fromEntries(elements.map((e) => [String(e.node), `g${e.node}`])),
    ...overrides,
  }
}

export function choice(choice: string, probabilities: Record<string, number>, confidence = 0.9): JevAnswer {
  return { type: 'choice', choice, probabilities, confidence }
}

/** Spread probability across every option, putting `mass` on `winner`. */
export function pick(winner: string, options: readonly string[], mass = 0.9, confidence = 0.9): JevAnswer {
  const rest = options.length > 1 ? (1 - mass) / (options.length - 1) : 0
  const probabilities = Object.fromEntries(options.map((o) => [o, o === winner ? mass : rest]))
  return { type: 'choice', choice: winner, probabilities, confidence }
}

export function noul(p: number): JevAnswer {
  return { type: 'noul', noul: p }
}
