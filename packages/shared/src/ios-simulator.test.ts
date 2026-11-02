import { describe, expect, it } from 'vitest'
import {
  IOS_SIMULATOR_FOLD_MAX_DEGREES,
  IOS_SIMULATOR_LAPTOP_MIN_DEGREES,
  IOS_SIMULATOR_TENT_MAX_DEGREES,
  iosSimulatorFoldAt,
  iosSimulatorFoldForm,
  iosSimulatorFoldPanel,
  iosSimulatorFoldPosture,
  iosSimulatorFoldPostureOf,
  isIosSimulatorTextTypeable,
  splitIosSimulatorText,
} from './ios-simulator'

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

describe('iosSimulatorFoldForm', () => {
  it('keeps the whole-degree cuts on one boundary each', () => {
    expect(IOS_SIMULATOR_FOLD_MAX_DEGREES + 1).toBe(31)
    expect(IOS_SIMULATOR_TENT_MAX_DEGREES).toBe(60)
    expect(IOS_SIMULATOR_LAPTOP_MIN_DEGREES).toBe(81)
    expect(IOS_SIMULATOR_TENT_MAX_DEGREES + 1).toBeLessThan(IOS_SIMULATOR_LAPTOP_MIN_DEGREES)
  })

  it('reads 0-30 as fold, 31-60 as tent, 61-80 and 121-180 as open, and 81-120 as laptop', () => {
    const form = (degrees: number) => iosSimulatorFoldForm(degrees)
    expect(form(0)).toBe('closed')
    expect(form(30)).toBe('closed')
    expect(form(30.9)).toBe('closed')
    expect(form(31)).toBe('tent')
    expect(form(60)).toBe('tent')
    expect(form(60.9)).toBe('tent')
    expect(form(61)).toBe('open')
    expect(form(80)).toBe('open')
    expect(form(80.9)).toBe('open')
    expect(form(81)).toBe('laptop')
    expect(form(120)).toBe('laptop')
    expect(form(120.1)).toBe('open')
    expect(form(180)).toBe('open')
  })

  it('lights the cover for a fold and a tent, and the inner panel for a laptop and a book', () => {
    const panel = (degrees: number) => iosSimulatorFoldPanel(iosSimulatorFoldAt(degrees)!)
    expect(panel(15)).toBe('cover')
    expect(panel(30)).toBe('cover')
    expect(panel(55)).toBe('cover')
    expect(panel(70)).toBe('inner')
    expect(panel(100)).toBe('inner')
    expect(panel(150)).toBe('inner')
  })

  it('names a part-open book half opened, and a fold closed, from the angle alone', () => {
    expect(iosSimulatorFoldPosture('half-opened').hingeDegrees).toBe(150)
    expect(iosSimulatorFoldPostureOf(iosSimulatorFoldAt(15)!).posture).toBe('closed')
    expect(iosSimulatorFoldPostureOf(iosSimulatorFoldAt(30)!).posture).toBe('closed')
    expect(iosSimulatorFoldPostureOf(iosSimulatorFoldAt(45)!).posture).toBe('tent')
    expect(iosSimulatorFoldPostureOf(iosSimulatorFoldAt(70)!).posture).toBe('half-opened')
    expect(iosSimulatorFoldPostureOf(iosSimulatorFoldAt(90)!).posture).toBe('laptop')
    expect(iosSimulatorFoldPostureOf(iosSimulatorFoldAt(150)!).posture).toBe('half-opened')
    expect(iosSimulatorFoldPostureOf(iosSimulatorFoldAt(180)!).posture).toBe('opened')
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
