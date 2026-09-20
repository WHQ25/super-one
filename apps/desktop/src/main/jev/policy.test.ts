import { describe, expect, it } from 'vitest'
import { buildActionSpace } from './action-space'
import { decide, type DecideInput, THRESHOLDS } from './policy'
import { NONE } from './questions'
import { el, noul, page, pick } from './test-fixtures'

const elements = [
  el({ node: 1, role: 'link', label: 'Issues', href: 'https://github.com/x/issues' }),
  el({ node: 2, role: 'textbox', label: 'Add a title', editable: true }),
  el({ node: 3, role: 'button', label: 'Create', submit: true }),
]
const space = buildActionSpace({ page: page(elements), history: [] })
const ACTIONS = ['click', 'type_text', 'scroll_down', 'none_useful']
const CLICKS = [...space.clickCandidates, NONE]
const TYPES = [...space.typeCandidates, NONE]
const calm = { still_loading: noul(0.1), goal_satisfied: noul(0.1), next_step_risk: noul(0.05) }

function input(overrides: Partial<DecideInput>): DecideInput {
  return {
    answers: {},
    space,
    presets: [],
    doneWhenGiven: false,
    consecutiveWaits: 0,
    scrolledSinceChange: false,
    page: { url: 'https://github.com/x', title: 'x' },
    ...overrides,
  }
}

describe('decide', () => {
  it('types when the click head has no target but the field is named with certainty', () => {
    // System Settings' sidebar: the only way forward is the search box, yet the
    // action head still leaned to clicking (0.57 vs type_text 0.41) while
    // click_target answered none_of_these and type_text_target named the field
    // at 0.99. The run used to scroll once and then pause with the whole
    // sidebar as options, never typing a character.
    const answers = {
      ...calm,
      action: pick('click', ACTIONS),
      click_target: pick(NONE, CLICKS),
      type_text_target: pick('2', TYPES),
      field_for_Query: pick('2', TYPES),
    }
    const presets = [{ key: 'Query', value: 'About' }]
    expect(decide(input({ answers, presets }))).toMatchObject({ kind: 'type_text', text: 'About' })
  })

  it('clicks when the type head has no field but a click target is named', () => {
    // The same sidebar one step later, with "About" already in the search box:
    // type_text 0.57 led the action head, type_text_target answered
    // none_of_these 0.77 (correctly — there is nothing left to type) and
    // click_target named `submit:` on that box at 0.66. Clicks carry no
    // confidence gate, so a named target is one the loop would have executed
    // had the action head said click.
    const filled = buildActionSpace({ page: page([
      el({ node: 1, role: 'button', label: 'About, General' }),
      el({ node: 2, role: 'textbox', label: 'About', value: 'About', editable: true }),
    ]), history: [] })
    expect(filled.clickCandidates).toContain('submit:2')
    const answers = {
      ...calm,
      action: pick('type_text', ['click', 'type_text', 'scroll_down', 'none_useful']),
      type_text_target: pick(NONE, [...filled.typeCandidates, NONE]),
      click_target: { type: 'choice' as const, choice: 'submit:2', confidence: 0.66,
        probabilities: { 'submit:2': 0.66, '1': 0.14, 'open:2': 0.1, [NONE]: 0.1 } },
    }
    expect(decide(input({ answers, space: filled }))).toMatchObject({ kind: 'click', key: 'submit:2' })
  })

  it('reports no progress when neither head resolves a target', () => {
    const answers = { ...calm, action: pick('type_text', ACTIONS), type_text_target: pick(NONE, TYPES), click_target: pick(NONE, CLICKS) }
    expect(decide(input({ answers })).kind).toBe('scroll')
  })

  it('still reports no progress when the field is only a guess', () => {
    const answers = {
      ...calm,
      action: pick('click', ACTIONS),
      click_target: pick(NONE, CLICKS),
      type_text_target: { type: 'choice' as const, choice: '2', confidence: 0.5, probabilities: { '2': 0.5, [NONE]: 0.5 } },
    }
    expect(decide(input({ answers, presets: [{ key: 'Query', value: 'About' }] })).kind).toBe('scroll')
  })

  it('waits while Jev sees loading, but at most three times in a row', () => {
    const answers = { ...calm, still_loading: noul(0.9), action: pick('click', ACTIONS), click_target: pick('1', CLICKS) }
    expect(decide(input({ answers })).kind).toBe('wait')
    expect(decide(input({ answers, consecutiveWaits: 3 })).kind).toBe('click')
  })

  it('finishes on Jev\'s completion verdict, and says so when the caller\'s own condition never matched', () => {
    const answers = { ...calm, goal_satisfied: noul(0.8), action: pick('click', ACTIONS), click_target: pick('1', CLICKS) }
    expect(decide(input({ answers }))).toMatchObject({ kind: 'done', probability: 0.8 })
    // The loop checks done_when before every ask, so reaching here means it did
    // not match — often because its ref names an element the app has replaced.
    // Refusing to finish on that basis left a Calculator run circling a result
    // it had already produced.
    expect(decide(input({ answers, doneWhenGiven: true }))).toMatchObject({
      kind: 'done', why: 'goal_satisfied 0.80 (done_when never matched)',
    })
    expect(decide(input({ answers: { ...answers, goal_satisfied: noul(THRESHOLDS.goalSatisfied - 0.01) } })).kind).toBe('click')
  })

  it('clicks the chosen target whether Jev is sure or not, as long as the step is safe', () => {
    const strong = { ...calm, action: pick('click', ACTIONS), click_target: pick('3', CLICKS, 0.9) }
    expect(decide(input({ answers: strong }))).toMatchObject({ kind: 'click', key: '3', risk: 0.05 })
    // arXiv: the right "Search" link at 0.36. A wrong safe click costs one re-observation; a pause costs a turn.
    const weak = { ...strong, click_target: pick('3', CLICKS, 0.36) }
    expect(decide(input({ answers: weak }))).toMatchObject({ kind: 'click', key: '3', probability: 0.36 })
  })

  it('finishes when Jev has no action left and the goal already reads satisfied', () => {
    // arXiv: the abstract page reads 0.63, and scrolling on would scroll the evidence away.
    const idle = { ...calm, goal_satisfied: noul(0.63), action: pick('none_useful', ACTIONS, 0.98) }
    expect(decide(input({ answers: idle }))).toMatchObject({ kind: 'done', probability: 0.63 })
    // A weak completion verdict still scrolls rather than finishing. Desktop
    // finished pages read as low as 0.45 (TextEdit after an append / an
    // Escape), unfinished ones at most 0.18; the line sits between.
    const unsure = { ...idle, goal_satisfied: noul(THRESHOLDS.goalSatisfiedIdle - 0.05) }
    expect(decide(input({ answers: unsure }))).toMatchObject({ kind: 'scroll' })
    expect(decide(input({ answers: { ...idle, goal_satisfied: noul(0.45) } }))).toMatchObject({ kind: 'done', probability: 0.45 })
    // So does an action head that is not sure the page is exhausted.
    const wavering = { ...idle, action: pick('none_useful', ACTIONS, 0.6) }
    expect(decide(input({ answers: wavering }))).toMatchObject({ kind: 'scroll' })
    // A done_when that never matched does not veto the verdict.
    expect(decide(input({ answers: idle, doneWhenGiven: true }))).toMatchObject({ kind: 'done' })
  })

  it('asks before a step Jev rates irreversible, offering that step first', () => {
    const answers = { ...calm, next_step_risk: noul(0.8), action: pick('click', ACTIONS), click_target: pick('3', CLICKS, 0.9) }
    const d = decide(input({ answers })) as { question: { reason: string; options: Array<{ key: string; label: string }> }; element: { index: string } }
    expect(d).toMatchObject({ kind: 'pause', mode: 'click', question: { reason: 'risky' }, element: { index: '3' } })
    expect(d.question.options[0]).toMatchObject({ key: '3', label: 'click button Create' })
    expect(d.question.options.at(-1)?.key).toBe('abort')
    // The same verdict on a typed step keeps the matched preset for the resume.
    const typed = { ...calm, next_step_risk: noul(0.6), action: pick('type_text', ACTIONS), type_text_target: pick('2', TYPES, 0.9) }
    expect(decide(input({ answers: typed, presets: [{ key: 'Title', value: 'Hello', field: 'title' }] }))).toMatchObject({ kind: 'pause', mode: 'type_text', presetKey: 'Title', question: { reason: 'risky' } })
  })

  it('pauses with no-progress when nothing useful is left and the page cannot scroll further', () => {
    const answers = { ...calm, action: pick('none_useful', ACTIONS) }
    expect(decide(input({ answers }))).toMatchObject({ kind: 'scroll', direction: 'down' })
    const d = decide(input({ answers, scrolledSinceChange: true }))
    expect(d).toMatchObject({ kind: 'pause', mode: 'click', question: { reason: 'no-progress' } })
    expect((d as { question: { options: Array<{ key: string }> } }).question.options.map((o) => o.key)).toEqual(['1', 'open:2', '3', 'abort'])
  })

  it('types a preset matched by field hint, else by Jev, else pauses for a value', () => {
    const base = { ...calm, action: pick('type_text', ACTIONS), type_text_target: pick('2', TYPES, 0.9) }
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
    const answers = { ...calm, action: { type: 'choice', choice: 'launch_missiles', probabilities: { launch_missiles: 1 }, confidence: 1 } as never }
    expect(decide(input({ answers, scrolledSinceChange: true }))).toMatchObject({ kind: 'pause', question: { reason: 'no-progress' } })
  })

  it('caps the options of a no-progress pause but reports how many were left out', () => {
    const many = Array.from({ length: 40 }, (_, i) => el({ node: i + 1, role: 'button', label: `Command ${i}` }))
    const big = buildActionSpace({ page: page(many), history: [] })
    const answers = { ...calm, action: pick('none_useful', ACTIONS) }
    const d = decide(input({ answers, space: big, scrolledSinceChange: true })) as { question: { options: Array<{ key: string }>; context: { omitted?: number } } }
    expect(d.question.options.map((o) => o.key)).toEqual([...many.slice(0, 24).map((_, i) => String(i + 1)), 'abort'])
    expect(d.question.context.omitted).toBe(16)
  })

  it('lets a very confident click target override a none_useful action head', () => {
    const base = { ...calm, action: pick('none_useful', ACTIONS) }
    expect(decide(input({ answers: { ...base, click_target: pick('1', CLICKS, 0.9) } }))).toMatchObject({ kind: 'click', key: '1' })
    expect(decide(input({ answers: { ...base, click_target: pick('1', CLICKS, 0.7) } })).kind).toBe('scroll')
    expect(decide(input({ answers: { ...base, click_target: pick(NONE, CLICKS, 0.9) } })).kind).toBe('scroll')
  })

  describe('desktop-only heads', () => {
    // A desktop page offers scroll areas and text areas as elements; a browser
    // page never sets these flags, so its space has neither list and the
    // decisions below cannot arise there.
    const desktop = buildActionSpace({ page: page([
      el({ node: 1, role: 'scrollarea', label: 'List starting at AirDrop', clickable: false, scroll: { up: false, down: true } }),
      el({ node: 2, role: 'scrollarea', label: 'Table starting at Applications', clickable: false, scroll: { up: true, down: true } }),
      el({ node: 3, role: 'textbox', label: 'First line', value: 'First line', editable: true, appendable: true }),
      el({ node: 4, role: 'button', label: 'Done' }),
      el({ node: 5, role: 'window', label: 'Document', clickable: false, root: '@r1' }),
    ], { canScroll: { up: true, down: true }, canEscape: true }), history: [] })
    const AREAS = [...desktop.scrollCandidates, NONE]
    const APPENDS = [...desktop.appendCandidates, NONE]
    const ROOTS = [...desktop.switchCandidates, NONE]
    const DESKTOP_ACTIONS = ['click', 'type_text', 'append', 'scroll_down', 'scroll_up', 'escape', 'switch', 'none_useful']

    it('offers scroll areas, appendable text areas, roots and Escape only when the page flags them', () => {
      expect(space.scrollCandidates).toEqual([])
      expect(space.appendCandidates).toEqual([])
      expect(space.switchCandidates).toEqual([])
      expect(space.canEscape).toBe(false)
      expect(desktop.scrollCandidates).toEqual(['1', '2'])
      expect(desktop.appendCandidates).toEqual(['3'])
      expect(desktop.switchCandidates).toEqual(['5'])
      expect(desktop.canEscape).toBe(true)
      expect(desktop.clickCandidates).not.toContain('1')
      expect(desktop.clickCandidates).not.toContain('5')
    })

    it('presses Escape on Jev\'s word, asking first only when it rates the cancel irreversible', () => {
      expect(decide(input({ space: desktop, answers: { ...calm, action: pick('escape', DESKTOP_ACTIONS) } }))).toEqual({ kind: 'escape', risk: 0.05 })
      const risky = decide(input({ space: desktop, answers: { ...calm, next_step_risk: noul(0.8), action: pick('escape', DESKTOP_ACTIONS) } }))
      expect(risky).toMatchObject({ kind: 'pause', mode: 'escape', question: { reason: 'risky', options: [{ key: 'escape', label: 'press Escape', probability: 0.9 }, { key: 'abort' }] } })
      // A browser page never offers it; an answer naming it is invalid there.
      expect(decide(input({ answers: { ...calm, action: pick('escape', [...ACTIONS, 'escape']) } })).kind).not.toBe('escape')
    })

    it('switches to the root Jev names, or falls through when it names none', () => {
      expect(decide(input({ space: desktop, answers: { ...calm, action: pick('switch', DESKTOP_ACTIONS), switch_target: pick('5', ROOTS) } })))
        .toMatchObject({ kind: 'switch', element: { index: '5', root: '@r1' }, probability: 0.9 })
      expect(decide(input({ space: desktop, answers: { ...calm, action: pick('switch', DESKTOP_ACTIONS), switch_target: pick(NONE, ROOTS) } })))
        .toMatchObject({ kind: 'scroll' })
      expect(decide(input({ space: desktop, answers: { ...calm, next_step_risk: noul(0.7), action: pick('switch', DESKTOP_ACTIONS), switch_target: pick('5', ROOTS) } })))
        .toMatchObject({ kind: 'pause', mode: 'switch', element: { index: '5' }, question: { reason: 'risky', options: [expect.objectContaining({ key: '5', label: 'switch to window Document' }), expect.objectContaining({ key: 'abort' })] } })
    })

    it('scrolls the area Jev names, or the likeliest one that can move that way', () => {
      const chosen = decide(input({ space: desktop, answers: { ...calm, action: pick('scroll_down', DESKTOP_ACTIONS), scroll_area: pick('2', AREAS) } }))
      expect(chosen).toMatchObject({ kind: 'scroll', direction: 'down', element: { index: '2' } })
      // The head does not know the direction: the sidebar at its top wins the
      // head but cannot scroll up, so the scroll goes to the list.
      const redirected = decide(input({ space: desktop, answers: { ...calm, action: pick('scroll_up', DESKTOP_ACTIONS), scroll_area: pick('1', AREAS) } }))
      expect(redirected).toMatchObject({ kind: 'scroll', direction: 'up', element: { index: '2' } })
      // Without an answer the adapter's default area is used.
      expect(decide(input({ space: desktop, answers: { ...calm, action: pick('scroll_down', DESKTOP_ACTIONS) } }))).toEqual({ kind: 'scroll', direction: 'down', element: expect.objectContaining({ index: '1' }) })
      // A browser page still scrolls without naming an area.
      expect(decide(input({ answers: { ...calm, action: pick('scroll_down', ACTIONS) } }))).toEqual({ kind: 'scroll', direction: 'down' })
    })

    it('appends the matched preset, gated like a write, and pauses in append mode when unsure', () => {
      const presets = [{ key: 'Line', value: '\nSecond line' }]
      const sure = { ...calm, action: pick('append', DESKTOP_ACTIONS), append_target: pick('3', APPENDS), field_for_Line: pick('3', [...desktop.typeCandidates, NONE]) }
      expect(decide(input({ space: desktop, presets, answers: sure }))).toMatchObject({ kind: 'append', element: { index: '3' }, text: '\nSecond line', presetKey: 'Line' })
      const unsure = { ...sure, append_target: pick('3', APPENDS, THRESHOLDS.write - 0.1) }
      expect(decide(input({ space: desktop, presets, answers: unsure }))).toMatchObject({ kind: 'pause', mode: 'append', presetKey: 'Line', question: { reason: 'uncertain' } })
      const risky = { ...sure, next_step_risk: noul(0.9) }
      expect(decide(input({ space: desktop, presets, answers: risky }))).toMatchObject({ kind: 'pause', mode: 'append', question: { reason: 'risky', options: [expect.objectContaining({ key: '3', label: 'append to textbox First line' }), expect.objectContaining({ key: 'abort' })] } })
      // No preset names the area: the caller supplies the text.
      expect(decide(input({ space: desktop, presets: [], answers: { ...calm, action: pick('append', DESKTOP_ACTIONS), append_target: pick('3', APPENDS) } }))).toMatchObject({ kind: 'pause', mode: 'append', question: { type: 'value' } })
    })
  })
})
