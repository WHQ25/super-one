import { describe, expect, it } from 'vitest'
import {
  clampComputerPipLayout,
  computerPipAspect,
  computerPipCaptureSize,
  createDefaultComputerPipLayout,
} from './computer-pip-layout'

const CHAT = { left: 100, top: 50, width: 1000, height: 700 }
const ASPECT = 3 / 2

describe('Computer Use picture-in-picture layout', () => {
  it('starts at 200px wide in the top-right of the chat', () => {
    expect(createDefaultComputerPipLayout(CHAT, ASPECT)).toEqual({
      left: 888,
      top: 62,
      width: 200,
      height: 200 / ASPECT,
    })
  })

  it('allows user resizing down to 200px wide', () => {
    const layout = clampComputerPipLayout(
      { left: 500, top: 100, width: 80, height: 50 },
      CHAT,
      ASPECT,
    )

    expect(layout.width).toBe(200)
    expect(layout.height).toBeCloseTo(200 / ASPECT)
  })

  it('uses the captured desktop aspect ratio', () => {
    expect(computerPipAspect({ width: 1920, height: 1080 })).toBeCloseTo(16 / 9)
  })

  it('keeps the compact preview at least as sharp as the existing 480px stream', () => {
    expect(computerPipCaptureSize({ width: 200, height: 120 }, 2)).toEqual({
      width: 480,
      height: 288,
    })
  })

  it('uses Retina pixels and caps enlarged previews at 1440px', () => {
    expect(computerPipCaptureSize({ width: 800, height: 450 }, 2)).toEqual({
      width: 1440,
      height: 810,
    })
  })
})
