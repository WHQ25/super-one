import { describe, expect, it } from 'vitest'
import {
  observationSignature,
  settleByPolling,
  waitForChangeByPolling,
  waitReadyByPolling,
  SETTLED_ADAPTER_POLL_MS,
  type SettleClock,
} from './settle'
import { el, page } from './test-fixtures'

/** A clock that never really waits: sleeping only moves the reading forward. */
function fakeClock(): SettleClock {
  let at = 0
  return {
    now: () => at,
    sleep: async (ms) => { at += ms },
  }
}

/** Hands out one observation per call, repeating the last one forever. */
function feed(pages: ReturnType<typeof page>[]) {
  let i = 0
  const calls: number[] = []
  const observe = async () => {
    calls.push(i)
    return pages[Math.min(i++, pages.length - 1)]!
  }
  return { observe, reads: () => i, calls }
}

const menu = page([el({ node: 1, role: 'button', label: 'File' })])
const menuOpening = page([
  el({ node: 1, role: 'button', label: 'File' }),
  el({ node: 2, role: 'menuitem', label: 'Open' }),
])
const menuOpen = page([
  el({ node: 1, role: 'button', label: 'File' }),
  el({ node: 2, role: 'menuitem', label: 'Open' }),
  el({ node: 3, role: 'menuitem', label: 'Save' }),
])

describe('observationSignature', () => {
  it('covers what a decision is made from', () => {
    expect(observationSignature(menu)).not.toBe(observationSignature(menuOpen))
    expect(observationSignature(menu)).toBe(observationSignature(page([el({ node: 1, role: 'button', label: 'File' })])))
  })

  it('ignores the scroll offset, which no decision is made from', () => {
    const scrolled = page([el({ node: 1, role: 'button', label: 'File' })], {
      scroll: { y: 120, height: 3000, viewport: 700 },
    })
    expect(observationSignature(scrolled)).toBe(observationSignature(menu))
  })

  it('notices a change that lives only in the text', () => {
    // A calculator press moves nothing but the display, and the display is a
    // static label — every element keeps its role, label and value. Reading
    // elements alone called the whole calculation "unchanged".
    const typing = page([el({ node: 1, role: 'button', label: 'File' })], { text: 'sine (, π ÷, implicit )' })
    const typed = page([el({ node: 1, role: 'button', label: 'File' })], { text: 'sine (, π ÷ 6, implicit )' })
    expect(observationSignature(typing)).not.toBe(observationSignature(typed))
  })

  it('notices a control changing state without the element list moving', () => {
    const before = page([el({ node: 1, role: 'checkbox', label: 'Wi-Fi', checked: 'false' })])
    const after = page([el({ node: 1, role: 'checkbox', label: 'Wi-Fi', checked: 'true' })])
    expect(observationSignature(before)).not.toBe(observationSignature(after))
  })
})

describe('settleByPolling', () => {
  it('waits out a reveal and reports the state it came to rest in', async () => {
    // The menu is mid-animation on the first read: stopping there is what made
    // a run decide against half a submenu.
    const source = feed([menuOpening, menuOpen, menuOpen])
    const result = await settleByPolling(menu, source.observe, undefined, { clock: fakeClock() })
    expect(result.report).toMatchObject({ changed: true })
    expect(result.page?.elements).toHaveLength(3)
  })

  it('gives up early when the action changed nothing', async () => {
    const source = feed([menu])
    const result = await settleByPolling(menu, source.observe, undefined, { clock: fakeClock() })
    expect(result.report).toMatchObject({ changed: false })
    // 600ms of grace at 150ms a read, not the whole 1500ms budget.
    expect(source.reads()).toBe(4)
  })

  it('stops at the budget when the surface never holds still', async () => {
    const churning = Array.from({ length: 40 }, (_, i) => page([el({ node: 1, role: 'button', label: `Frame ${i}` })]))
    const source = feed(churning)
    const result = await settleByPolling(menu, source.observe, undefined, { clock: fakeClock() })
    expect(result.report).toMatchObject({ changed: true, fields: ['budget'] })
    expect(source.reads()).toBe(10)
  })

  it('does not call a still-loading screen settled', async () => {
    const loading = page([el({ node: 1, role: 'button', label: 'File' })], { loading: true })
    const source = feed([loading, loading, loading, menuOpen, menuOpen])
    const result = await settleByPolling(menu, source.observe, undefined, { clock: fakeClock() })
    expect(result.report).toMatchObject({ changed: true })
    expect(result.page?.elements).toHaveLength(3)
  })
})

describe('waitForChangeByPolling', () => {
  it('resolves as soon as the observation differs', async () => {
    const source = feed([menu, menu, menuOpen])
    await expect(waitForChangeByPolling(menu, 4000, source.observe, undefined, { clock: fakeClock() })).resolves.toBe(true)
    expect(source.reads()).toBe(3)
  })

  it('reports no change once the cap passes', async () => {
    const source = feed([menu])
    await expect(waitForChangeByPolling(menu, 1000, source.observe, undefined, { clock: fakeClock() })).resolves.toBe(false)
  })

  it('leans on observe for throttling when the adapter already settles', async () => {
    // A device screenshots until the pixels hold still on every read, so it
    // polls at the floor rather than adding a full interval on top. The floor
    // is what guarantees the deadline is reached at all: with no delay, a read
    // that returns instantly would spin forever.
    const clock = fakeClock()
    const source = feed([menu])
    await expect(waitForChangeByPolling(menu, 1000, source.observe, undefined, {
      clock, pollMs: SETTLED_ADAPTER_POLL_MS,
    })).resolves.toBe(false)
    expect(source.reads()).toBe(41)
  })
})

describe('waitReadyByPolling', () => {
  it('holds until the surface stops reporting itself in motion', async () => {
    const moving = page([el({ node: 1, role: 'button', label: 'File' })], { loading: true })
    const source = feed([moving, moving, menu])
    await expect(waitReadyByPolling(1500, source.observe, undefined, { clock: fakeClock() })).resolves.toBe(true)
    expect(source.reads()).toBe(3)
  })

  it('gives up at the timeout rather than blocking the run', async () => {
    const moving = page([el({ node: 1, role: 'button', label: 'File' })], { loading: true })
    const source = feed([moving])
    await expect(waitReadyByPolling(300, source.observe, undefined, { clock: fakeClock() })).resolves.toBe(false)
  })
})
