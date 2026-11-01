/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { chainSessionListWheel } from './session-list-scroll'

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
