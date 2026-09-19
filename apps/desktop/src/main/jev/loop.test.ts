import { describe, expect, it, vi } from 'vitest'
import type { PageObservation } from './browser-page'
import { FastRun, StaleObservation, type RunDeps, type RunOptions } from './loop'
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
  return { goal: 'Create an issue titled Hello', presets: [], maxSteps: 30, maxWallMs: 60_000, ...overrides }
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
  it('sends only the last eight completed action labels across pauses, without waits or stale indices', async () => {
    const states: Array<{ completed_actions: string[] }> = []
    const pages = Array.from({ length: 12 }, (_, i) => page([
      el({ node: 1, role: 'button', label: `Step ${i}` }),
    ], { text: `Screen ${i}` }))
    const { deps } = harness(pages, (request) => {
      states.push(request.state as typeof states[number])
      return {
        still_loading: noul(states.length === 1 ? 1 : 0), goal_satisfied: noul(0), next_step_risk: noul(0),
        action: pick('click', actionsOf(request)), click_target: pick('1', clicksOf(request)),
      }
    })
    const run = new FastRun(opts({ maxSteps: 11 }), deps)
    const paused = await run.start()
    expect(states[0].completed_actions).toEqual([])
    expect(states[1].completed_actions).toEqual([])
    expect(states[2].completed_actions).toEqual(['Click Step 0'])
    expect(states.at(-1)?.completed_actions).toEqual(Array.from({ length: 8 }, (_, i) => `Click Step ${i + 1}`))
    deps.ask = async (request) => {
      expect((request.state as typeof states[number]).completed_actions).toEqual(Array.from({ length: 8 }, (_, i) => `Click Step ${i + 2}`))
      return { answers: { goal_satisfied: noul(1) }, model: 'test', usage: {}, latencyMs: 1 }
    }
    await run.resume({ questionId: paused.question!.id, choice: 'continue' })
  })

  it('keeps stale recovery inside the focus guard and converts adapter obstructions to pauses', async () => {
    const { deps, guard } = harness([HOME], () => ({}))
    deps.resolveTarget = async () => { throw new StaleObservation('Target moved') }
    deps.observe = async () => {
      expect(guard.at(-1)).toBe(true)
      return { ...HOME, blocked: { reason: 'no-progress', why: 'Tree unavailable' } }
    }
    expect(await new FastRun(opts(), deps).start()).toMatchObject({
      status: 'paused', question: { reason: 'no-progress', context: { why: 'Tree unavailable' } },
    })
    expect(guard).toEqual([true, false])
  })

  it('runs plain steps, asks before the submit Jev rates irreversible, executes it on resume, and finishes on done_when', async () => {
    const { deps, acts, guard } = harness([HOME, FORM, FILLED, CREATED], (request) => {
      const state = request.state as { page: { url: string }; elements: Array<{ label: string; value?: string }> }
      const base = { still_loading: noul(0.05), goal_satisfied: noul(0.1), next_step_risk: noul(0.05) }
      if (state.page.url.endsWith('jev-ultrafast')) return { ...base, action: pick('click', actionsOf(request)), click_target: pick('1', clicksOf(request)) }
      if (!state.elements[0].value) return { ...base, action: pick('type_text', actionsOf(request)), type_text_target: pick('1', typesOf(request)) }
      // Submitting the issue is the irreversible step: Jev says so itself.
      return { ...base, next_step_risk: noul(0.9), action: pick('click', actionsOf(request)), click_target: pick('2', clicksOf(request)) }
    })
    const run = new FastRun(opts({ presets: [{ key: 'Title', value: 'Hello', field: 'title' }], hasDoneWhen: true }), deps)

    const paused = await run.start()
    expect(paused.status).toBe('paused')
    expect(paused.question).toMatchObject({ reason: 'risky', type: 'choice' })
    // The risky step first, then the alternatives, then abort.
    expect(paused.question!.options!.map((o) => o.key)).toEqual(['2', 'open:1', 'submit:1', 'abort'])
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
      still_loading: noul(0), goal_satisfied: noul(0), next_step_risk: noul(0.9), action: pick('click', actionsOf(request)), click_target: pick('2', clicksOf(request)),
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
    const { deps } = harness([FORM], (request) => ({ still_loading: noul(0), goal_satisfied: noul(0), next_step_risk: noul(0.9), action: pick('click', actionsOf(request)), click_target: pick('2', clicksOf(request)) }))
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
      still_loading: noul(0), goal_satisfied: noul(0), next_step_risk: noul(0), action: pick('scroll_down', actionsOf(request)),
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
      ? { still_loading: noul(0), goal_satisfied: noul(0), next_step_risk: noul(0), action: pick('click', actionsOf(request)), click_target: pick('1', clicksOf(request)) }
      : { still_loading: noul(0), goal_satisfied: noul(0), next_step_risk: noul(0), action: pick('scroll_down', actionsOf(request)) })
    // Every click leaves the same page; the stuck rule drops [1] after the first
    // miss, so the next steps have no click candidate and scroll instead.
    const run = new FastRun(opts({ hasDoneWhen: true }), deps)
    const paused = await run.start()
    expect(paused.status).toBe('paused')
    expect(paused.question?.reason).toBe('no-progress')
    expect(paused.since_last[0]).toBe('Click [1] Issues (no change)')
  })

  it('offers every element to Jev, never the NONE sentinel as one, and asks the risk question each step', async () => {
    let seen: JevRequest | null = null
    const { deps } = harness([FORM], (request) => {
      seen = request
      return { still_loading: noul(0), goal_satisfied: noul(0), next_step_risk: noul(0), action: pick('none_useful', actionsOf(request)) }
    })
    await new FastRun(opts({ hasDoneWhen: true }), deps).start()
    const request = seen as unknown as JevRequest
    expect(clicksOf(request).sort()).toEqual(['2', NONE, 'open:1'].sort())
    expect(request.questions.next_step_risk?.type).toBe('noul')
  })

  it('re-observes when the target vanishes under a decision instead of failing the run', async () => {
    // npm search: the results page replaced the form between observe and click.
    const { deps, acts } = harness([FORM, CREATED], (request) => {
      const state = request.state as { page: { url: string } }
      if (/\/issues\/\d+$/.test(state.page.url)) return { still_loading: noul(0), goal_satisfied: noul(0.95), next_step_risk: noul(0), action: pick('none_useful', actionsOf(request)) }
      return { still_loading: noul(0), goal_satisfied: noul(0), next_step_risk: noul(0), action: pick('click', actionsOf(request)), click_target: pick('2', clicksOf(request)) }
    })
    const click = deps.click
    deps.click = async (node) => {
      deps.click = click
      await click(node)
      throw new StaleObservation('Target changed or is covered')
    }
    deps.checkDone = async () => false
    const result = await new FastRun(opts(), deps).start()
    expect(result).toMatchObject({ status: 'done', why: 'goal_satisfied 0.95' })
    expect(acts).toEqual(['click:11'])
    expect(result.since_last).toEqual([])
  })

  it('waits for the page to change when Jev says the needed control is absent, with growing patience, then acts', async () => {
    // A click started an in-page navigation; the old page is still showing.
    const caps: number[] = []
    const asked: number[] = []
    const { deps, acts } = harness([HOME, CREATED], (request) => {
      const state = request.state as { page: { url: string } }
      asked.push(1)
      if (/\/issues\/\d+$/.test(state.page.url)) return { still_loading: noul(0), goal_satisfied: noul(0.95), next_step_risk: noul(0), action: pick('none_useful', actionsOf(request)) }
      return { still_loading: noul(0.9), goal_satisfied: noul(0), next_step_risk: noul(0), action: pick('none_useful', actionsOf(request)) }
    })
    let current = HOME
    deps.observe = async () => current
    deps.waitForChange = async (_page, timeoutMs) => {
      caps.push(timeoutMs)
      if (caps.length < 3) return false
      current = CREATED
      return true
    }
    deps.checkDone = async () => false
    const result = await new FastRun(opts(), deps).start()
    expect(result).toMatchObject({ status: 'done', why: 'goal_satisfied 0.95' })
    expect(caps).toEqual([1000, 2000, 4000])
    expect(acts).toEqual([])
    expect(result.since_last).toEqual([])
  })

  it('stops waiting after three unchanged waits and falls back to polling observe when the adapter has no event source', async () => {
    const asked: string[] = []
    const { deps } = harness([HOME], (request) => {
      asked.push('ask')
      return { still_loading: noul(0.95), goal_satisfied: noul(0), next_step_risk: noul(0), action: pick('click', actionsOf(request)), click_target: pick('1', clicksOf(request)) }
    })
    let clock = 0
    deps.now = () => clock
    const observe = deps.observe
    deps.observe = async () => { clock += 2500; return observe() }
    const result = await new FastRun(opts({ maxSteps: 4 }), deps).start()
    // Three waits polled the same page until each cap, then the fourth ask had to act.
    expect(asked).toHaveLength(4)
    expect(result.since_last).toEqual(['Click [1] Issues (no change)'])
  })

  it('offers a collapsed control as "Expand" and records it that way once clicked', async () => {
    // GitHub at 748 px: the search box is behind a "Toggle navigation" hamburger.
    const NARROW = page([el({ node: 1, role: 'button', label: 'Toggle navigation', expanded: 'false' })], { text: 'Home' })
    const OPENED = page([el({ node: 1, role: 'button', label: 'Toggle navigation', expanded: 'true' })], { text: 'Home with nav' })
    const seen: Array<{ criteria: string; completed: string[] }> = []
    const { deps } = harness([NARROW, OPENED], (request) => {
      const criteria = request.questions.click_target ? JSON.stringify((request.questions.click_target as { criteria: unknown }).criteria) : ''
      seen.push({ criteria, completed: (request.state as { completed_actions: string[] }).completed_actions })
      return { still_loading: noul(0), goal_satisfied: noul(0), next_step_risk: noul(0), action: pick('click', actionsOf(request)), click_target: pick('1', clicksOf(request)) }
    })
    deps.checkDone = async () => false
    await new FastRun(opts({ maxSteps: 2 }), deps).start()
    expect(seen[0].criteria).toContain('[1] Expand Toggle navigation')
    expect(seen[1].completed).toEqual(['Expand Toggle navigation'])
    expect(seen[1].criteria).toContain('"[1] Toggle navigation"')
  })

  it('finishes on Jev\'s verdict only after a fresh observation agrees', async () => {
    const verdicts: number[] = []
    const { deps, acts } = harness([CREATED], (request) => {
      const p = verdicts.shift() ?? 0
      return { still_loading: noul(0), goal_satisfied: noul(p), next_step_risk: noul(0), action: pick('none_useful', actionsOf(request)) }
    })
    // Sure once, then not: the run keeps going instead of finishing on a glimpse.
    verdicts.push(0.95, 0.2, 0.95, 0.96)
    deps.checkDone = async () => false
    const run = new FastRun(opts({ maxSteps: 6 }), deps)
    const result = await run.start()
    expect(result).toMatchObject({ status: 'done', why: 'goal_satisfied 0.96', steps: 4 })
    // The doubtful middle read acted normally (a scroll); nothing was clicked on a glimpse.
    expect(acts).toEqual(['scroll'])
  })

  it('presses Enter in a filled field when Jev chooses submit:N, or when the caller answers it after a risky pause', async () => {
    let offered: string[] = []
    const chosen = harness([FILLED, CREATED], (request) => {
      offered = clicksOf(request)
      return { still_loading: noul(0), goal_satisfied: noul(0), next_step_risk: noul(0.1), action: pick('click', actionsOf(request)), click_target: pick('submit:1', clicksOf(request)) }
    })
    const run = new FastRun(opts({ hasDoneWhen: true }), chosen.deps)
    const done = await run.start()
    expect(offered).toContain('submit:1')
    expect(chosen.acts).toEqual(['enter:10'])
    expect(done.status).toBe('done')
    expect(done.since_last).toEqual(['Press Enter in [1] Add a title'])

    const risky = harness([FILLED, CREATED], (request) => ({ still_loading: noul(0), goal_satisfied: noul(0), next_step_risk: noul(0.9), action: pick('click', actionsOf(request)), click_target: pick('submit:1', clicksOf(request)) }))
    const run2 = new FastRun(opts({ hasDoneWhen: true }), risky.deps)
    const paused = await run2.start()
    expect(paused.question).toMatchObject({ reason: 'risky' })
    expect(paused.question!.options![0]).toMatchObject({ key: 'submit:1', label: 'press Enter in textbox Add a title' })
    expect((await run2.resume({ questionId: paused.question!.id, choice: 'submit:1' })).status).toBe('done')
    expect(risky.acts).toEqual(['enter:10'])
  })
})
