import { describe, expect, it } from 'vitest'
import type { IosSimulatorChrome, IosSimulatorChromeButton } from '@superone/shared/ios-simulator'
import {
  iosSimulatorBodyCenter,
  iosSimulatorBodySlices,
  iosSimulatorButtonRect,
  iosSimulatorOuterBox,
} from './ios-simulator-chrome-layout'

// Apple's phone11 geometry, which the iPhone 17 Pro uses.
const CHROME: IosSimulatorChrome = {
  identifier: 'com.apple.dt.devicekit.chrome.phone11',
  slices: {
    topLeft: 'tl', top: 't', topRight: 'tr', right: 'r',
    bottomRight: 'br', bottom: 'b', bottomLeft: 'bl', left: 'l',
  },
  corner: 110,
  screenMask: 'mask',
  width: 438,
  height: 910,
  padding: { top: 0, left: 13, bottom: 0, right: 13 },
  screen: { x: 18, y: 18, width: 402, height: 874 },
  buttons: [],
}

function button(overrides: Partial<IosSimulatorChromeButton>): IosSimulatorChromeButton {
  return {
    name: 'volume-up',
    title: 'Volume Up',
    anchor: 'left',
    offset: { across: 8, along: 221 },
    hoverOffset: { across: 3, along: 221 },
    width: 16,
    height: 64,
    image: 'img',
    ...overrides,
  }
}

describe('iosSimulatorOuterBox', () => {
  it('reserves the margin the buttons stick out into', () => {
    expect(iosSimulatorOuterBox(CHROME)).toEqual({ width: 464, height: 910 })
  })
})

describe('iosSimulatorButtonRect', () => {
  it('straddles the edge so half the button hides under the body', () => {
    const rect = iosSimulatorButtonRect(CHROME, button({}))

    // Device left edge sits at x=13 in the outer box, and 8 of the button's 16
    // points are inside it, so the other 8 hang out to x=5.
    expect(rect).toEqual({ x: 5, y: 221, width: 16, height: 64 })
  })

  it('slides further out while hovered instead of moving along the edge', () => {
    const rest = iosSimulatorButtonRect(CHROME, button({}))
    const hover = iosSimulatorButtonRect(CHROME, button({}), true)

    // Apple's rollover offset counts down, which slides the button further out.
    expect(hover.x).toBe(rest.x - 5)
    expect(hover.y).toBe(rest.y)
  })

  it('mirrors a right-anchored button onto the other edge', () => {
    const rect = iosSimulatorButtonRect(CHROME, button({ anchor: 'right', height: 101 }))

    // Device right edge is at 13 + 438 = 451, and the far edge is 8pt past it.
    expect(rect.x + rect.width).toBe(459)
  })

  it('measures a negative along-offset from the far end of the edge', () => {
    // How an iPad's top button stays by the right corner on every model width.
    const rect = iosSimulatorButtonRect(
      CHROME,
      button({ anchor: 'top', width: 63, height: 16, offset: { across: 8, along: -74 }, hoverOffset: { across: 3, along: -74 } }),
    )

    expect(rect.x + rect.width).toBe(13 + 438 - 74)
    // 8 of its 16 points sit inside the top edge, so it reaches 8pt above the body.
    expect(rect.y).toBe(-8)
  })
})

describe('iosSimulatorBodySlices', () => {
  const slices = iosSimulatorBodySlices(CHROME)

  it('lays the eight edges out inside the padded box with no gaps', () => {
    const byKey = Object.fromEntries(slices.map((piece) => [piece.key, piece.rect]))

    expect(byKey.topLeft).toEqual({ x: 13, y: 0, width: 110, height: 110 })
    expect(byKey.top).toEqual({ x: 123, y: 0, width: 218, height: 110 })
    expect(byKey.topRight).toEqual({ x: 341, y: 0, width: 110, height: 110 })
    expect(byKey.bottomRight).toEqual({ x: 341, y: 800, width: 110, height: 110 })
    // The right edge starts where the top-right corner ends and stops at the bottom one.
    expect(byKey.right).toEqual({ x: 341, y: 110, width: 110, height: 690 })
  })

  it('never produces a negative edge on a device smaller than two corners', () => {
    const tiny = iosSimulatorBodySlices({ ...CHROME, width: 120, height: 120, corner: 110 })

    for (const piece of tiny) {
      expect(piece.rect.width).toBeGreaterThanOrEqual(0)
      expect(piece.rect.height).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('iosSimulatorBodyCenter', () => {
  it('covers exactly what the slices leave bare, and stays inside the screen', () => {
    const center = iosSimulatorBodyCenter(CHROME)

    expect(center).toEqual({ x: 123, y: 110, width: 218, height: 690 })
    // Every corner is thicker than the frame around the screen, so the bare area is
    // always hidden behind the framebuffer once frames start arriving.
    expect(center.x).toBeGreaterThanOrEqual(CHROME.padding.left + CHROME.screen.x)
    expect(center.y).toBeGreaterThanOrEqual(CHROME.padding.top + CHROME.screen.y)
  })
})
