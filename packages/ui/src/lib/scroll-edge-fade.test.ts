/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { bindScrollEdgeFades, releaseFinishedScrollEdgeFade, watchScrollEdgeFade, watchScrollEdgeFades } from './scroll-edge-fade'

function installAnimations(scroller: HTMLElement, playState: AnimationPlayState | null) {
  scroller.getAnimations = () => (playState ? [{ playState } as Animation] : [])
}

function installWidths(scroller: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(scroller, 'scrollWidth', { configurable: true, get: () => scrollWidth })
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, get: () => clientWidth })
}

function installHeights(scroller: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => clientHeight })
}

/** jsdom's `animationName` setter does not go through the instance's `setProperty`. */
function recordAnimationName(scroller: HTMLElement): string[] {
  const applied: string[] = []
  let name = scroller.style.animationName
  Object.defineProperty(scroller.style, 'animationName', {
    configurable: true,
    get: () => name,
    set: (value: string) => {
      applied.push(value)
      name = value
    },
  })
  return applied
}

describe('scroll edge fade', () => {
  const stops: Array<() => void> = []
  afterEach(() => {
    while (stops.length) stops.pop()?.()
  })

  it('restarts a finished scroll timeline once the box fits, clearing the leading fade', () => {
    const scroller = document.createElement('div')
    installWidths(scroller, 200, 200)
    installAnimations(scroller, 'finished')
    const applied = recordAnimationName(scroller)

    releaseFinishedScrollEdgeFade(scroller)

    expect(applied).toEqual(['none', ''])
    expect(scroller.style.animationName).toBe('')
  })

  it('restarts a finished vertical timeline once the block axis fits', () => {
    const scroller = document.createElement('div')
    installWidths(scroller, 480, 200)
    installHeights(scroller, 200, 200)
    installAnimations(scroller, 'finished')
    const applied = recordAnimationName(scroller)

    releaseFinishedScrollEdgeFade(scroller, 'block')

    expect(applied).toEqual(['none', ''])
  })

  it('keeps the vertical fade while the block axis still overflows', () => {
    const scroller = document.createElement('div')
    installWidths(scroller, 200, 200)
    installHeights(scroller, 800, 200)
    installAnimations(scroller, 'finished')
    scroller.style.animationName = 'scroll-edge-fade-y'
    const applied = recordAnimationName(scroller)

    releaseFinishedScrollEdgeFade(scroller, 'block')

    expect(applied).toEqual([])
    expect(scroller.style.animationName).toBe('scroll-edge-fade-y')
  })

  it('releases a fitting vertical box from the block-axis watcher', () => {
    const scroller = document.createElement('div')
    document.body.append(scroller)
    installWidths(scroller, 480, 200)
    installHeights(scroller, 200, 200)
    installAnimations(scroller, 'finished')
    const applied = recordAnimationName(scroller)
    const stop = watchScrollEdgeFade(scroller, 'block')
    stops.push(() => {
      stop()
      scroller.remove()
    })

    expect(applied).toEqual(['none', ''])
  })

  it('keeps the fade while content still overflows', () => {
    const scroller = document.createElement('div')
    installWidths(scroller, 480, 200)
    installAnimations(scroller, 'finished')
    scroller.style.animationName = 'scroll-edge-fade-x'
    const applied = recordAnimationName(scroller)

    releaseFinishedScrollEdgeFade(scroller)

    expect(applied).toEqual([])
    expect(scroller.style.animationName).toBe('scroll-edge-fade-x')
  })

  it('leaves a fitting box alone when its timeline is not finished', () => {
    const scroller = document.createElement('div')
    installWidths(scroller, 200, 200)
    installAnimations(scroller, 'running')
    const applied = recordAnimationName(scroller)

    releaseFinishedScrollEdgeFade(scroller)

    expect(applied).toEqual([])
  })

  it('releases a box that stops overflowing after its content is removed', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const scroller = document.createElement('div')
    scroller.className = 'dv-tabs-container'
    const child = document.createElement('div')
    child.className = 'dv-tab'
    scroller.append(child)
    root.append(scroller)
    installWidths(scroller, 200, 200)
    installAnimations(scroller, 'finished')
    const fades = watchScrollEdgeFades(root, '.dv-tabs-container')
    stops.push(() => {
      fades.stop()
      root.remove()
    })

    const applied = recordAnimationName(scroller)
    fades.scan()
    expect(applied).toEqual(['none', ''])

    applied.length = 0
    installAnimations(scroller, 'finished')
    child.remove()
    await Promise.resolve()
    expect(applied).toEqual(['none', ''])
  })

  it('stops watching a box that has left the document', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const scroller = document.createElement('div')
    scroller.className = 'dv-tabs-container'
    root.append(scroller)
    installWidths(scroller, 200, 200)
    installAnimations(scroller, 'running')
    const fades = watchScrollEdgeFades(root, '.dv-tabs-container')
    stops.push(() => {
      fades.stop()
      root.remove()
    })
    fades.scan()
    scroller.remove()
    fades.scan()

    const applied = recordAnimationName(scroller)
    installAnimations(scroller, 'finished')
    scroller.append(document.createElement('div'))
    await Promise.resolve()
    expect(applied).toEqual([])
  })

  it('releases a table scroller that appears already finished and fitting', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const stop = bindScrollEdgeFades(root, '[data-streamdown="table-wrapper"] > div:has(> [data-streamdown="table"])')
    stops.push(() => {
      stop()
      root.remove()
    })

    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-streamdown', 'table-wrapper')
    const scroller = document.createElement('div')
    const table = document.createElement('table')
    table.setAttribute('data-streamdown', 'table')
    scroller.append(table)
    wrapper.append(scroller)
    installWidths(scroller, 200, 200)
    installAnimations(scroller, 'finished')
    const applied = recordAnimationName(scroller)
    root.append(wrapper)
    await Promise.resolve()

    expect(applied).toEqual(['none', ''])
  })
})
