/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { releaseFinishedScrollEdgeFade, watchTabStrips } from './tab-strip-edge-fade'

function installAnimations(strip: HTMLElement, playState: AnimationPlayState | null) {
  strip.getAnimations = () => (playState ? [{ playState } as Animation] : [])
}

function installWidths(strip: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(strip, 'scrollWidth', { configurable: true, get: () => scrollWidth })
  Object.defineProperty(strip, 'clientWidth', { configurable: true, get: () => clientWidth })
}

/** jsdom's `animationName` setter does not go through the instance's `setProperty`. */
function recordAnimationName(strip: HTMLElement): string[] {
  const applied: string[] = []
  let name = strip.style.animationName
  Object.defineProperty(strip.style, 'animationName', {
    configurable: true,
    get: () => name,
    set: (value: string) => {
      applied.push(value)
      name = value
    },
  })
  return applied
}

describe('tab strip edge fade', () => {
  const stops: Array<() => void> = []
  afterEach(() => {
    while (stops.length) stops.pop()?.()
  })

  it('restarts a finished scroll timeline once the strip fits, clearing the leading fade', () => {
    const strip = document.createElement('div')
    installWidths(strip, 200, 200)
    installAnimations(strip, 'finished')
    const applied = recordAnimationName(strip)

    releaseFinishedScrollEdgeFade(strip)

    expect(applied).toEqual(['none', ''])
    expect(strip.style.animationName).toBe('')
  })

  it('keeps the fade while tabs still overflow past the strip', () => {
    const strip = document.createElement('div')
    installWidths(strip, 480, 200)
    installAnimations(strip, 'finished')
    strip.style.animationName = 'scroll-edge-fade-x'
    const applied = recordAnimationName(strip)

    releaseFinishedScrollEdgeFade(strip)

    expect(applied).toEqual([])
    expect(strip.style.animationName).toBe('scroll-edge-fade-x')
  })

  it('leaves a fitting strip alone when its timeline is not finished', () => {
    const strip = document.createElement('div')
    installWidths(strip, 200, 200)
    installAnimations(strip, 'running')
    const applied = recordAnimationName(strip)

    releaseFinishedScrollEdgeFade(strip)

    expect(applied).toEqual([])
  })

  it('releases a strip that stops overflowing after a tab is removed', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const strip = document.createElement('div')
    strip.className = 'dv-tabs-container'
    const tab = document.createElement('div')
    tab.className = 'dv-tab'
    strip.append(tab)
    root.append(strip)
    installWidths(strip, 200, 200)
    installAnimations(strip, 'finished')
    const edgeFades = watchTabStrips(root)
    stops.push(() => {
      edgeFades.stop()
      root.remove()
    })

    const applied = recordAnimationName(strip)
    // Already finished and fitting when the strip is found.
    edgeFades.scan()
    expect(applied).toEqual(['none', ''])

    applied.length = 0
    installAnimations(strip, 'finished')
    tab.remove()
    await Promise.resolve()
    expect(applied).toEqual(['none', ''])
  })

  it('stops watching a strip that has left the document', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const strip = document.createElement('div')
    strip.className = 'dv-tabs-container'
    root.append(strip)
    installWidths(strip, 200, 200)
    installAnimations(strip, 'running')
    const edgeFades = watchTabStrips(root)
    stops.push(() => {
      edgeFades.stop()
      root.remove()
    })
    edgeFades.scan()
    strip.remove()
    edgeFades.scan()

    const applied = recordAnimationName(strip)
    installAnimations(strip, 'finished')
    strip.append(document.createElement('div'))
    await Promise.resolve()
    expect(applied).toEqual([])
  })
})
