import { describe, expect, it } from 'vitest'
import {
  clampComputerPipLayout,
  computerPipAspect,
  createDefaultComputerPipLayout,
} from './computer-pip-layout'

const CHAT = { left: 100, top: 50, width: 1000, height: 700 }
const ASPECT = 3 / 2

describe('Computer Use picture-in-picture layout', () => {
  it('starts at 180px wide in the top-right of the chat', () => {
    expect(createDefaultComputerPipLayout(CHAT, ASPECT)).toEqual({
      left: 908,
      top: 62,
      width: 180,
      height: 120,
    })
  })

  it('allows user resizing down to 160px wide', () => {
    const layout = clampComputerPipLayout(
      { left: 500, top: 100, width: 80, height: 50 },
      CHAT,
      ASPECT,
    )

    expect(layout.width).toBe(160)
    expect(layout.height).toBeCloseTo(160 / ASPECT)
  })

  it('uses the captured desktop aspect ratio', () => {
    expect(computerPipAspect({ width: 1920, height: 1080 })).toBeCloseTo(16 / 9)
  })
})
