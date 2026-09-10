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
  })
})
