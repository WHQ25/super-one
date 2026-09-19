import { describe, expect, it } from 'vitest'
import { buildActionSpace } from './action-space'
import { decide, type DecideInput } from './policy'
import { NONE } from './questions'
import { el, noul, page, pick } from './test-fixtures'

const origins = new Set(['https://github.com'])
const elements = [
  el({ node: 1, role: 'link', label: 'Issues', href: 'https://github.com/x/issues' }),
  el({ node: 2, role: 'textbox', label: 'Add a title', editable: true }),
  el({ node: 3, role: 'button', label: 'Create', submit: true }),
]
const space = buildActionSpace({ page: page(elements), origins, allow: [], avoid: [], history: [] })
const ACTIONS = ['click', 'type_text', 'scroll_down', 'none_useful']
const CLICKS = [...space.clickCandidates, NONE]
const TYPES = [...space.typeCandidates, NONE]

function input(overrides: Partial<DecideInput>): DecideInput {
  return {
    answers: {},
    space,
    presets: [],
    doneWhenGiven: true,
    consecutiveWaits: 0,
    scrolledSinceChange: false,
    page: { url: 'https://github.com/x', title: 'x' },
    ...overrides,
  }
}

describe('decide', () => {
  it('waits while Jev sees loading, but at most three times in a row', () => {
    const answers = { still_loading: noul(0.9), goal_satisfied: noul(0.1), action: pick('click', ACTIONS), click_target: pick('1', CLICKS) }
    expect(decide(input({ answers })).kind).toBe('wait')
    expect(decide(input({ answers, consecutiveWaits: 3 })).kind).toBe('click')
  })

  it('pauses to confirm completion when Jev is sure but no done_when was given', () => {
    const answers = { still_loading: noul(0.1), goal_satisfied: noul(0.95), action: pick('none_useful', ACTIONS) }
    const d = decide(input({ answers, doneWhenGiven: false }))
    expect(d).toMatchObject({ kind: 'pause', mode: 'accept', question: { reason: 'uncertain' } })
    // With done_when the machine condition decides; Jev's opinion is ignored.
    expect(decide(input({ answers, doneWhenGiven: true })).kind).toBe('pause')
    expect((decide(input({ answers, doneWhenGiven: true })) as { question: { reason: string } }).question.reason).toBe('guarded-only')
  })

  it('offers the guarded elements when nothing safe helps', () => {
    const answers = { still_loading: noul(0.1), goal_satisfied: noul(0.1), action: pick('none_useful', ACTIONS) }
    const d = decide(input({ answers }))
    expect(d).toMatchObject({ kind: 'pause', mode: 'click', question: { reason: 'guarded-only' } })
    const keys = (d as { question: { options: Array<{ key: string }> } }).question.options.map((o) => o.key)
    // Guarded button first, then the safe clicks Jev passed on, so the caller can retry one.
    expect(keys).toEqual(['3', '1', 'open:2', 'abort'])
  })

  it('clicks a confident safe target and pauses with top-k on a weak one', () => {
    const strong = { still_loading: noul(0.1), goal_satisfied: noul(0.1), action: pick('click', ACTIONS), click_target: pick('1', CLICKS, 0.9) }
    expect(decide(input({ answers: strong }))).toMatchObject({ kind: 'click', key: '1' })
    const weak = { ...strong, click_target: pick('1', CLICKS, 0.5) }
    const d = decide(input({ answers: weak }))
    expect(d).toMatchObject({ kind: 'pause', mode: 'click', question: { reason: 'uncertain' } })
  })

  it('types a preset matched by field hint, else by Jev, else pauses for a value', () => {
    const base = { still_loading: noul(0.1), goal_satisfied: noul(0.1), action: pick('type_text', ACTIONS), type_text_target: pick('2', TYPES, 0.9) }
    const hinted = decide(input({ answers: base, presets: [{ key: 'Title', value: 'Hello', field: 'title' }] }))
    expect(hinted).toMatchObject({ kind: 'type_text', text: 'Hello', presetKey: 'Title' })

    const byJev = decide(input({
      answers: { ...base, field_for_Body: pick('2', TYPES, 0.8) },
      presets: [{ key: 'Body', value: 'Long text' }],
    }))
    expect(byJev).toMatchObject({ kind: 'type_text', text: 'Long text', probability: 0.8 })

    const unmatched = decide(input({ answers: { ...base, field_for_Body: pick(NONE, TYPES, 0.8) }, presets: [{ key: 'Body', value: 'x' }] }))
    expect(unmatched).toMatchObject({ kind: 'pause', mode: 'type_text', question: { type: 'value' } })
  })

  it('treats an invalid answer as none_useful rather than acting on it', () => {
    const answers = { action: { type: 'choice', choice: 'launch_missiles', probabilities: { launch_missiles: 1 }, confidence: 1 } as never }
    expect(decide(input({ answers }))).toMatchObject({ kind: 'pause', question: { reason: 'guarded-only' } })
  })
})
