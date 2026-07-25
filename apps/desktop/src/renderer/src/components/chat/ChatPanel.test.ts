/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { anchorPosition, nearestAnchor, type ChatPanelBounds } from './ChatPanel'

describe('ChatPanel workspace anchors', () => {
  const bounds: ChatPanelBounds = { left: 280, top: 40, width: 1000, height: 700 }
  const panel = { width: 360, height: 580 }

  it.each([
    ['tl', { x: 288, y: 48 }],
    ['tm', { x: 600, y: 48 }],
    ['tr', { x: 912, y: 48 }],
    ['lm', { x: 288, y: 100 }],
    ['rm', { x: 912, y: 100 }],
    ['bl', { x: 288, y: 152 }],
    ['bm', { x: 600, y: 152 }],
    ['br', { x: 912, y: 152 }],
  ] as const)('positions %s relative to the main workspace', (anchor, expected) => {
    expect(anchorPosition(anchor, panel.width, panel.height, bounds)).toEqual(expected)
  })

  it('chooses anchors using workspace coordinates rather than the full viewport', () => {
    expect(nearestAnchor(300, 60, panel.width, panel.height, bounds)).toBe('tl')
    expect(nearestAnchor(1260, 720, panel.width, panel.height, bounds)).toBe('br')
  })
})
