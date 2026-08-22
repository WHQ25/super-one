import { describe, expect, it } from 'vitest'
import type { MirrorText } from './mirror-helper'
import { mirrorNodeCentre, mirrorTextToTree } from './mirror-tree'

const text = (over: Partial<MirrorText> = {}): MirrorText => ({
  text: 'Sign in',
  confidence: 0.9,
  x: 100,
  y: 200,
  width: 200,
  height: 40,
  ...over,
})

/** A 2x Retina capture of a 344x764pt window — the real shape on this machine. */
const CAPTURE = { width: 688, height: 1528 }

describe('mirror text as a screen tree', () => {
  it('normalizes pixel boxes against the CAPTURE, not the window in points', () => {
    // The trap this pins down: dividing by the window's point size on a Retina Mac
    // halves every coordinate, so the whole screen collapses into its top-left
    // quadrant and every tap lands high and left of the thing it named.
    const root = mirrorTextToTree([text()], CAPTURE)
    expect(root.children?.[0]?.bounds).toEqual([
      100 / 688,
      200 / 1528,
      200 / 688,
      40 / 1528,
    ])
  })

  it('marks every node as read off the pixels', () => {
    const root = mirrorTextToTree([text()], CAPTURE)
    // Not decoration: `press` refuses `source: 'ocr'`, because there is no
    // accessibility element behind one to press.
    expect(root.source).toBe('ocr')
    expect(root.children?.[0]).toMatchObject({ role: 'text', label: 'Sign in', source: 'ocr' })
  })

  it('does not rotate, unlike the simulator', () => {
    // macOS re-shapes the mirroring window when the phone turns, so a landscape phone
    // arrives as a landscape capture that is ALREADY upright. Applying the
    // simulator's quarter-turn here would put every box 90 degrees out.
    const landscape = { width: 1528, height: 688 }
    const root = mirrorTextToTree([text({ x: 0, y: 0, width: 764, height: 344 })], landscape)
    expect(root.children?.[0]?.bounds).toEqual([0, 0, 0.5, 0.5])
  })

  it('drops blank and zero-area recognitions without calling them truncation', () => {
    const root = mirrorTextToTree(
      [text({ text: '   ' }), text({ width: 0 }), text({ text: 'Keep me' })],
      CAPTURE,
    )
    expect(root.children).toHaveLength(1)
    expect(root.truncatedChildren).toBeUndefined()
  })

  it('reports the overflow when the node budget cuts the screen short', () => {
    const lines = Array.from({ length: 12 }, (_, index) => text({ text: `Row ${index}` }))
    const root = mirrorTextToTree(lines, CAPTURE, 5)
    // Four children plus the root, matching what an accessibility dump would count.
    expect(root.children).toHaveLength(4)
    expect(root.truncatedChildren).toBe(8)
  })

  it('survives a capture with no area rather than dividing by zero', () => {
    const root = mirrorTextToTree([text()], { width: 0, height: 0 })
    expect(root.children).toBeUndefined()
  })
})

describe('tapping an OCR node', () => {
  it('aims at the centre of the box its text was found in', () => {
    const root = mirrorTextToTree([text()], CAPTURE)
    const centre = mirrorNodeCentre(root.children![0]!, CAPTURE)!
    // Close, not exact: the box went to normalized and back, and a sub-pixel round
    // trip is not a defect — the tap lands in the same pixel either way.
    expect(centre.x).toBeCloseTo(200, 6)
    expect(centre.y).toBeCloseTo(220, 6)
  })

  it('refuses a node with no box', () => {
    expect(mirrorNodeCentre({ ref: '@e1', role: 'text' }, CAPTURE)).toBeNull()
  })
})
