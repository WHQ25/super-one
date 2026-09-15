import { describe, expect, it } from 'vitest'
import { motionTracks, motionTransforms } from './harness-motion'
import data from './harness-scenes.generated.json'

describe('desktop animation translation', () => {
  it('preserves relative jumping and rotation without rotating the Codex glyph', () => {
    expect(motionTransforms('translate(-12%, -22%) rotate(-6deg)', 50)).toEqual({ translateX: -6, translateY: -11, rotate: -6 })
    expect(motionTransforms('translate(2px, -2px)', 64)).toEqual({ translateX: 2, translateY: -2 })
    const scene = data.scenes.codex.running.compact
    expect(JSON.stringify(scene.children[0])).toContain('codex-session-rotate')
    expect(JSON.stringify(scene.children[1])).not.toContain('codex-session-rotate')
  })

  it('holds step-end cursors rather than fading between keyframes', () => {
    const track = motionTracks(data.motions['codex-session-cursor'], 20)[0]!
    const beforeOff = track.inputRange.findIndex((value) => value > 0.49 && value < 0.5)
    const off = track.inputRange.indexOf(0.5)
    expect(track.outputRange[beforeOff]).toBe(1)
    expect(track.outputRange[off]).toBe(0)
  })

  it('carries no background veil, matching the desktop Codex icon', () => {
    // The desktop dropped the veil because it only composited correctly on one
    // row colour; the generated scenes must follow the source, not a stale copy.
    expect(data.motions).not.toHaveProperty('codex-session-veil')
    expect(JSON.stringify(data.scenes.codex.background)).not.toContain('veil')
  })

  it('omits decorative continuous motion from compact resting icons', () => {
    for (const brand of ['claude', 'codex'] as const) {
      const compact = JSON.stringify(data.scenes[brand].default.compact)
      expect(compact).not.toContain('claude-session-float')
      expect(compact).not.toContain('claude-session-leg-left')
      expect(compact).not.toContain('codex-session-scale')
      expect(compact).not.toContain('codex-session-warm')
    }
  })
})
