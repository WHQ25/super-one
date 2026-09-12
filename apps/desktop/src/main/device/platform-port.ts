/**
 * What one platform must provide for its devices to appear in the catalog and be
 * grantable to a chat session.
 *
 * The companion to `device-agent/types.ts`. That seam covers DRIVING a device the
 * session already holds; this one covers finding it and being handed it — the half
 * that still named `IosSimulatorDevice` and `udid` everywhere, and therefore the half
 * that actually blocked a second platform.
 *
 * Deliberately includes the two pieces of PROSE a platform owes the agent. Both are
 * genuinely platform-specific — "install it with `xcrun simctl install`" versus "with
 * `adb install`" — and the alternative is a wall of `if (platform === 'ios')` inside
 * the shared control flow, which is exactly the shape this seam exists to prevent.
 */

import type { DeviceDescriptor, DevicePlatform, DeviceProvider } from '@superone/shared/device'

/**
 * How a device was let go of.
 *
 * `shutdown` means it is no longer running; `detached` means it was only unbound —
 * a real phone, or a device that was already up when this session found it.
 */
export type DeviceReleaseOutcome = 'shutdown' | 'detached'

export interface DevicePlatformPort {
  readonly platform: DevicePlatform
  /**
   * What this port speaks for. Routing key, not the platform: a mirrored iPhone and
   * a simulator both RUN iOS, and only one of them answers to `simctl`.
   */
  readonly provider: DeviceProvider

  /** Everything this platform knows about, available or not. */
  listDevices(): Promise<DeviceDescriptor[]>

  /**
   * Hand this session the device, booting it if needed.
   *
   * Resolves to the device once it is actually usable, or null if it never came up.
   * Null rather than throwing so the caller can name the device in its own error —
   * it knows what the user just approved, and this does not.
   */
  boot(sessionId: string, deviceId: string): Promise<DeviceDescriptor | null>

  /**
   * Start the device without granting anything.
   *
   * Optional, and the option is the point: a mirrored iPhone has no "boot" — it is
   * already someone's running phone — so the platform that cannot do this says so by
   * not implementing it, rather than by faking a success the agent would then act on.
   *
   * Resolves to the device once it is up, or null if it never came up.
   */
  power?(deviceId: string, signal?: AbortSignal): Promise<DeviceDescriptor | null>

  /** Resolve only after the live preview has delivered its first drawable frame. */
  waitForPreview(deviceId: string, signal?: AbortSignal): Promise<void>

  /**
   * Give a device this session holds back, when the agent is done with it.
   *
   * Puts the device back the way it was found: one this app started is stopped, one
   * that was already running is left running and merely unbound, and a real phone is
   * only ever unbound. `shutdown` forces the stop on anything that CAN stop — a real
   * phone still comes back `detached`, because nothing on this machine turns it off.
   */
  release(deviceId: string, options: { shutdown: boolean }): Promise<DeviceReleaseOutcome>

  /**
   * What the agent can do now that it holds a device here — how to install a build,
   * how to launch it, and which commands it must not run.
   */
  controlNote(device: DeviceDescriptor): string

  /**
   * Why this platform is offering nothing.
   *
   * `installed` is how many devices exist but were filtered out as unavailable, which
   * is the difference between "you have none" and "yours are all broken" — two
   * problems with completely different fixes.
   */
  emptyNote(installed: number): string
}

/**
 * Every device this session is driving, read straight off the catalog.
 *
 * Ownership is stamped onto each row as it is listed — both platforms do it, from the
 * same `owners` map their bind writes — so a caller that has already listed the
 * devices has the answer in hand and needs no second question. It used to be one, per
 * port, and could only ever return ONE device; a session may now hold several.
 *
 * `running` is part of the test, not decoration: a device can stay bound while its
 * simulator is shut down, and the agent cannot drive one of those.
 */
export function controlledDevices(
  devices: readonly DeviceDescriptor[],
  sessionId: string,
): DeviceDescriptor[] {
  return devices.filter((device) => device.boundSessionId === sessionId && device.running)
}

/** Newest first among devices sharing a model; running ones ahead of cold ones. */
export function orderDevices(devices: readonly DeviceDescriptor[]): DeviceDescriptor[] {
  return [...devices].sort((a, b) => {
    // Not cosmetic: attaching to a running device is free, while a cold one spends
    // ~20s booting. Putting the cheap choice at the top is the difference between the
    // obvious pick being instant and the obvious pick being a wait.
    if (a.running !== b.running) return a.running ? -1 : 1
    const byName = a.name.localeCompare(b.name)
    if (byName !== 0) return byName
    // Same model on several runtimes: newest wins. This is what a bare model name
    // resolves to, and "iPhone 17 Pro Max" meaning the iOS 17.0 one would be a
    // surprise the user only discovers after approving the prompt.
    return b.versionRank - a.versionRank
  })
}

/** Only devices that can actually be booted — an uninstalled runtime is not an option. */
export function offerableDevices(devices: readonly DeviceDescriptor[]): DeviceDescriptor[] {
  return orderDevices(devices.filter((device) => device.available))
}

/**
 * Which port speaks for a device.
 *
 * Matched on provider, never on platform: the simulator and the mirrored iPhone are
 * both `ios`, and matching on that handed a mirrored phone to `simctl`. Null only
 * when the descriptor did not come from a port in this list, which is the one way a
 * caller can assemble the two separately — named rather than non-null-asserted so
 * that fails loudly here.
 */
export function portFor(
  ports: readonly DevicePlatformPort[],
  device: Pick<DeviceDescriptor, 'provider'>,
): DevicePlatformPort | null {
  return ports.find((candidate) => candidate.provider === device.provider) ?? null
}

/**
 * Resolve the handle the agent quoted.
 *
 * Matched loosely on purpose. The id from `device_list` is the exact path, but the
 * agent also writes from what the user said in chat ("the 17 Pro Max"), and the cost
 * of a loose match is only which device a prompt the user still has to approve names.
 */
export function resolveDevice(
  devices: readonly DeviceDescriptor[],
  ref: string | undefined,
): DeviceDescriptor | null {
  if (!ref) return null
  const needle = ref.trim().toLowerCase()
  if (!needle) return null
  const byId = devices.find((device) => device.id.toLowerCase() === needle)
  if (byId) return byId
  // The platform prefix is ours, not the agent's: a handle copied out of a log, or a
  // bare udid the agent got from `simctl`, still has to land.
  const byNativeId = devices.find((device) => {
    const separator = device.id.indexOf(':')
    return separator > 0 && device.id.slice(separator + 1).toLowerCase() === needle
  })
  if (byNativeId) return byNativeId
  const byName = devices.find((device) => device.name.toLowerCase() === needle)
  if (byName) return byName
  return devices.find((device) => {
    const haystack = `${device.name} ${device.platformVersion}`.toLowerCase()
    return haystack.includes(needle) || needle.includes(device.name.toLowerCase())
  }) ?? null
}
