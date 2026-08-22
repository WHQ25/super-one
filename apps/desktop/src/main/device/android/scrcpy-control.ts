/**
 * Control messages, as scrcpy 4.0's server deserializes them.
 *
 * Field widths and order verified against `ControlMessageReader`. Everything is
 * big-endian, which is Java's `DataInputStream` and not a choice this end gets to
 * make.
 */

import type { DeviceInput } from '@superone/shared/device'
import type { DeviceHardwareButton } from '../../device-agent/types'
import type { TouchStep } from '../gesture-synth'

/** From `ControlMessage.TYPE_*`. Order is the wire contract. */
export const SCRCPY_MSG = {
  INJECT_KEYCODE: 0,
  INJECT_TEXT: 1,
  INJECT_TOUCH_EVENT: 2,
  INJECT_SCROLL_EVENT: 3,
  BACK_OR_SCREEN_ON: 4,
  EXPAND_NOTIFICATION_PANEL: 5,
  EXPAND_SETTINGS_PANEL: 6,
  COLLAPSE_PANELS: 7,
  GET_CLIPBOARD: 8,
  SET_CLIPBOARD: 9,
  SET_DISPLAY_POWER: 10,
  ROTATE_DEVICE: 11,
  /**
   * Restart the encoder: a fresh config packet and an immediate keyframe.
   *
   * Read off `ControlMessage` in the pinned jar rather than counted along the list —
   * the numbering is not contiguous past 11 (`RESIZE_DISPLAY` is 21), so guessing the
   * next one along lands on the wrong message.
   */
  RESET_VIDEO: 17,
} as const

/** `android.view.MotionEvent` actions. */
export const MOTION = {
  DOWN: 0,
  UP: 1,
  MOVE: 2,
  CANCEL: 3,
} as const

/** `android.view.KeyEvent` actions. */
const KEY_DOWN = 0
const KEY_UP = 1

/**
 * `android.view.KeyEvent` keycodes for the buttons the agent can press.
 *
 * `back` has no iOS counterpart and is not optional here: it is how you leave a screen
 * on Android, and an agent without it can open things it cannot close.
 */
export const KEYCODE: Record<string, number> = {
  home: 3,
  back: 4,
  'volume-up': 24,
  'volume-down': 25,
  // Both `lock` and `side` mean the physical button on the right edge. iOS
  // distinguishes them by device generation; Android has only ever had the one.
  lock: 26,
  side: 26,
  'app-switch': 187,
}

/**
 * Pressure as a 16-bit fixed-point fraction of 1.0.
 *
 * `Binary.u16FixedPointToFloat` on the far side, so 1.0 has to be 0xFFFF exactly —
 * multiplying by 0x10000 and truncating overflows to 0, which the device reads as a
 * finger resting weightlessly on the glass and ignores.
 */
export function encodePressure(pressure: number): number {
  if (pressure >= 1) return 0xffff
  if (pressure <= 0) return 0
  return Math.round(pressure * 0xffff)
}

export interface TouchTarget {
  /** Framebuffer ratios, matching `DeviceUiNode.bounds`. */
  xRatio: number
  yRatio: number
  /** Current scrcpy video size. The server rejects events carrying any other size. */
  width: number
  height: number
}

/**
 * One touch contact update.
 *
 * The position carries the current scrcpy video size and the server maps it back to
 * the display. Ratios let the caller project snapshot coordinates into that required
 * wire size, and are also the one space that survives Android rotation.
 */
export function encodeTouch(options: {
  action: number
  pointerId: number
  target: TouchTarget
  pressure?: number
  buttons?: number
}): Buffer {
  const { action, pointerId, target } = options
  const message = Buffer.alloc(32)
  message.writeUInt8(SCRCPY_MSG.INJECT_TOUCH_EVENT, 0)
  message.writeUInt8(action, 1)
  message.writeBigInt64BE(BigInt(pointerId), 2)
  // Rounded to whole pixels: the far side reads signed ints, and a fractional value
  // would simply be truncated there instead of here, less predictably.
  message.writeInt32BE(Math.round(clamp01(target.xRatio) * target.width), 10)
  message.writeInt32BE(Math.round(clamp01(target.yRatio) * target.height), 14)
  message.writeUInt16BE(clampU16(target.width), 18)
  message.writeUInt16BE(clampU16(target.height), 20)
  // A lifting finger reports no pressure. Sending 1.0 on an UP has been observed to
  // read as a second press on some input stacks.
  message.writeUInt16BE(
    encodePressure(action === MOTION.UP ? 0 : options.pressure ?? 1),
    22,
  )
  // Finger touches intentionally carry no action button or pressed buttons. scrcpy's
  // server treats them as SOURCE_TOUCHSCREEN and clears buttons on that path.
  message.writeInt32BE(0, 24)
  message.writeInt32BE(options.buttons ?? 0, 28)
  return message
}

export function encodeKeycode(options: {
  keycode: number
  action?: number
  repeat?: number
  metaState?: number
}): Buffer {
  const message = Buffer.alloc(14)
  message.writeUInt8(SCRCPY_MSG.INJECT_KEYCODE, 0)
  message.writeUInt8(options.action ?? KEY_DOWN, 1)
  message.writeInt32BE(options.keycode, 2)
  message.writeInt32BE(options.repeat ?? 0, 6)
  message.writeInt32BE(options.metaState ?? 0, 10)
  return message
}

/** A press is two messages. A device that only sees DOWN holds the key forever. */
export function encodeKeyPress(keycode: number): Buffer[] {
  return [
    encodeKeycode({ keycode, action: KEY_DOWN }),
    encodeKeycode({ keycode, action: KEY_UP }),
  ]
}

/**
 * Hand the server a string for its INJECT_TEXT channel.
 *
 * The wire is UTF-8, but the far side is NOT: `Controller.injectChar` looks every
 * character up in the virtual keyboard's `KeyCharacterMap` and injects the key events
 * that would have produced it, so anything no key can spell is dropped with a
 * `Could not inject char u+…` warning. Callers want `encodeTextInput`, which knows
 * which characters those are; this stays the raw encoder, and the raw encoder only.
 */
export function encodeText(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const message = Buffer.alloc(5 + payload.length)
  message.writeUInt8(SCRCPY_MSG.INJECT_TEXT, 0)
  message.writeUInt32BE(payload.length, 1)
  payload.copy(message, 5)
  return message
}

/**
 * Put text on the device clipboard, optionally pasting it into the focused field.
 *
 * `sequence` is deliberately 0: a non-zero one makes the server answer with an
 * ACK_CLIPBOARD device message, and nothing on this end reads the control socket back.
 */
export function encodeSetClipboard(text: string, paste: boolean): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const message = Buffer.alloc(14 + payload.length)
  message.writeUInt8(SCRCPY_MSG.SET_CLIPBOARD, 0)
  message.writeBigInt64BE(0n, 1)
  message.writeUInt8(paste ? 1 : 0, 9)
  message.writeUInt32BE(payload.length, 10)
  payload.copy(message, 14)
  return message
}

/**
 * `android.view.KeyEvent` keycodes for the control characters a keyboard produces.
 *
 * These cannot ride INJECT_TEXT. Backspace is the one that proves it: `Virtual.kcm`
 * gives DEL no character mapping at all, so `KeyCharacterMap.getEvents('\b')` returns
 * null and the keystroke evaporates. Enter and Tab do map, but they are sent as keys
 * anyway — a key is what the guest is actually being told about, and IME actions like
 * "search" or "send" only fire for one.
 */
const TEXT_KEYCODE: Record<string, number> = {
  '\n': 66, // ENTER
  '\r': 66,
  '\b': 67, // DEL
  '\t': 61, // TAB
}

/**
 * Characters the virtual keyboard can actually spell.
 *
 * The Android counterpart of `canTypeIosSimulatorText`, and it exists for the mirror
 * image of the same reason: there, the HID channel carries usage codes; here, the far
 * side reverse-maps every character through a key character map. Either way anything
 * outside this set — Chinese, emoji, accented latin — has to reach the guest through
 * its clipboard instead.
 */
function isInjectable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return code >= 0x20 && code <= 0x7e
}

/**
 * A person's typing, in scrcpy's vocabulary.
 *
 * Control characters become key presses; everything between them travels on ONE
 * channel — the text channel if the whole string can be spelled, the clipboard if any
 * part of it cannot.
 *
 * The all-or-nothing choice is the point, and it is the same one
 * `canTypeIosSimulatorText` makes. Splitting a string across both channels looks
 * tidier and does not survive contact with a device: injected characters are queued
 * asynchronously and then routed through the IME, while KEYCODE_PASTE is handled by
 * the focused view directly, so the two arrive out of order. `hi 中文` sent as
 * text + paste landed as `hi中文 ` — the space overtook the paste.
 */
export function encodeTextInput(text: string): Buffer[] {
  const messages: Buffer[] = []
  // One verdict for the whole string, taken before anything is sent.
  const typeable = [...text].every((char) => char in TEXT_KEYCODE || isInjectable(char))
  let run = ''

  const flush = (): void => {
    if (!run) return
    // A clipboard write pastes itself: the server sets the clipboard and presses
    // KEYCODE_PASTE (279) inside the one message handler, so nothing can slip between
    // the two and no second message is needed from here.
    messages.push(typeable ? encodeText(run) : encodeSetClipboard(run, true))
    run = ''
  }

  // Iterated by code point rather than code unit so an emoji's surrogate pair stays
  // one character and cannot be split across two clipboard writes.
  for (const char of text) {
    const keycode = TEXT_KEYCODE[char]
    if (keycode !== undefined) {
      flush()
      messages.push(...encodeKeyPress(keycode))
      continue
    }
    run += char
  }
  flush()
  return messages
}

/** Messages that are their type byte and nothing else. */
export function encodeBare(type: number): Buffer {
  return Buffer.from([type])
}

export function keycodeForButton(button: DeviceHardwareButton | 'back' | 'app-switch'): number | null {
  return KEYCODE[button] ?? null
}

/**
 * A synthesized gesture step, in scrcpy's vocabulary.
 *
 * A `tap` becomes a DOWN/UP pair rather than one message, because Android has no
 * atomic tap — unlike the simulator helper, which does, and which is why `TouchStep`
 * keeps the two shapes apart instead of deciding for both platforms.
 */
export function encodeTouchStep(step: TouchStep, screen: { width: number; height: number }): Buffer[] {
  if (step.kind === 'tap') {
    const target = { xRatio: step.xRatio, yRatio: step.yRatio, ...screen }
    return [
      encodeTouch({ action: MOTION.DOWN, pointerId: 1, target }),
      encodeTouch({ action: MOTION.UP, pointerId: 1, target }),
    ]
  }
  return step.contacts.map((contact) => encodeTouch({
    action: contact.phase === 'began'
      ? MOTION.DOWN
      : contact.phase === 'ended' ? MOTION.UP : MOTION.MOVE,
    pointerId: contact.id,
    target: { xRatio: contact.xRatio, yRatio: contact.yRatio, ...screen },
  }))
}

/** Let go of every finger. Sent when a gesture is interrupted mid-flight. */
export function encodeCancelTouches(
  screen: { width: number; height: number },
  pointerIds: readonly number[] = [1, 2],
): Buffer[] {
  return pointerIds.map((pointerId) => encodeTouch({
    action: MOTION.CANCEL,
    pointerId,
    target: { xRatio: 0.5, yRatio: 0.5, ...screen },
  }))
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function clampU16(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 0xffff)
}

/**
 * A person's input, in scrcpy's vocabulary.
 *
 * The counterpart to `encodeTouchStep`, which handles the agent's synthesized
 * gestures. This one handles the raw stream a pointer produces — many contact updates
 * a second, already in framebuffer ratios.
 */
export function encodeDeviceInput(
  input: DeviceInput,
  screen: { width: number; height: number },
): Buffer[] {
  switch (input.type) {
    case 'touch.update':
      return input.contacts.map((contact) => encodeTouch({
        action: contact.phase === 'began'
          ? MOTION.DOWN
          : contact.phase === 'ended'
            ? MOTION.UP
            : contact.phase === 'cancelled' ? MOTION.CANCEL : MOTION.MOVE,
        pointerId: contact.id,
        target: { xRatio: contact.xRatio, yRatio: contact.yRatio, ...screen },
      }))
    case 'touch.cancel':
      return encodeCancelTouches(screen)
    case 'tap':
      return encodeTouchStep(
        { kind: 'tap', xRatio: input.xRatio, yRatio: input.yRatio, delayMs: 0 },
        screen,
      )
    case 'text':
      return encodeTextInput(input.text)
    case 'button': {
      const keycode = keycodeForButton(input.button as never)
      return keycode === null ? [] : encodeKeyPress(keycode)
    }
    case 'rotate':
      // Deliberately empty: scrcpy's ROTATE_DEVICE cycles to the next orientation and
      // cannot be told which one to land on. The surface writes `user_rotation`
      // instead — see `AndroidDeviceManager.rotate`.
      return []
    case 'keyboard':
      // No Android counterpart. The on-screen keyboard follows focus and the IME.
      return []
  }
}

/**
 * Ask the device to start a new GOP, now.
 *
 * The encoder's own keyframes are far apart — measured at well over 12s on a Xiaomi
 * 15 Pro — and a viewer that joins between two of them has a configured decoder and
 * nothing it is allowed to decode. This is what turns that wait into a round trip.
 * Bodyless: the type byte IS the message.
 */
export function encodeResetVideo(): Buffer {
  return Buffer.from([SCRCPY_MSG.RESET_VIDEO])
}
