/**
 * The device catalog — what `device_list` returns, and how `device_request_control`
 * resolves the handle it was given.
 *
 * Split from the control flow because the two tools are a discovery/redeem pair: the
 * agent reads the catalog, then names one device. Keeping the resolution rules in one
 * place is what makes the id it read the id the prompt approves.
 *
 * The catalog is answered in TIERS, because a developer machine holds ~120 simulators
 * — every model crossed with every installed runtime — and flattening that costs
 * ~4k tokens to say almost nothing. Each level answers the question the previous one
 * raised:
 *
 *   device_list()                  → what is running, what this project used, what kinds exist
 *   device_list({ kind: 'iphone' })→ the models of that kind, with how many runtimes each has
 *   device_list({ model: '…' })    → that model's devices, one per runtime, WITH ids
 *
 * Ids appear only where they are actionable. The upper tiers carry names, and
 * `resolveDevice` matches those loosely, so an agent that already knows what it wants
 * can skip straight to `device_request_control`.
 */

import type { IosSimulatorDevice, IosSimulatorSessionState } from '@superone/shared/ios-simulator'
import { NO_DEVICE_RECENTS, type DeviceRecentsPort } from './device-recents'

/** The slice of `IosSimulatorManager` the device tools need, so tests need no Electron. */
export interface DeviceCatalogPort {
  listDevices(): Promise<IosSimulatorDevice[]>
  /** `devices` lets a caller that has already listed them skip a second simctl spawn. */
  getSessionState(sessionId: string, devices?: IosSimulatorDevice[]): Promise<IosSimulatorSessionState>
  boot(sessionId: string, udid: string): Promise<IosSimulatorSessionState>
}

/**
 * One device as the agent sees it.
 *
 * Deliberately not `IosSimulatorDevice`: this shape crosses to the model and is meant
 * to cover real phones later, so it carries only what a choice needs.
 */
export interface DeviceEntry {
  /** Stable handle to quote back in `device_request_control`. A simulator UDID today. */
  id: string
  name: string
  /** Platform version as the user sees it, e.g. "iOS 26.4". */
  platform: string
  /** Already running — taking control attaches instead of spending a cold boot. */
  running: boolean
  /** Held by another chat session; taking control takes it away from there. */
  busy?: boolean
  /** Already controlled by this session — no need to ask again. */
  controlled?: boolean
}

/** A family of devices, as the first tier offers them. */
export interface DeviceKindSummary {
  kind: DeviceKind
  name: string
  models: number
  devices: number
}

/** One model within a kind, as the second tier offers it. */
export interface DeviceModelSummary {
  model: string
  /** How many runtimes this model is installed for — how many ids the next tier holds. */
  devices: number
  /** Newest runtime available for it, which is what a bare model name resolves to. */
  latest: string
  running?: number
}

export type DeviceKind = 'iphone' | 'ipad' | 'watch' | 'tv' | 'vision' | 'other'

const KINDS: Array<{ kind: DeviceKind; name: string; match: RegExp }> = [
  { kind: 'iphone', name: 'iPhone', match: /iphone/i },
  { kind: 'ipad', name: 'iPad', match: /ipad/i },
  { kind: 'watch', name: 'Apple Watch', match: /watch/i },
  { kind: 'tv', name: 'Apple TV', match: /(apple-?)?tv/i },
  { kind: 'vision', name: 'Apple Vision', match: /vision/i },
]

const KIND_NAMES = new Map(KINDS.map((entry) => [entry.kind, entry.name] as const))

/**
 * Which family a device belongs to.
 *
 * Read from the device TYPE identifier, not the name: names are user-editable, and a
 * simulator renamed "checkout rig" still has to land under iPhone.
 */
export function deviceKind(device: IosSimulatorDevice): DeviceKind {
  const subject = device.deviceTypeIdentifier ?? device.name
  return KINDS.find((entry) => entry.match.test(subject))?.kind ?? 'other'
}

/**
 * The model a device is, independent of what it was named or which runtime it runs.
 *
 * This is the axis the cartesian product collapses along: one "iPhone 17 Pro Max"
 * standing for the ten runtimes it is installed for.
 */
export function deviceModel(device: IosSimulatorDevice): string {
  const tail = device.deviceTypeIdentifier?.split('.').pop()
  return tail ? tail.replace(/-/g, ' ') : device.name
}

/**
 * Newest runtime first, as a sortable number.
 *
 * `iOS-26-4` and `iOS-17-10` have to order by version rather than by string, or a
 * bare model name resolves to a four-year-old runtime that merely sorts late.
 */
export function runtimeRank(device: IosSimulatorDevice): number {
  const tail = device.runtimeIdentifier.split('.').pop() ?? ''
  const parts = tail.match(/\d+/g)?.map(Number) ?? []
  return (parts[0] ?? 0) * 10_000 + (parts[1] ?? 0) * 100 + (parts[2] ?? 0)
}

/**
 * Running devices first, then by name.
 *
 * Not cosmetic: attaching to a running simulator is free, while a cold one spends
 * ~20s booting. Putting the cheap choice at the top is the difference between the
 * obvious pick being instant and the obvious pick being a wait.
 */
export function orderDevices(devices: IosSimulatorDevice[]): IosSimulatorDevice[] {
  return [...devices].sort((a, b) => {
    if (a.booted !== b.booted) return a.booted ? -1 : 1
    const byName = a.name.localeCompare(b.name)
    if (byName !== 0) return byName
    // Same model on several runtimes: newest wins. This is what a bare model name
    // resolves to, and "iPhone 17 Pro Max" meaning the iOS 17.0 one would be a
    // surprise the user only discovers after approving the prompt.
    return runtimeRank(b) - runtimeRank(a)
  })
}

/** Only devices that can actually be booted — an uninstalled runtime is not an option. */
export function offerableDevices(devices: IosSimulatorDevice[]): IosSimulatorDevice[] {
  return orderDevices(devices.filter((device) => device.available))
}

export function toDeviceEntry(device: IosSimulatorDevice, sessionId: string): DeviceEntry {
  return {
    id: device.udid,
    name: device.name,
    platform: device.runtimeName,
    running: device.booted,
    ...(device.boundSessionId && device.boundSessionId !== sessionId ? { busy: true } : {}),
    ...(device.boundSessionId === sessionId ? { controlled: true } : {}),
  }
}

/**
 * Resolve the handle the agent quoted.
 *
 * Matched loosely on purpose. The id from `device_list` is the exact path, but the
 * agent also writes from what the user said in chat ("the 17 Pro Max"), and the cost
 * of a loose match is only which device a prompt the user still has to approve names.
 */
export function resolveDevice(
  devices: IosSimulatorDevice[],
  ref: string | undefined,
): IosSimulatorDevice | null {
  if (!ref) return null
  const needle = ref.trim().toLowerCase()
  if (!needle) return null
  const byUdid = devices.find((device) => device.udid.toLowerCase() === needle)
  if (byUdid) return byUdid
  const byName = devices.find((device) => device.name.toLowerCase() === needle)
  if (byName) return byName
  return devices.find((device) => {
    const haystack = `${device.name} ${device.runtimeName}`.toLowerCase()
    return haystack.includes(needle) || needle.includes(device.name.toLowerCase())
  }) ?? null
}

/** What the agent asked for. Absent fields mean the overview. */
export interface DeviceListRequest {
  kind?: string
  model?: string
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function controlledSummary(device: IosSimulatorDevice | null): Record<string, string> | null {
  return device ? { id: device.udid, name: device.name, platform: device.runtimeName } : null
}

/** Tier 2 — one model's devices, one per runtime, newest first. These carry the ids. */
function modelTier(
  offerable: IosSimulatorDevice[],
  sessionId: string,
  model: string,
): Record<string, unknown> {
  const needle = normalize(model)
  const matched = offerable.filter((device) => {
    const haystack = normalize(`${deviceModel(device)} ${device.name}`)
    return haystack.includes(needle)
  })
  if (matched.length === 0) {
    return {
      model,
      devices: [],
      note: `No model matches "${model}". Call device_list with no arguments for the kinds, `
        + 'or with kind to see that kind\'s models.',
    }
  }
  const resolved = deviceModel(matched[0]!)
  return {
    model: resolved,
    devices: [...matched].sort((a, b) => runtimeRank(b) - runtimeRank(a)).map((device) => {
      // The model is already the heading, so the name is dropped unless the simulator
      // was renamed — repeating it on every row is what made this list expensive.
      const { name, ...entry } = toDeviceEntry(device, sessionId)
      return name === resolved ? entry : { ...entry, name }
    }),
    note: 'Quote an id in device_request_control. The user still has to approve it.',
  }
}

/** Tier 1 — the models of one kind, without ids: a model is not yet a device. */
function kindTier(
  offerable: IosSimulatorDevice[],
  kind: DeviceKind,
): Record<string, unknown> {
  const mine = offerable.filter((device) => deviceKind(device) === kind)
  const byModel = new Map<string, IosSimulatorDevice[]>()
  for (const device of mine) {
    const model = deviceModel(device)
    byModel.set(model, [...(byModel.get(model) ?? []), device])
  }
  const models: DeviceModelSummary[] = [...byModel.entries()]
    .map(([model, devices]) => {
      const newest = [...devices].sort((a, b) => runtimeRank(b) - runtimeRank(a))[0]!
      const running = devices.filter((device) => device.booted).length
      return {
        model,
        devices: devices.length,
        latest: newest.runtimeName,
        ...(running > 0 ? { running } : {}),
      }
    })
    .sort((a, b) => a.model.localeCompare(b.model))

  return {
    kind,
    name: KIND_NAMES.get(kind) ?? kind,
    models,
    note: models.length === 0
      ? 'No devices of that kind. Call device_list with no arguments for the kinds that exist.'
      : 'Call device_list with model to get ids, or name the model directly in '
        + 'device_request_control to take its newest runtime.',
  }
}

/** Tier 0 — what is running, what this project used before, and what kinds exist. */
function overviewTier(
  offerable: IosSimulatorDevice[],
  sessionId: string,
  recentUdids: string[],
  controlled: Record<string, string> | null,
): Record<string, unknown> {
  const running = offerable.filter((device) => device.booted)
  const runningIds = new Set(running.map((device) => device.udid))
  // Recents that are still installed and not already named above. A device that is
  // both recent and running is worth exactly one row, in the more urgent list.
  const recent = recentUdids
    .flatMap((udid) => {
      const device = offerable.find((entry) => entry.udid === udid)
      return device && !runningIds.has(udid) ? [device] : []
    })

  const kinds: DeviceKindSummary[] = KINDS
    .map(({ kind, name }) => {
      const mine = offerable.filter((device) => deviceKind(device) === kind)
      return { kind, name, models: new Set(mine.map(deviceModel)).size, devices: mine.length }
    })
    .filter((entry) => entry.devices > 0)

  return {
    controlled,
    running: running.map((device) => toDeviceEntry(device, sessionId)),
    ...(recent.length > 0 ? { recent: recent.map((device) => toDeviceEntry(device, sessionId)) } : {}),
    kinds,
    total: offerable.length,
    note: controlled
      ? 'This session already controls a device; the other device tools are ready. '
        + 'Call device_request_control only to switch to a different one.'
      : running.length > 0 || recent.length > 0
        ? 'Prefer a device listed above — running ones attach instantly, and a cold boot costs ~20s. '
          + 'Otherwise call device_list with kind to browse models.'
        : 'Call device_list with kind (e.g. "iphone") for its models, then with model for ids. '
          + 'Nothing is under this session\'s control until the user approves a request.',
  }
}

/** `device_list` — one tier of the catalog, plus what this session already holds. */
export async function listDeviceCatalog(options: {
  sessionId: string
  port: DeviceCatalogPort
  request?: DeviceListRequest
  recents?: DeviceRecentsPort
}): Promise<Record<string, unknown>> {
  const { sessionId, port, request = {}, recents = NO_DEVICE_RECENTS } = options
  // Sequential on purpose: `getSessionState` reads the catalog itself when it is not
  // handed one, so running the two in parallel spawned `simctl list devices` twice.
  const devices = await port.listDevices()
  const state = await port.getSessionState(sessionId, devices)
  const offerable = offerableDevices(devices)
  const controlled = controlledSummary(state.phase === 'ready' && state.device ? state.device : null)

  if (offerable.length === 0) {
    return {
      controlled,
      running: [],
      kinds: [],
      total: 0,
      note: devices.length === 0
        ? 'No simulators exist on this machine. Create one in Xcode (or the Activity panel) first.'
        : 'Every simulator on this machine is unavailable — its runtime is probably not installed.',
    }
  }

  if (request.model) return modelTier(offerable, sessionId, request.model)
  if (request.kind) {
    const kind = KINDS.find((entry) => entry.kind === normalize(request.kind!))?.kind
    if (!kind) {
      return {
        kind: request.kind,
        models: [],
        note: `Unknown kind "${request.kind}". Call device_list with no arguments to see which exist.`,
      }
    }
    return kindTier(offerable, kind)
  }
  return overviewTier(offerable, sessionId, recents.read(), controlled)
}
