/**
 * A mirrored iPhone in the catalog, and in the control prompt.
 *
 * The half of the seam that finds a device and hands it over. The prose below is the
 * point of the file: this provider's limits are unusual enough that an agent given a
 * mirrored phone with the simulator's instructions would spend a turn trying to
 * install a build onto it.
 */

import type { DeviceDescriptor } from '@superone/shared/device'
import type { DevicePlatformPort } from '../platform-port'
import { MIRROR_DEVICE_ID, type MirrorDeviceManager } from './mirror-device-manager'

export class MirrorDevicePort implements DevicePlatformPort {
  readonly platform = 'ios' as const

  constructor(private readonly manager: MirrorDeviceManager) {}

  listDevices(): Promise<DeviceDescriptor[]> {
    return this.manager.listDevices()
  }

  async boot(sessionId: string, deviceId: string): Promise<DeviceDescriptor | null> {
    try {
      const state = await this.manager.boot(sessionId, deviceId || MIRROR_DEVICE_ID)
      return state.device
    } catch {
      // Null rather than throwing: the caller knows which device the user just
      // approved and can name it in an error; this does not.
      return null
    }
  }

  async waitForPreview(_deviceId: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Cancelled.')
    // This provider is a capture loop rather than a socket stream. A successful
    // capture is its equivalent of a first frame and primes input geometry too.
    await this.manager.capture()
  }

  /**
   * What the agent must know before its first action.
   *
   * Three of these correct an assumption carried over from the other providers, and
   * each of them is something an agent would otherwise burn a turn discovering.
   */
  controlNote(): string {
    return [
      'This is a REAL iPhone, mirrored from the Mac by iPhone Mirroring. It is not a simulator.',
      '',
      '- There is NO accessibility tree. The screen is a video stream and the UI is read by OCR, so only VISIBLE TEXT is listed. Icon-only controls — a back chevron, a share button, a heart — do not appear at all; tap them by position, using nearby text to locate them.',
      '- You CANNOT install or launch a build. There is no `simctl install` or `adb install` equivalent; open apps the way a person would, from the Home screen.',
      '- You CANNOT rotate it. The phone turns when its owner turns it.',
      '- Do NOT run `xcrun simctl`, `adb`, or `idevice*` commands against it. None of them reach a mirrored phone, and `simctl` would address an unrelated simulator.',
      '- It belongs to someone. Treat anything already on screen as their private content, and do not go looking through it.',
    ].join('\n')
  }

  /**
   * Why there is no phone here.
   *
   * `installed` counts devices filtered out as unavailable, which for this provider
   * means the app exists but no session could be established — a different problem
   * from the feature being absent, and one the user fixes by picking up their phone.
   */
  emptyNote(installed: number): string {
    return installed > 0
      ? 'An iPhone is paired for mirroring but is not connected. Unlock it, keep it near this Mac, and open iPhone Mirroring.'
      : 'This Mac has no iPhone Mirroring. It needs macOS 15 or later on Apple silicon or a T2 Mac, with an iPhone paired to the same Apple Account.'
  }
}
