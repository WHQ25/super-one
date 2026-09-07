import { describe, expect, it } from 'vitest'
import { isIosSimulatorTextTypeable, splitIosSimulatorText } from './ios-simulator'

describe('splitIosSimulatorText', () => {
  it('sends plain text as one insertion, whatever its length or script', () => {
    // The rule this replaced routed by length and charset: eight ASCII characters or
    // fewer went out as HID usage codes, which is the one channel the guest's input
    // method sits on. With Pinyin selected `check` reached the composer and landed as
    // `chee c k`, while Chinese — which HID cannot spell — was always correct. That
    // was never a property of the text.
    expect(splitIosSimulatorText('check')).toEqual([{ kind: 'insert', text: 'check' }])
    expect(splitIosSimulatorText('你好')).toEqual([{ kind: 'insert', text: '你好' }])
    expect(splitIosSimulatorText('the quick brown fox'))
      .toEqual([{ kind: 'insert', text: 'the quick brown fox' }])
  })

  it('splits control characters out so they stay keystrokes', () => {
    // Written into a value a Return is a newline character and the app's submit
    // handler never runs, so these keep going out as keys.
    expect(splitIosSimulatorText('hi\nthere')).toEqual([
      { kind: 'insert', text: 'hi' },
      { kind: 'key', text: '\n' },
      { kind: 'insert', text: 'there' },
    ])
  })

  it('carries a trailing Return, which is the common shape', () => {
    expect(splitIosSimulatorText('query\n')).toEqual([
      { kind: 'insert', text: 'query' },
      { kind: 'key', text: '\n' },
    ])
  })

  it('treats each keystroke character as its own key', () => {
    expect(splitIosSimulatorText('\b\t\r\u007f').map((segment) => segment.kind))
      .toEqual(['key', 'key', 'key', 'key'])
  })

  it('has nothing to deliver for an empty string', () => {
    expect(splitIosSimulatorText('')).toEqual([])
  })

  it('keeps an emoji whole rather than splitting its surrogate pair', () => {
    expect(splitIosSimulatorText('🎉')).toEqual([{ kind: 'insert', text: '🎉' }])
  })
})

describe('isIosSimulatorTextTypeable', () => {
  it('answers whether the HID fallback could carry this at all', () => {
    // The only remaining use: the keyboard is a fallback for controls that refuse to
    // be written to, and it still cannot spell anything outside its usage table.
    expect(isIosSimulatorTextTypeable('long-password')).toBe(true)
    expect(isIosSimulatorTextTypeable('你好')).toBe(false)
  })
})
