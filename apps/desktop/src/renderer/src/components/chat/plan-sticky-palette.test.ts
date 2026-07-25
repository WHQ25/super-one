import { describe, expect, it } from 'vitest'
import {
  STICKY_PALETTE,
  stickyForComment,
  stickyForDraft,
  stickyForIndex,
} from './plan-sticky-palette'

describe('sticky palette', () => {
  it('has six Post-it colors', () => {
    expect(STICKY_PALETTE.map((s) => s.id)).toEqual([
      'canary',
      'pink',
      'papaya',
      'limeade',
      'aqua',
      'iris',
    ])
  })

  it('cycles by index', () => {
    expect(stickyForIndex(0).id).toBe('canary')
    expect(stickyForIndex(1).id).toBe('pink')
    expect(stickyForIndex(6).id).toBe('canary')
  })

  it('assigns by comment order', () => {
    const comments = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(stickyForComment('a', comments).id).toBe('canary')
    expect(stickyForComment('b', comments).id).toBe('pink')
    expect(stickyForComment('c', comments).id).toBe('papaya')
  })

  it('draft uses next slot after existing comments', () => {
    expect(stickyForDraft(0).id).toBe('canary')
    expect(stickyForDraft(2).id).toBe('papaya')
  })

  it('pairs every paper with distinct light and dark marker inks', () => {
    for (const s of STICKY_PALETTE) {
      expect(s.paper.top).toMatch(/^#[0-9a-f]{6}$/i)
      expect(s.paper.back).toMatch(/^#[0-9a-f]{6}$/i)
      // dark ink must be its own (dark) value — screen blend would neon otherwise
      expect(s.markerDark.base).not.toBe(s.marker.base)
      // "deep" = more ink than "base", in both themes
      expect(s.marker.deep).not.toBe(s.marker.base)
      expect(s.markerDark.deep).not.toBe(s.markerDark.base)
    }
  })
})
