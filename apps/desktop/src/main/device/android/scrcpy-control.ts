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
  /** The size this end believes the screen is. The server scales against it. */
  width: number
  height: number
}

/**
 * One touch contact update.
 *
 * The position carries the screen size the client thinks it is aiming at, and the
 * server rescales — which is why ratios can go out directly without this end ever
 * learning the real resolution. Ratios are also the one space that survives the
 * rotation mid-stream that Android does.
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
 * Type text directly, without a keyboard.
 *
 * Unlike the simulator's HID channel — which carries usage codes and therefore cannot
 * express anything outside ASCII — this is UTF-8 all the way down, so Chinese and
 * emoji need no pasteboard detour.
 */
export function encodeText(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const message = Buffer.alloc(5 + payload.length)
  message.writeUInt8(SCRCPY_MSG.INJECT_TEXT, 0)
  message.writeUInt32BE(payload.length, 1)
  payload.copy(message, 5)
  return message
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
      return [encodeText(input.text)]
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
