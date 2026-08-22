/**
 * The mirrored iPhone, and which chat session is driving it.
 *
 * The smallest of the three managers, because almost nothing here is ours. There is no
 * catalog to enumerate — macOS pairs exactly one phone at a time, so this machine has
 * either one mirrored device or none. There is no boot to orchestrate beyond launching
 * an app and waiting. There is no framebuffer to hold: every picture is a fresh capture
 * of somebody else's window.
 *
 * What it does own is the two things the window cannot tell you itself: which session
 * has claimed the phone, and the LAST GOOD capture geometry — because input has to be
 * resolved against the capture it was aimed at, not against whatever the window looks
 * like by the time the click arrives.
 */

import type { DeviceDescriptor, DeviceState } from '@superone/shared/device'
import { formatDeviceId, parseDeviceId } from '@superone/shared/device'
import log from '../../logger'
import {
  captureMirror,
  interstitialReason,
  launchMirrorApp,
  readMirrorState,
  type MirrorSnapshot,
  type MirrorState,
} from './mirror-helper'

/**
 * The one id this provider ever issues.
 *
 * Constant rather than derived from the paired device's UUID, and that is deliberate:
 * `com.apple.ScreenContinuity`'s pairing record moves when the user pairs a different
 * phone, and a device id that changed underneath would orphan the session binding and
 * the panel's remembered selection for no benefit — there is only ever one.
 */
export const MIRROR_DEVICE_ID = formatDeviceId('ios-mirror', 'iphone')

export function isMirrorDeviceId(deviceId: string): boolean {
  return parseDeviceId(deviceId)?.provider === 'ios-mirror'
}

/** How long a launch gets to reach a live session, including the user approving it. */
const CONNECT_TIMEOUT_MS = 90_000
const CONNECT_POLL_MS = 1_000

/**
 * Longest edge of a capture.
 *
 * The window is around 344pt wide and Retina makes that ~688px; asking for less would
 * cost OCR the small type, which is the only thing standing in for an element tree.
 */
const CAPTURE_MAX_WIDTH = 900

export class MirrorDeviceManager {
  /** The session holding the phone, if any. One device, so one slot. */
  private owner: string | null = null
  /**
   * The most recent capture, kept for its coordinate metadata.
   *
   * Input names a point in a picture, and only the picture knows how big it was. The
   * helper re-validates the window's live geometry when resolving that point and
   * refuses if it has moved, so a stale snapshot fails loudly rather than tapping
   * somewhere arbitrary.
   */
  private lastSnapshot: MirrorSnapshot | null = null
  private readonly listeners = new Set<(state: DeviceState) => void>()

  async state(): Promise<MirrorState> {
    return readMirrorState()
  }

  /**
   * The phone, if this session is the one holding it.
   *
   * Synchronous and free, matching the other managers: `device_act` resolves its
   * target on every call, and a probe there would put a socket round trip in front of
   * every tap. At most one id, because there is at most one mirrored phone.
   */
  devicesOf(sessionId: string): string[] {
    return this.owner === sessionId ? [MIRROR_DEVICE_ID] : []
  }

  /**
   * Zero or one devices.
   *
   * Absent entirely when macOS has no iPhone Mirroring — below macOS 15, or on a Mac
   * without Apple silicon or a T2. Present but `available: false` when the app exists
   * and no session can be established, so the picker can say "yours is not connected"
   * rather than silently omitting a phone the user knows they own.
   */
  async listDevices(): Promise<DeviceDescriptor[]> {
    const state = await this.state().catch((cause) => {
      log.warn('[ios-mirror] state probe failed', cause)
      return null
    })
    if (!state?.installed) return []
    return [{
      id: MIRROR_DEVICE_ID,
      provider: 'ios-mirror',
      platform: 'ios',
      name: 'iPhone',
      kind: 'iphone',
      // "iPhone" alone would be indistinguishable from the simulator heading, and the
      // difference is the whole point: one of these is somebody's actual phone.
      kindName: 'Mirrored iPhone',
      // After the simulators. A real phone is the rarer choice and the slower one to
      // reach, so it does not belong above a list of things that boot on demand.
      kindRank: 50,
      model: 'iPhone',
      platformVersion: 'iPhone Mirroring',
      versionRank: 0,
      running: state.live,
      // Installed is not enough: without a paired phone in range every action would
      // fail after the user picked it.
      available: state.live || state.running,
      ...(this.owner ? { boundSessionId: this.owner } : {}),
    }]
  }

  async deviceState(deviceId: string = MIRROR_DEVICE_ID): Promise<DeviceState> {
    const state = await this.state()
    const [device] = await this.listDevices()
    const reason = interstitialReason(state)
    return {
      deviceId,
      owner: this.owner,
      device: device ?? null,
      phase: state.live ? 'ready' : 'idle',
      interactive: state.live,
      // Always upright, because there is nothing to ask. macOS re-shapes the window
      // when the phone turns, so the picture arrives the right way up and the host
      // never rotates anything — see `DEVICE_CAPABILITIES['ios-mirror'].rotation`.
      orientation: 'portrait',
      // macOS's own sentence, not ours: already localized, and already covering
      // whatever screen Apple adds next.
      ...(reason ? { mirror: { reason } } : {}),
    }
  }

  bind(sessionId: string, deviceId: string = MIRROR_DEVICE_ID): Promise<DeviceState> {
    this.owner = sessionId
    return this.deviceState(deviceId)
  }

  /**
   * Get to a live session, launching the app if it is not up.
   *
   * The wait is generous because the slow part is a person: a first connection asks
   * the user to unlock the phone, and there is no signal for "the human is looking at
   * it" to distinguish from "this will never work".
   */
  async boot(sessionId: string, deviceId: string = MIRROR_DEVICE_ID): Promise<DeviceState> {
    this.owner = sessionId
    let state = await this.state()
    if (!state.installed) {
      throw new Error('iPhone Mirroring is not available on this Mac.')
    }
    if (!state.running) state = await launchMirrorApp()

    const deadline = Date.now() + CONNECT_TIMEOUT_MS
    while (!state.live && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, CONNECT_POLL_MS))
      state = await this.state()
    }
    if (!state.live) {
      // The reason comes from the screen macOS is showing, so it is both accurate and
      // in the user's language — far better than a timeout of our own invention.
      throw new Error(interstitialReason(state) ?? 'The iPhone did not connect.')
    }
    const next = await this.deviceState(deviceId)
    this.emit(next)
    return next
  }

  /**
   * Let go. The window stays exactly as it was.
   *
   * There is no counterpart to shutting a simulator down here — quitting iPhone
   * Mirroring is the user's business, and a panel closing is not a reason to sever a
   * connection they may be using themselves.
   */
  async detach(deviceId: string = MIRROR_DEVICE_ID): Promise<DeviceState> {
    this.owner = null
    this.lastSnapshot = null
    const next = await this.deviceState(deviceId)
    this.emit(next)
    return next
  }

  /**
   * One picture, and the geometry that makes it clickable.
   *
   * Every capture replaces the remembered one, so input is always resolved against
   * the most recent thing anybody actually looked at.
   */
  async capture(): Promise<MirrorSnapshot> {
    const state = await this.state()
    if (!state.live || state.windowId === undefined) {
      throw new Error(interstitialReason(state) ?? 'The iPhone is not being mirrored.')
    }
    const snapshot = await captureMirror(state.windowId, CAPTURE_MAX_WIDTH)
    this.lastSnapshot = snapshot
    return snapshot
  }

  /**
   * The capture a point was aimed at, taking a fresh one if there is none.
   *
   * Input arrives referring to whatever was last drawn; if the panel has been open
   * without streaming there may be nothing remembered yet, and re-capturing is both
   * correct and cheap next to failing the gesture.
   */
  async snapshotForInput(): Promise<MirrorSnapshot> {
    return this.lastSnapshot ?? await this.capture()
  }

  onState(listener: (state: DeviceState) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(state: DeviceState): void {
    for (const listener of this.listeners) {
      try {
        listener(state)
      } catch (cause) {
        log.warn('[ios-mirror] state listener threw', cause)
      }
    }
  }
}
