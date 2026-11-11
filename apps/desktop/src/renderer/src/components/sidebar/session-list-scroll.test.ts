/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { chainSessionListWheel, measureMultiHostSections, multiHostProjectListMaxHeights, projectFocusSessionListMaxHeights, SESSION_LIST_CAP_PX } from './session-list-scroll'

function scrollport(
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
  overflowY = 'scroll',
): HTMLElement {
  const el = document.createElement('div')
  el.style.overflowY = overflowY
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: metrics.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: metrics.clientHeight })
  let top = metrics.scrollTop
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => { top = value },
  })
  document.body.appendChild(el)
  return el
}

function wheel(deltaY: number, extra: { ctrlKey?: boolean } = {}) {
  let stopped = false
  const event = {
    deltaY,
    ctrlKey: extra.ctrlKey,
    stopPropagation: () => { stopped = true },
  }
  return { event, stopped: () => stopped }
}

describe('projectFocusSessionListMaxHeights', () => {
  const local = (sessionCount: number, hasMore = false) => ({ environmentId: 'local', sessionCount, hasMore })
  const remote = (sessionCount: number, hasMore = false) => ({ environmentId: 'remote', sessionCount, hasMore })

  it('lets the only list fill the pane', () => {
    expect(projectFocusSessionListMaxHeights([local(3)], 0)).toEqual([{ kind: 'fill' }])
    expect(projectFocusSessionListMaxHeights([local(40)], 900)).toEqual([{ kind: 'fill' }])
  })

  it('keeps the shared cap when every environment already overflows it', () => {
    expect(projectFocusSessionListMaxHeights([local(20), remote(12)], 900)).toEqual([
      { kind: 'cap' },
      { kind: 'cap' },
    ])
    expect(projectFocusSessionListMaxHeights([local(3, true), remote(1, true)], 0)).toEqual([
      { kind: 'cap' },
      { kind: 'cap' },
    ])
  })

  it('gives leftover pane height to the environment with many sessions', () => {
    const [busy, quiet] = projectFocusSessionListMaxHeights([local(20), remote(2)], 640)
    expect(quiet).toEqual({ kind: 'cap' })
    expect(busy).toEqual({ kind: 'px', maxHeight: 640 - 32 * 2 - 2 * 32 })
    expect(busy?.kind === 'px' && busy.maxHeight).toBeGreaterThan(SESSION_LIST_CAP_PX)
  })

  it('splits one environment with several full checkouts across the pane', () => {
    const heights = projectFocusSessionListMaxHeights([local(20), { ...local(10), sessionCount: 10 }], 800)
    expect(heights.every((height) => height.kind === 'px' && height.maxHeight === 400)).toBe(true)
  })

  it('keeps short lists on the cap until the pane has been measured', () => {
    expect(projectFocusSessionListMaxHeights([local(20), remote(2)], 0)).toEqual([
      { kind: 'cap' },
      { kind: 'cap' },
    ])
  })
})

describe('multiHostProjectListMaxHeights', () => {
  const device = (environmentId: string, fixedPx: number, sessions: { key: string; contentPx: number }[] = [], open = true) => ({
    environmentId, open, fixedPx, sessions,
  })

  it('stretches the only device into the measured pane', () => {
    const { projects } = multiHostProjectListMaxHeights([device('local', 14 * 36)], 640)
    expect(projects.get('local')).toEqual({ kind: 'px', maxHeight: 640 - 36 })
  })

  it('splits the pane evenly when every open device overflows its share', () => {
    const { projects, sessions } = multiHostProjectListMaxHeights([
      device('local', 14 * 36),
      device('remote', 10 * 36),
    ], 600)
    const share = (600 - 36 * 2) / 2
    expect(projects.get('local')).toEqual({ kind: 'px', maxHeight: share })
    expect(projects.get('remote')).toEqual({ kind: 'px', maxHeight: share })
    expect(sessions.size).toBe(0)
  })

  it('keeps every device on the cap when the pane cannot fit them all', () => {
    const { projects } = multiHostProjectListMaxHeights([
      device('local', 14 * 36),
      device('remote', 36),
      device('build', 10 * 36),
    ], 500)
    expect(projects.get('local')).toEqual({ kind: 'cap' })
    expect(projects.get('build')).toEqual({ kind: 'cap' })
  })

  it('fills the smallest remaining need before splitting the rest', () => {
    const { projects } = multiHostProjectListMaxHeights([
      device('local', 900),
      device('remote', 300),
      device('build', 100),
    ], 36 * 3 + 256 + 100 + 256 + 200)
    expect(projects.get('local')).toEqual({ kind: 'px', maxHeight: 256 + 200 - 44 })
  })

  it('leaves a quiet device only what it shows and grows the busy one', () => {
    const { projects, sessions } = multiHostProjectListMaxHeights([
      device('local', 36, [{ key: '/src/app', contentPx: 640 }]),
      device('remote', 68, [{ key: 'remote:/srv/app', contentPx: 32 }]),
    ], 660)
    const busy = 660 - 36 * 2 - 100
    expect(projects.get('local')).toEqual({ kind: 'px', maxHeight: busy })
    expect(sessions.get('/src/app')).toBe(busy - 36)
  })

  it('keeps a collapsed device as a heading only', () => {
    const { projects } = multiHostProjectListMaxHeights([
      device('local', 14 * 36),
      device('remote', 10 * 36, [], false),
    ], 640)
    expect(projects.get('local')).toEqual({ kind: 'px', maxHeight: 640 - 36 * 2 })
    expect(projects.get('remote')).toEqual({ kind: 'cap' })
  })

  it('does not shrink a session list just to fit sibling projects', () => {
    const { sessions } = multiHostProjectListMaxHeights([
      device('local', 14 * 36, [{ key: 'a', contentPx: 640 }]),
      device('remote', 36),
    ], 640)
    expect(sessions.has('a')).toBe(false)
  })

  it('splits two full projects on one device', () => {
    const { sessions } = multiHostProjectListMaxHeights([
      device('local', 2 * 36, [{ key: 'a', contentPx: 640 }, { key: 'b', contentPx: 384 }]),
    ], 800)
    const room = 800 - 36 - 2 * 36
    expect(sessions.get('a')).toBe(room / 2)
    expect(sessions.get('b')).toBe(room / 2)
  })

  it('stays on the cap before the pane is measured', () => {
    const { projects, sessions } = multiHostProjectListMaxHeights([
      device('local', 36, [{ key: '/src/app', contentPx: 640 }]),
    ], 0)
    expect(projects.get('local')).toEqual({ kind: 'cap' })
    expect(sessions.size).toBe(0)
  })
})

describe('measureMultiHostSections', () => {
  const box = (html: string) => {
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.appendChild(root)
    return root
  }
  const sized = (root: HTMLElement, selector: string, height: number) => {
    const element = root.querySelector(selector)!
    element.getBoundingClientRect = () => ({ height } as DOMRect)
  }

  it('reads device content outside its active lists and each list at full length', () => {
    const root = box(`
      <div data-environment-id="desktop">
        <div data-environment-project-list>
          <div data-slot="scroll-area-viewport"><div id="device">
            <div data-project-key="/src/app">
              <div data-active-session-list>
                <div data-slot="scroll-area-viewport"><div id="sessions"></div></div>
              </div>
            </div>
          </div></div>
        </div>
      </div>`)
    sized(root, '#device', 400)
    sized(root, '[data-active-session-list]', 256)
    sized(root, '#sessions', 640)
    const tracked: Element[] = []

    const sizes = measureMultiHostSections(root, (element) => tracked.push(element))

    expect(sizes.get('desktop')).toEqual({ fixedPx: 144, sessions: [{ key: '/src/app', contentPx: 640 }] })
    expect(tracked.map((element) => element.id)).toEqual(['device', 'sessions'])
  })
})

describe('chainSessionListWheel', () => {
  it('keeps a wheel that the list can still consume', () => {
    const sidebar = scrollport({ scrollHeight: 800, clientHeight: 200, scrollTop: 80 })
    const list = scrollport({ scrollHeight: 400, clientHeight: 100, scrollTop: 40 })
    sidebar.appendChild(list)
    const { event, stopped } = wheel(24)
    chainSessionListWheel(list, event)
    expect(list.scrollTop).toBe(40)
    expect(sidebar.scrollTop).toBe(80)
    expect(stopped()).toBe(true)
  })

  it('continues into the parent when the list is already at the top or bottom', () => {
    const sidebar = scrollport({ scrollHeight: 800, clientHeight: 200, scrollTop: 80 })
    const list = scrollport({ scrollHeight: 400, clientHeight: 100, scrollTop: 0 })
    sidebar.appendChild(list)
    chainSessionListWheel(list, wheel(-30).event)
    expect(sidebar.scrollTop).toBe(50)

    list.scrollTop = 300
    chainSessionListWheel(list, wheel(20).event)
    expect(sidebar.scrollTop).toBe(70)
  })

  it('skips a nested list that is also at the edge', () => {
    const sidebar = scrollport({ scrollHeight: 800, clientHeight: 200, scrollTop: 80 })
    const active = scrollport({ scrollHeight: 400, clientHeight: 100, scrollTop: 0 })
    const child = scrollport({ scrollHeight: 300, clientHeight: 100, scrollTop: 0 })
    sidebar.appendChild(active)
    active.appendChild(child)
    chainSessionListWheel(child, wheel(-16).event)
    expect(active.scrollTop).toBe(0)
    expect(sidebar.scrollTop).toBe(64)
  })

  it('leaves a zoom gesture alone', () => {
    const sidebar = scrollport({ scrollHeight: 800, clientHeight: 200, scrollTop: 80 })
    const list = scrollport({ scrollHeight: 400, clientHeight: 100, scrollTop: 0 })
    sidebar.appendChild(list)
    const { event, stopped } = wheel(-30, { ctrlKey: true })
    chainSessionListWheel(list, event)
    expect(sidebar.scrollTop).toBe(80)
    expect(stopped()).toBe(false)
  })
})
