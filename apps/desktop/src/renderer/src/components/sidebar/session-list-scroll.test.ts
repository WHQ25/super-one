/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { chainSessionListWheel, multiHostProjectListMaxHeights, projectFocusSessionListMaxHeights, SESSION_LIST_CAP_PX } from './session-list-scroll'

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

  it('stretches one long list under its heading once the pane is measured', () => {
    expect(projectFocusSessionListMaxHeights([local(3)], 640, { loneList: 'stretch', headingPx: 36 })).toEqual([
      { kind: 'cap' },
    ])
    expect(projectFocusSessionListMaxHeights([local(20)], 0, { loneList: 'stretch' })).toEqual([
      { kind: 'cap' },
    ])
    expect(projectFocusSessionListMaxHeights([local(20)], 640, { loneList: 'stretch', headingPx: 36 })).toEqual([
      { kind: 'px', maxHeight: 640 - 36 },
    ])
  })
})

describe('multiHostProjectListMaxHeights', () => {
  it('stretches the only device into the measured pane', () => {
    const { projects } = multiHostProjectListMaxHeights([
      { environmentId: 'local', open: true, projectCount: 14, sessions: [] },
    ], 640)
    expect(projects.get('local')).toEqual({ kind: 'px', maxHeight: 640 - 36 })
  })

  it('keeps the cap when every open device already overflows it', () => {
    const { projects, sessions } = multiHostProjectListMaxHeights([
      { environmentId: 'local', open: true, projectCount: 14, sessions: [] },
      { environmentId: 'remote', open: true, projectCount: 10, sessions: [] },
    ], 900)
    expect(projects.get('local')).toEqual({ kind: 'cap' })
    expect(projects.get('remote')).toEqual({ kind: 'cap' })
    expect(sessions.size).toBe(0)
  })

  it('gives leftover height to the long device and grows its session list', () => {
    const { projects, sessions } = multiHostProjectListMaxHeights([
      { environmentId: 'local', open: true, projectCount: 1, sessions: [{ key: '/src/app', sessionCount: 20 }] },
      { environmentId: 'remote', open: true, projectCount: 1, sessions: [] },
    ], 640)
    expect(projects.get('remote')).toEqual({ kind: 'cap' })
    expect(projects.get('local')).toEqual({ kind: 'px', maxHeight: 640 - 36 * 2 - 36 })
    expect(sessions.get('/src/app')).toBe(640 - 36 * 2 - 36 - 36)
  })

  it('keeps a collapsed device as a heading only', () => {
    const { projects } = multiHostProjectListMaxHeights([
      { environmentId: 'local', open: true, projectCount: 14, sessions: [] },
      { environmentId: 'remote', open: false, projectCount: 10, sessions: [] },
    ], 640)
    expect(projects.get('local')).toEqual({ kind: 'px', maxHeight: 640 - 36 * 2 })
  })

  it('does not shrink a session list just to fit sibling projects', () => {
    const { sessions } = multiHostProjectListMaxHeights([
      {
        environmentId: 'local',
        open: true,
        projectCount: 14,
        sessions: [{ key: 'a', sessionCount: 20 }],
      },
      { environmentId: 'remote', open: true, projectCount: 1, sessions: [] },
    ], 640)
    expect(sessions.has('a')).toBe(false)
  })

  it('splits two full projects on one device', () => {
    const { sessions } = multiHostProjectListMaxHeights([
      {
        environmentId: 'local',
        open: true,
        projectCount: 2,
        sessions: [
          { key: 'a', sessionCount: 20 },
          { key: 'b', sessionCount: 12 },
        ],
      },
    ], 800)
    const room = 800 - 36 - 2 * 36
    expect(sessions.get('a')).toBe(room / 2)
    expect(sessions.get('b')).toBe(room / 2)
  })

  it('stays on the cap before the pane is measured', () => {
    const { projects, sessions } = multiHostProjectListMaxHeights([
      { environmentId: 'local', open: true, projectCount: 1, sessions: [{ key: '/src/app', sessionCount: 20 }] },
    ], 0)
    expect(projects.get('local')).toEqual({ kind: 'cap' })
    expect(sessions.size).toBe(0)
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
