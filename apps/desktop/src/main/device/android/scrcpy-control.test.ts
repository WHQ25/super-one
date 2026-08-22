import { describe, expect, it } from 'vitest'
import type { TouchStep } from '../gesture-synth'
import {
  encodeBare,
  encodeCancelTouches,
  encodeKeyPress,
  encodeKeycode,
  encodePressure,
  encodeSetClipboard,
  encodeText,
  encodeTextInput,
  encodeTouch,
  encodeTouchStep,
  KEYCODE,
  MOTION,
  SCRCPY_MSG,
} from './scrcpy-control'

const SCREEN = { width: 1080, height: 2400 }

describe('encodeTouch', () => {
  it('lays the fields out exactly as the server deserializes them', () => {
    const message = encodeTouch({
      action: MOTION.DOWN,
      pointerId: 1,
      target: { xRatio: 0.5, yRatio: 0.25, ...SCREEN },
    })

    expect(message).toHaveLength(32)
    expect(message.readUInt8(0)).toBe(SCRCPY_MSG.INJECT_TOUCH_EVENT)
    expect(message.readUInt8(1)).toBe(MOTION.DOWN)
    expect(message.readBigInt64BE(2)).toBe(1n)
    expect(message.readInt32BE(10)).toBe(540)
    expect(message.readInt32BE(14)).toBe(600)
    expect(message.readUInt16BE(18)).toBe(1080)
    expect(message.readUInt16BE(20)).toBe(2400)
    expect(message.readUInt16BE(22)).toBe(0xffff)
    expect(message.readInt32BE(24)).toBe(0)
    expect(message.readInt32BE(28)).toBe(0)
  })

  it('sends the screen size along, which is what lets ratios go out unconverted', () => {
    // The server rescales against the size the client claims, so this end never has to
    // learn the real resolution — and ratios survive the mid-stream rotation Android
    // does, where a pixel coordinate would not.
    const message = encodeTouch({
      action: MOTION.DOWN,
      pointerId: 1,
      target: { xRatio: 1, yRatio: 1, width: 800, height: 360 },
    })
    expect([message.readInt32BE(10), message.readInt32BE(14)]).toEqual([800, 360])
    expect([message.readUInt16BE(18), message.readUInt16BE(20)]).toEqual([800, 360])
  })

  it('reports no pressure when a finger lifts', () => {
    // A full-pressure UP has been observed to read as a second press on some input
    // stacks — a tap that registers twice, which is worse than one that misses.
    const message = encodeTouch({
      action: MOTION.UP,
      pointerId: 1,
      target: { xRatio: 0.5, yRatio: 0.5, ...SCREEN },
    })
    expect(message.readUInt16BE(22)).toBe(0)
  })

  it('keeps a target outside the screen on the screen', () => {
    const message = encodeTouch({
      action: MOTION.MOVE,
      pointerId: 1,
      target: { xRatio: 2, yRatio: -1, ...SCREEN },
    })
    expect([message.readInt32BE(10), message.readInt32BE(14)]).toEqual([1080, 0])
  })

  it('distinguishes contacts by pointer id, which is how multi-touch is expressed', () => {
    const second = encodeTouch({
      action: MOTION.DOWN,
      pointerId: 2,
      target: { xRatio: 0.5, yRatio: 0.5, ...SCREEN },
    })
    expect(second.readBigInt64BE(2)).toBe(2n)
  })
})

describe('encodePressure', () => {
  it('sends full pressure as every bit set', () => {
    // Not `value * 0x10000`: that overflows to 0 for 1.0, which the device reads as a
    // finger resting weightlessly on the glass and ignores.
    expect(encodePressure(1)).toBe(0xffff)
  })

  it('clamps rather than wrapping', () => {
    expect(encodePressure(2)).toBe(0xffff)
    expect(encodePressure(-1)).toBe(0)
  })

  it('scales the middle of the range', () => {
    expect(encodePressure(0.5)).toBe(0x8000)
  })
})

describe('encodeKeycode', () => {
  it('lays out the 14 bytes the server expects', () => {
    const message = encodeKeycode({ keycode: KEYCODE.back! })
    expect(message).toHaveLength(14)
    expect(message.readUInt8(0)).toBe(SCRCPY_MSG.INJECT_KEYCODE)
    expect(message.readInt32BE(2)).toBe(4)
  })

  it('sends a press as a down AND an up', () => {
    // A device that only ever sees DOWN holds the key forever — back becomes an
    // infinite repeat rather than one navigation.
    const [down, up] = encodeKeyPress(KEYCODE.home!)
    expect(down!.readUInt8(1)).toBe(0)
    expect(up!.readUInt8(1)).toBe(1)
  })

  it('knows the Android-only navigation keys', () => {
    expect(KEYCODE.back).toBe(4)
    expect(KEYCODE['app-switch']).toBe(187)
  })

  it('maps both iOS side-button names onto the one Android has', () => {
    expect(KEYCODE.lock).toBe(KEYCODE.side)
  })
})

describe('encodeText', () => {
  it('length-prefixes UTF-8', () => {
    const message = encodeText('hi')
    expect(message.readUInt8(0)).toBe(SCRCPY_MSG.INJECT_TEXT)
    expect(message.readUInt32BE(1)).toBe(2)
    expect(message.subarray(5).toString('utf8')).toBe('hi')
  })

  it('counts bytes, not characters', () => {
    expect(encodeText('中').readUInt32BE(1)).toBe(3)
  })
})

describe('encodeSetClipboard', () => {
  it('lays out sequence, paste flag and a 4-byte length', () => {
    const message = encodeSetClipboard('中', true)
    expect(message).toHaveLength(14 + 3)
    expect(message.readUInt8(0)).toBe(SCRCPY_MSG.SET_CLIPBOARD)
    expect(message.readBigInt64BE(1)).toBe(0n)
    expect(message.readUInt8(9)).toBe(1)
    expect(message.readUInt32BE(10)).toBe(3)
    expect(message.subarray(14).toString('utf8')).toBe('中')
  })

  it('asks for no acknowledgement, because nothing reads the socket back', () => {
    expect(encodeSetClipboard('hi', false).readBigInt64BE(1)).toBe(0n)
  })
})

describe('encodeTextInput', () => {
  it('sends printable ASCII on the text channel', () => {
    const [message, ...rest] = encodeTextInput('hello')
    expect(rest).toHaveLength(0)
    expect(message!.readUInt8(0)).toBe(SCRCPY_MSG.INJECT_TEXT)
    expect(message!.subarray(5).toString('utf8')).toBe('hello')
  })

  it('pastes anything the virtual keyboard cannot spell', () => {
    // INJECT_TEXT is not UTF-8 end to end the way its wire format suggests: the server
    // reverse-maps every character through KeyCharacterMap and drops the ones no key
    // produces, which is every Chinese character and every emoji.
    const [message, ...rest] = encodeTextInput('中文🎉')
    expect(rest).toHaveLength(0)
    expect(message!.readUInt8(0)).toBe(SCRCPY_MSG.SET_CLIPBOARD)
    expect(message!.readUInt8(9)).toBe(1)
    expect(message!.subarray(14).toString('utf8')).toBe('中文🎉')
  })

  it('turns backspace into a DEL press rather than a character', () => {
    // Virtual.kcm gives DEL no character mapping at all, so a literal \b on the text
    // channel is looked up, not found, and thrown away.
    const messages = encodeTextInput('\b')
    expect(messages).toHaveLength(2)
    expect(messages[0]!.readUInt8(0)).toBe(SCRCPY_MSG.INJECT_KEYCODE)
    expect(messages[0]!.readInt32BE(2)).toBe(67)
    expect(messages[1]!.readUInt8(1)).toBe(1)
  })

  it('sends Enter and Tab as keys, so IME actions fire', () => {
    expect(encodeTextInput('\n')[0]!.readInt32BE(2)).toBe(66)
    expect(encodeTextInput('\r')[0]!.readInt32BE(2)).toBe(66)
    expect(encodeTextInput('\t')[0]!.readInt32BE(2)).toBe(61)
  })

  it('never splits one string across both channels', () => {
    // Measured on a device: injected characters are queued and then routed through the
    // IME, while KEYCODE_PASTE is handled by the focused view directly, so a string
    // sent as text + paste arrives out of order — `hi 中文` landed as `hi中文 `.
    const messages = encodeTextInput('hi 中文')
    expect(messages).toHaveLength(1)
    expect(messages[0]!.readUInt8(0)).toBe(SCRCPY_MSG.SET_CLIPBOARD)
    expect(messages[0]!.subarray(14).toString('utf8')).toBe('hi 中文')
  })

  it('keeps the key presses between the runs, in order', () => {
    const messages = encodeTextInput('ab中\ncd')
    expect(messages.map((message) => message.readUInt8(0))).toEqual([
      SCRCPY_MSG.SET_CLIPBOARD,
      SCRCPY_MSG.INJECT_KEYCODE,
      SCRCPY_MSG.INJECT_KEYCODE,
      SCRCPY_MSG.SET_CLIPBOARD,
    ])
    expect(messages[0]!.subarray(14).toString('utf8')).toBe('ab中')
    expect(messages[3]!.subarray(14).toString('utf8')).toBe('cd')
  })

  it('leaves an all-ASCII string on the cheaper text channel', () => {
    // The clipboard is a detour, not an upgrade: it clobbers whatever the user had
    // copied on the device, so it is only taken when the text channel cannot deliver.
    const messages = encodeTextInput('ab\ncd')
    expect(messages.map((message) => message.readUInt8(0))).toEqual([
      SCRCPY_MSG.INJECT_TEXT,
      SCRCPY_MSG.INJECT_KEYCODE,
      SCRCPY_MSG.INJECT_KEYCODE,
      SCRCPY_MSG.INJECT_TEXT,
    ])
  })

  it('keeps a surrogate pair whole', () => {
    // Iterating code units would split the emoji across two clipboard writes, and each
    // half alone is not a character.
    const messages = encodeTextInput('🎉🎉')
    expect(messages).toHaveLength(1)
    expect(messages[0]!.subarray(14).toString('utf8')).toBe('🎉🎉')
  })

  it('sends nothing for an empty string', () => {
    expect(encodeTextInput('')).toEqual([])
  })
})

describe('encodeTouchStep', () => {
  it('expands a tap into a down and an up, since Android has no atomic tap', () => {
    // The simulator helper does have one, which is why TouchStep keeps `tap` as its
    // own kind instead of deciding on both platforms' behalf.
    const step: TouchStep = { kind: 'tap', xRatio: 0.5, yRatio: 0.5, delayMs: 0 }
    const messages = encodeTouchStep(step, SCREEN)
    expect(messages).toHaveLength(2)
    expect(messages.map((message) => message.readUInt8(1))).toEqual([MOTION.DOWN, MOTION.UP])
  })

  it('maps the three gesture phases onto motion actions', () => {
    const phases = ['began', 'moved', 'ended'] as const
    const actions = phases.map((phase) => encodeTouchStep(
      { kind: 'contacts', contacts: [{ id: 1, xRatio: 0.5, yRatio: 0.5, phase }], delayMs: 0 },
      SCREEN,
    )[0]!.readUInt8(1))
    expect(actions).toEqual([MOTION.DOWN, MOTION.MOVE, MOTION.UP])
  })

  it('emits one message per contact, so a pinch moves both fingers', () => {
    const messages = encodeTouchStep({
      kind: 'contacts',
      delayMs: 0,
      contacts: [
        { id: 1, xRatio: 0.4, yRatio: 0.5, phase: 'moved' },
        { id: 2, xRatio: 0.6, yRatio: 0.5, phase: 'moved' },
      ],
    }, SCREEN)
    expect(messages.map((message) => message.readBigInt64BE(2))).toEqual([1n, 2n])
  })
})

describe('encodeCancelTouches', () => {
  it('lifts every finger, so an interrupted gesture leaves none held down', () => {
    const messages = encodeCancelTouches(SCREEN)
    expect(messages).toHaveLength(2)
    expect(messages.every((message) => message.readUInt8(1) === MOTION.CANCEL)).toBe(true)
  })
})

describe('encodeBare', () => {
  it('sends a type-only message as its single byte', () => {
    expect([...encodeBare(SCRCPY_MSG.ROTATE_DEVICE)]).toEqual([11])
  })
})
