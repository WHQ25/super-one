import { describe, expect, test } from 'vitest'
import { shouldAllowLandscape } from './orientation-policy'

describe('shouldAllowLandscape', () => {
  test('locks a regular phone to portrait regardless of current orientation', () => {
    expect(shouldAllowLandscape({ width: 384, height: 853 })).toBe(false)
    expect(shouldAllowLandscape({ width: 853, height: 384 })).toBe(false)
  })

  test('allows landscape on tablets and unfolded foldables', () => {
    expect(shouldAllowLandscape({ width: 820, height: 1180 })).toBe(true)
    expect(shouldAllowLandscape({ width: 673, height: 841 })).toBe(true)
  })

  test('a folded foldable cover screen stays portrait', () => {
    expect(shouldAllowLandscape({ width: 373, height: 904 })).toBe(false)
    expect(shouldAllowLandscape({ width: 466, height: 678 }, false, 'closed')).toBe(false)
    // The close can be reported before the window shrinks back to the cover.
    expect(shouldAllowLandscape({ width: 669, height: 951 }, false, 'closed')).toBe(false)
  })

  test('a Duo that is not folded drops the portrait lock before the window grows', () => {
    const cover = { width: 466, height: 678 }
    expect(shouldAllowLandscape(cover, false, 'partial')).toBe(true)
    expect(shouldAllowLandscape(cover, false, 'flat')).toBe(true)
    expect(shouldAllowLandscape(cover, false, 'unknown')).toBe(false)
  })

  test('file preview unlocks a closed Duo cover', () => {
    expect(shouldAllowLandscape({ width: 466, height: 678 }, true, 'closed')).toBe(true)
  })

  test('file preview unlocks landscape on a phone', () => {
    expect(shouldAllowLandscape({ width: 384, height: 853 }, true)).toBe(true)
    expect(shouldAllowLandscape({ width: 853, height: 384 }, true)).toBe(true)
  })

  test('closing file preview restores the phone portrait lock', () => {
    expect(shouldAllowLandscape({ width: 384, height: 853 }, false)).toBe(false)
  })
})
