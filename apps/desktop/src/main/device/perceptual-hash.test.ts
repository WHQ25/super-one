import { describe, expect, it } from 'vitest'
import { frameHashDistance, frameHashesMatch } from './perceptual-hash'

describe('framebuffer hash comparison', () => {
  it('reports no distance between identical captures', () => {
    expect(frameHashDistance('7141414d45554555', '7141414d45554555')).toBe(0)
  })

  it('counts differing bits, not differing characters', () => {
    // 0x…4 vs 0x…5 is one bit, though it is also one character.
    expect(frameHashDistance('0000000000000004', '0000000000000005')).toBe(1)
    // 0x…0f vs 0x…f0 is eight bits across two characters.
    expect(frameHashDistance('000000000000000f', '00000000000000f0')).toBe(8)
  })

  it('measures the two landscape screens the device actually produced as far apart', () => {
    // Captured from a booted iPhone 17 Pro Max while rotating Safari.
    expect(frameHashDistance('9115159595959595', '7656574656575656')).toBeGreaterThan(3)
  })

  it('treats a capture that drifted by a bit or two as the same picture', () => {
    expect(frameHashesMatch('7141414d45554555', '7141414d45554551')).toBe(true)
  })

  /**
   * Captured on a booted device: consecutive 150ms samples through an iOS
   * bounce-back moved about three bits each. This is the case that set the
   * tolerance -- anything looser reported the screen as still while it was visibly
   * decelerating, and a settle that lies is worse than one that waits.
   */
  it('calls a screen mid-animation different, at the rate a real bounce-back moves', () => {
    expect(frameHashDistance('714d554545554555', '7141454545554555')).toBe(3)
    expect(frameHashesMatch('714d554545554555', '7141454545554555')).toBe(false)
  })

  it('treats a screen that changed as changed', () => {
    expect(frameHashesMatch('7141414d45554555', '9115159595959595')).toBe(false)
  })

  it('refuses to call a missing hash a match, so an unreadable framebuffer is not read as "nothing happened"', () => {
    expect(frameHashesMatch(undefined, '7141414d45554555')).toBe(false)
    expect(frameHashesMatch('7141414d45554555', undefined)).toBe(false)
    expect(frameHashesMatch(undefined, undefined)).toBe(false)
  })

  it('treats an unparseable hash as maximally different', () => {
    expect(frameHashDistance('not-a-hash', '7141414d45554555')).toBe(64)
    expect(frameHashesMatch('not-a-hash', '7141414d45554555')).toBe(false)
  })
})
