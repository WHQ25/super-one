import { describe, expect, it, vi } from 'vitest'
import type { PageObservation } from './browser-page'
import { FastRun, type RunDeps, type RunOptions } from './loop'
import { NONE } from './questions'
import { el, noul, page, pick } from './test-fixtures'
import type { JevAnswer, JevRequest } from './typesafe-client'

const HOME = page([
  el({ node: 1, role: 'link', label: 'Issues', href: 'https://github.com/x/issues' }),
])
const FORM = page([
  el({ node: 10, role: 'textbox', label: 'Add a title', editable: true }),
  el({ node: 11, role: 'button', label: 'Create', submit: true }),
], { url: 'https://github.com/x/issues/new', text: 'New issue' })
const FILLED = page([
  el({ node: 10, role: 'textbox', label: 'Add a title', editable: true, value: 'Hello' }),
  el({ node: 11, role: 'button', label: 'Create', submit: true }),
], { url: 'https://github.com/x/issues/new', text: 'New issue filled' })
const CREATED = page([], { url: 'https://github.com/x/issues/42', text: 'Hello #42' })

type Script = (request: JevRequest) => Record<string, JevAnswer>

/** Fake browser: a queue of pages to observe, plus an answer script per step. */
function harness(pages: PageObservation[], script: Script) {
  const queue = [...pages]
  let current = queue.shift()!
  const acts: string[] = []
  const guard: boolean[] = []
  const deps: RunDeps<PageObservation> = {
    ask: async (request) => ({ answers: script(request), model: 'jev-test', usage: {}, latencyMs: 1 }),
    resolveTarget: async () => {},
    observe: async () => current,
    isFresh: async () => true,
    click: async (node) => { acts.push(`click:${node}`); current = queue.shift() ?? current },
    pressEnter: async (node) => { acts.push(`enter:${node}`); current = queue.shift() ?? current },
    type: async (node, text) => { acts.push(`type:${node}:${text}`); current = queue.shift() ?? current },
    scroll: async () => { acts.push('scroll'); current = queue.shift() ?? current },
    settle: async () => {},
    waitReady: async () => true,
    checkDone: async () => /\/issues\/\d+$/.test(current.url),
    changed: (before, after) => JSON.stringify(before.marker) !== JSON.stringify(after.marker),
    focusGuard: async (active) => { guard.push(active) },
    trace: () => {},
  }
  return { deps, acts, guard }
}

function opts(overrides: Partial<RunOptions> = {}): RunOptions {
  return { goal: 'Create an issue titled Hello', presets: [], allow: [], avoid: [], maxSteps: 30, maxWallMs: 60_000, ...overrides }
}

function actionsOf(request: JevRequest): string[] {
  return Object.keys((request.questions.action as { criteria: Record<string, unknown> }).criteria)
}
function clicksOf(request: JevRequest): string[] {
  return Object.keys((request.questions.click_target as { criteria: Record<string, unknown> }).criteria)
}
function typesOf(request: JevRequest): string[] {
  return Object.keys((request.questions.type_text_target as { criteria: Record<string, unknown> }).criteria)
}

describe('FastRun', () => {
  it('runs safe steps, pauses on the guarded submit, executes it on resume, and finishes on done_when', async () => {
    const { deps, acts, guard } = harness([HOME, FORM, FILLED, CREATED], (request) => {
      const state = request.state as { page: { url: string }; elements: Array<{ label: string; value?: string }> }
      const base = { still_loading: noul(0.05), goal_satisfied: noul(0.1) }
      if (state.page.url.endsWith('jev-ultrafast')) return { ...base, action: pick('click', actionsOf(request)), click_target: pick('1', clicksOf(request)) }
      if (!state.elements[0].value) return { ...base, action: pick('type_text', actionsOf(request)), type_text_target: pick('1', typesOf(request)) }
      return { ...base, action: pick('none_useful', actionsOf(request)) }
    })
    const run = new FastRun(opts({ presets: [{ key: 'Title', value: 'Hello', field: 'title' }], hasDoneWhen: true }), deps)

    const paused = await run.start()
    expect(paused.status).toBe('paused')
    expect(paused.question).toMatchObject({ reason: 'guarded-only', type: 'choice' })
    // Guarded first (the Create button, then Enter in the filled title), then the safe candidate Jev declined.
    expect(paused.question!.options!.map((o) => o.key)).toEqual(['2', 'submit:1', 'open:1', 'abort'])
    expect(paused.since_last).toEqual(['Click [1] Issues', 'Type presets.Title → [1] Add a title'])
    expect(acts).toEqual(['click:1', 'type:10:Hello'])
    // The focus guard is released while paused so the user can use the tab.
    expect(guard).toEqual([true, false])

    const done = await run.resume({ questionId: paused.question!.id, choice: '2' })
    expect(done.status).toBe('done')
    expect(done.why).toBe('done_when satisfied')
    expect(acts).toEqual(['click:1', 'type:10:Hello', 'click:11'])
    expect(done.since_last).toEqual(['Click [2] Create'])
    expect(guard).toEqual([true, false, true, false])
  })

  it('keeps the answer through guard drift when the same node is still there, and discards it once the target is gone', async () => {
    const script: Script = (request) => ({
      still_loading: noul(0), goal_satisfied: noul(0), action: pick('none_useful', actionsOf(request)),
    })
    // Guard drift only (the form's surroundings changed): same node, same label → still executed.
    const drifted = harness([FORM, FORM], script)
    drifted.deps.isFresh = vi.fn(async () => false)
    const run = new FastRun(opts({ hasDoneWhen: true, maxSteps: 2 }), drifted.deps)
    const paused = await run.start()
    await run.resume({ questionId: paused.question!.id, choice: '2' })
    expect(drifted.acts[0]).toBe('click:11')

    // The button itself was replaced: the answer no longer names anything on the page.
    const replaced = harness([FORM], script)
    replaced.deps.isFresh = vi.fn(async () => false)
    const run2 = new FastRun(opts({ hasDoneWhen: true, maxSteps: 2 }), replaced.deps)
    const paused2 = await run2.start()
    replaced.deps.observe = async () => page([
      el({ node: 10, role: 'textbox', label: 'Add a title', editable: true }),
      el({ node: 12, role: 'button', label: 'Submit new issue', submit: true }),
    ], { url: FORM.url, text: 'New issue v2' })
    const next = await run2.resume({ questionId: paused2.question!.id, choice: '2' })
    expect(replaced.acts).toEqual([])
    expect(next.since_last[0]).toBe('Page changed while paused; answer discarded')
    expect(next.status).toBe('paused')
  })

  it('aborts on request and refuses a mismatched question id', async () => {
    const { deps } = harness([FORM], (request) => ({ still_loading: noul(0), goal_satisfied: noul(0), action: pick('none_useful', actionsOf(request)) }))
    const run = new FastRun(opts({ hasDoneWhen: true }), deps)
    const paused = await run.start()
    expect((await run.resume({ questionId: 'q99', choice: '2' })).status).toBe('aborted')

    const run2 = new FastRun(opts({ hasDoneWhen: true }), deps)
    const paused2 = await run2.start()
    expect((await run2.resume({ questionId: paused2.question!.id, abort: true })).status).toBe('aborted')
    expect(paused.runId).not.toBe(paused2.runId)
  })

  it('pauses on budget and continues with a fresh step budget', async () => {
    const scrolled = (n: number) => page(HOME.elements, { text: `scrolled ${n}`, scroll: { y: n * 560, height: 5000, viewport: 800 } })
    const { deps, acts } = harness([HOME, scrolled(1), scrolled(2), scrolled(3), scrolled(4)], (request) => ({
      still_loading: noul(0), goal_satisfied: noul(0), action: pick('scroll_down', actionsOf(request)),
    }))
    const run = new FastRun(opts({ maxSteps: 2, hasDoneWhen: true }), deps)
    const paused = await run.start()
    expect(paused).toMatchObject({ status: 'paused', question: { reason: 'budget' }, steps: 2 })
    expect(acts).toEqual(['scroll', 'scroll'])
    const again = await run.resume({ questionId: paused.question!.id, choice: 'continue' })
    expect(again.question?.reason).toBe('budget')
    expect(acts).toHaveLength(4)
  })

  it('pauses with no-progress after three unchanged actions', async () => {
    const { deps } = harness([HOME], (request) => request.questions.click_target
      ? { still_loading: noul(0), goal_satisfied: noul(0), action: pick('click', actionsOf(request)), click_target: pick('1', clicksOf(request)) }
      : { still_loading: noul(0), goal_satisfied: noul(0), action: pick('scroll_down', actionsOf(request)) })
    // Every click leaves the same page; the stuck rule drops [1] after the first
    // miss, so the next steps have no click candidate and scroll instead.
    const run = new FastRun(opts({ hasDoneWhen: true }), deps)
    const paused = await run.start()
    expect(paused.status).toBe('paused')
    expect(paused.question?.reason).toBe('no-progress')
    expect(paused.since_last[0]).toBe('Click [1] Issues (no change)')
  })

  it('never offers the NONE sentinel as an element and keeps guarded elements visible in state', async () => {
    let seen: JevRequest | null = null
    const { deps } = harness([FORM], (request) => {
      seen = request
      return { still_loading: noul(0), goal_satisfied: noul(0), action: pick('none_useful', actionsOf(request)) }
    })
    await new FastRun(opts({ hasDoneWhen: true }), deps).start()
    const state = (seen as unknown as JevRequest).state as { elements: Array<{ label: string; guarded?: true }> }
    expect(state.elements.find((e) => e.label === 'Create')?.guarded).toBe(true)
    expect(clicksOf(seen as unknown as JevRequest)).toEqual(['open:1', NONE])
  })

  it('presses Enter in a filled field when the caller answers submit:N, and offers it to Jev when allowed', async () => {
    const script: Script = (request) => ({ still_loading: noul(0), goal_satisfied: noul(0), action: pick('none_useful', actionsOf(request)) })
    const answered = harness([FILLED, CREATED], script)
    const run = new FastRun(opts({ hasDoneWhen: true }), answered.deps)
    const paused = await run.start()
    const done = await run.resume({ questionId: paused.question!.id, choice: 'submit:1' })
    expect(answered.acts).toEqual(['enter:10'])
    expect(done.status).toBe('done')
    expect(done.since_last).toEqual(['Press Enter in [1] Add a title'])

    let offered: string[] = []
    const allowed = harness([FILLED, CREATED], (request) => {
      offered = clicksOf(request)
      return { still_loading: noul(0), goal_satisfied: noul(0), action: pick('click', actionsOf(request)), click_target: pick('submit:1', clicksOf(request)) }
    })
    const run2 = new FastRun(opts({ allow: ['Enter'], hasDoneWhen: true }), allowed.deps)
    expect((await run2.start()).status).toBe('done')
    expect(offered).toContain('submit:1')
    expect(allowed.acts).toEqual(['enter:10'])
  })
})
