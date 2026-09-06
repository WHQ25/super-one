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

  it('retains a translucent resting background veil with motion disabled', () => {
    const veil = motionTracks(data.motions['codex-session-veil'], 20)[0]!
    expect(veil.outputRange[0]).toBe(0.7)
    expect(veil.outputRange.every((value) => value < 1)).toBe(true)
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
