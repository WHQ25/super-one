/**
 * Android, as the device catalog and the control grant see it.
 *
 * The mirror of `ios-simulator/device-port.ts`. Everything platform-specific stops
 * here: how a device is addressed (an adb serial), how a build gets onto it (`adb
 * install`), and what to say when there is nothing to offer.
 */

import type { DeviceDescriptor } from '@superone/shared/device'
import type { DevicePlatformPort } from '../platform-port'
import type { AndroidDeviceManager } from './android-device-manager'

export class AndroidDevicePort implements DevicePlatformPort {
  readonly platform = 'android' as const

  constructor(private readonly manager: AndroidDeviceManager) {}

  listDevices(): Promise<DeviceDescriptor[]> {
    return this.manager.listDevices()
  }

  async controlled(sessionId: string, devices?: DeviceDescriptor[]): Promise<DeviceDescriptor | null> {
    // The manager answers from the last list it took. A caller that has not listed
    // yet gets one taken now, so this never reports "nothing" merely because it was
    // asked first.
    if (!devices) await this.manager.listDevices()
    return this.manager.controlled(sessionId)
  }

  boot(sessionId: string, deviceId: string): Promise<DeviceDescriptor | null> {
    return this.manager.boot(sessionId, deviceId)
  }

  controlNote(device: DeviceDescriptor): string {
    // The serial, not the catalog id: `adb` has never heard of `android:avd:…`, and a
    // command the agent copies out of here has to run as written.
    const serial = this.manager.serialFor(device.id) ?? '<serial>'
    return `This session now controls the device. Install a build with \`adb -s ${serial} install -r <path/to/app.apk>\` `
      + `and launch it with \`adb -s ${serial} shell am start -n <package>/<activity>\`, `
      + 'then use device_snapshot to see the screen. '
      // The emulator was started with -no-window, so there is no window to raise and
      // nothing for these to accomplish except starting a SECOND emulator on the same
      // AVD, which then fights the first one for the adb port.
      + 'The device is already running and visible in this session, so never start another emulator for it — '
      + 'no `emulator -avd`, no `flutter emulators --launch`, no Android Studio device manager. '
      + 'Build-and-run commands like `flutter run` or `npx expo run:android` are fine.'
  }

  emptyNote(installed: number): string {
    return installed === 0
      ? 'No Android devices are available. Create an emulator in Android Studio\'s Device Manager, '
        + 'or attach a phone with USB debugging turned on.'
      : 'Every Android device on this machine is unavailable — a connected phone usually means '
        + 'the USB debugging prompt has not been accepted on the device itself.'
  }
}
