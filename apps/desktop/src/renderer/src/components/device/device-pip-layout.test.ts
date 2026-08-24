import { describe, expect, it } from 'vitest'
import type { IosSimulatorChrome } from '@superone/shared/ios-simulator'
import {
  clampDevicePipLayout,
  createDefaultDevicePipLayout,
  devicePipAspect,
  DEVICE_PIP_ASPECT,
} from './device-pip-layout'

const CHAT = { left: 0, top: 0, width: 900, height: 700 }

/**
 * Apple's real numbers for an iPhone 17 Pro Max, read off the shipped assets:
 * a 1320x2868 @3x screen is 440x956pt, `images.sizing` frames it with 18pt on every
 * side, and `devicePadding` adds the 9pt the side buttons stick out into. So the body
 * is 476x992pt inside a 494x992pt drawing area — visibly wider in ratio than the glass.
 */
const IPHONE_17_PRO_MAX_CHROME: IosSimulatorChrome = {
  identifier: 'com.apple.dt.devicekit.chrome.phone12',
  slices: {
    topLeft: 'tl.png', top: 't.png', topRight: 'tr.png', right: 'r.png',
    bottomRight: 'br.png', bottom: 'b.png', bottomLeft: 'bl.png', left: 'l.png',
  },
  corner: 80,
  screenMask: 'data:image/png;base64,AA==',
  width: 476,
  height: 992,
  padding: { top: 0, left: 9, bottom: 0, right: 9 },
  screen: { x: 18, y: 18, width: 440, height: 956 },
  buttons: [],
}

const SCREEN = { width: 1320, height: 2868 }

describe('ios simulator pip layout', () => {
  it('opens portrait in the top-right corner, inside the chat', () => {
    const layout = createDefaultDevicePipLayout(CHAT)

    expect(layout.width).toBe(180)
    expect(layout.width / layout.height).toBeCloseTo(DEVICE_PIP_ASPECT, 5)
    expect(layout.left + layout.width).toBeLessThanOrEqual(CHAT.width)
    expect(layout.top).toBeGreaterThanOrEqual(0)
    expect(layout.top + layout.height).toBeLessThanOrEqual(CHAT.height)
  })

  it('keeps the phone aspect instead of widening when dragged past the edge', () => {
    const start = createDefaultDevicePipLayout(CHAT)
    const shoved = clampDevicePipLayout({ ...start, left: 5_000, top: 5_000 }, CHAT)

    expect(shoved.width / shoved.height).toBeCloseTo(DEVICE_PIP_ASPECT, 5)
    expect(shoved.left + shoved.width).toBeLessThanOrEqual(CHAT.width)
    expect(shoved.top + shoved.height).toBeLessThanOrEqual(CHAT.height)
  })

  it('allows user resizing down to 160px wide', () => {
    const start = createDefaultDevicePipLayout(CHAT)
    const layout = clampDevicePipLayout({ ...start, width: 80 }, CHAT)

    expect(layout.width).toBe(160)
    expect(layout.width / layout.height).toBeCloseTo(DEVICE_PIP_ASPECT, 5)
  })

  it('fits a portrait box into a chat too short for the default height', () => {
    // The browser preview's 280px width floor would demand 560px of height here and
    // get clamped into a shape no phone has. The phone floor has to survive this.
    const shortChat = { left: 0, top: 0, width: 900, height: 320 }
    const layout = createDefaultDevicePipLayout(shortChat)

    expect(layout.height).toBeLessThanOrEqual(shortChat.height)
    expect(layout.width / layout.height).toBeCloseTo(DEVICE_PIP_ASPECT, 5)
  })

  it('takes the box from the device the caller measured', () => {
    const aspect = devicePipAspect({ width: 1320, height: 2868 })
    const layout = createDefaultDevicePipLayout(CHAT, aspect)

    expect(layout.width / layout.height).toBeCloseTo(1320 / 2868, 5)
  })

  it('falls back to a phone when the device has not reported its framebuffer', () => {
    expect(devicePipAspect(null)).toBe(DEVICE_PIP_ASPECT)
    expect(devicePipAspect({ width: 0, height: 0 })).toBe(DEVICE_PIP_ASPECT)
  })

  it('takes the box from the device body, not the glass inside it', () => {
    // The regression: sizing the box off the framebuffer left the artwork fitting to
    // width and floating in ~8% of dead height, which read as a top margin twice the
    // size of the side one — 30px against 16px at the default width.
    const aspect = devicePipAspect(SCREEN, IPHONE_17_PRO_MAX_CHROME)

    expect(aspect).toBeCloseTo(494 / 992, 5)
    expect(aspect).not.toBeCloseTo(1320 / 2868, 3)
  })

  it('turns the body with the device', () => {
    const landscape = devicePipAspect(
      { width: SCREEN.height, height: SCREEN.width },
      IPHONE_17_PRO_MAX_CHROME,
    )

    expect(landscape).toBeCloseTo(992 / 494, 5)
  })

  it('falls back to the glass for a model that ships no artwork', () => {
    // Every iPad, every Apple TV, iPhone 11-14, SE. `DeviceBareScreen` draws the
    // screen and nothing else there, so the framebuffer's own shape is exactly right.
    expect(devicePipAspect(SCREEN, null)).toBeCloseTo(1320 / 2868, 5)
    expect(devicePipAspect(SCREEN)).toBeCloseTo(1320 / 2868, 5)
  })

  it('lays a turned device down inside the chat instead of overflowing it', () => {
    // The caller swaps the framebuffer for a landscape guest; what matters here is
    // that the wide box is refitted rather than keeping the portrait height.
    const landscape = devicePipAspect({ width: 2868, height: 1320 })
    const portrait = createDefaultDevicePipLayout(CHAT)
    const turned = clampDevicePipLayout(portrait, CHAT, landscape)

    expect(turned.width / turned.height).toBeCloseTo(2868 / 1320, 5)
    expect(turned.left + turned.width).toBeLessThanOrEqual(CHAT.width)
    expect(turned.top + turned.height).toBeLessThanOrEqual(CHAT.height)
  })
})
