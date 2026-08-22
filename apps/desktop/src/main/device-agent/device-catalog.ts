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
 *
 * Every platform is answered through the same tiers, but each classifies its own
 * devices (see `DeviceDescriptor.kind` / `model` / `versionRank`). That is what lets
 * one set of grouping rules serve a platform whose catalog is a model x runtime
 * matrix and one whose "catalog" is four AVDs, without either pretending to be the
 * other. When more than one platform has devices, rows say which — and when only one
 * does, they do not, because a column that always reads `ios` is pure cost.
 */

import { normalizeDeviceId } from '@superone/shared/device'
import type { DeviceDescriptor, DevicePlatform } from '@superone/shared/device'
import { offerableDevices, type DevicePlatformPort } from '../device/platform-port'
import { NO_DEVICE_RECENTS, type DeviceRecentsPort } from './device-recents'

export { offerableDevices, resolveDevice } from '../device/platform-port'

/**
 * One device as the agent sees it.
 *
 * Deliberately not `DeviceDescriptor`: this shape crosses to the model, so it carries
 * only what a choice needs and drops the classification fields the tiers used to get
 * here.
 */
export interface DeviceEntry {
  /** Stable handle to quote back in `device_request_control`. */
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
  kind: string
  name: string
  models: number
  devices: number
  /** Only when more than one platform has devices. See the module note. */
  platform?: DevicePlatform
}

/** One model within a kind, as the second tier offers it. */
export interface DeviceModelSummary {
  model: string
  /** How many runtimes this model is installed for — how many ids the next tier holds. */
  devices: number
  /** Newest runtime available for it, which is what a bare model name resolves to. */
  latest: string
  running?: number
  platform?: DevicePlatform
}

export function toDeviceEntry(device: DeviceDescriptor, sessionId: string): DeviceEntry {
  return {
    id: device.id,
    name: device.name,
    platform: device.platformVersion,
    running: device.running,
    ...(device.boundSessionId && device.boundSessionId !== sessionId ? { busy: true } : {}),
    ...(device.boundSessionId === sessionId ? { controlled: true } : {}),
  }
}

/** What the agent asked for. Absent fields mean the overview. */
export interface DeviceListRequest {
  kind?: string
  model?: string
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function controlledSummary(device: DeviceDescriptor | null): Record<string, string> | null {
  return device
    ? { id: device.id, name: device.name, platform: device.platformVersion }
    : null
}

/**
 * Everything on offer, across every platform, plus what this session already holds.
 *
 * Read once and passed down, because each port's `listDevices` is a process spawn —
 * `simctl list devices` or `adb devices` — and every tier needs the same answer.
 */
interface CatalogRead {
  offerable: DeviceDescriptor[]
  /** Installed but filtered out as unavailable, per platform. Drives the empty note. */
  installed: number
  controlled: DeviceDescriptor | null
  /** True when more than one platform contributed a device. */
  multiPlatform: boolean
  ports: readonly DevicePlatformPort[]
}

async function readCatalog(
  sessionId: string,
  ports: readonly DevicePlatformPort[],
): Promise<CatalogRead> {
  const all: DeviceDescriptor[] = []
  let controlled: DeviceDescriptor | null = null
  // Sequential per port on purpose: a port's `controlled` reads the catalog itself
  // when it is not handed one, so running the two in parallel spawns the enumeration
  // twice. Across ports it would be safe to parallelize, but the win is one process
  // on a machine that usually has exactly one platform installed.
  for (const port of ports) {
    const devices = await port.listDevices()
    all.push(...devices)
    const held = await port.controlled(sessionId, devices)
    if (held) controlled = held
  }
  const offerable = offerableDevices(all)
  const platforms = new Set(offerable.map((device) => device.platform))
  return {
    offerable,
    installed: all.length,
    controlled,
    multiPlatform: platforms.size > 1,
    ports,
  }
}

/** Tier 2 — one model's devices, one per runtime, newest first. These carry the ids. */
function modelTier(read: CatalogRead, sessionId: string, model: string): Record<string, unknown> {
  const needle = normalize(model)
  const matched = read.offerable.filter((device) => {
    const haystack = normalize(`${device.model} ${device.name}`)
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
  const resolved = matched[0]!.model
  return {
    model: resolved,
    devices: [...matched].sort((a, b) => b.versionRank - a.versionRank).map((device) => {
      // The model is already the heading, so the name is dropped unless the device
      // was renamed — repeating it on every row is what made this list expensive.
      const { name, ...entry } = toDeviceEntry(device, sessionId)
      const platform = read.multiPlatform ? { platform: device.platform } : {}
      return name === resolved ? { ...entry, ...platform } : { ...entry, name, ...platform }
    }),
    note: 'Quote an id in device_request_control. The user still has to approve it.',
  }
}

/** Tier 1 — the models of one kind, without ids: a model is not yet a device. */
function kindTier(read: CatalogRead, kind: string): Record<string, unknown> {
  const mine = read.offerable.filter((device) => normalize(device.kind) === normalize(kind))
  const byModel = new Map<string, DeviceDescriptor[]>()
  for (const device of mine) {
    byModel.set(device.model, [...(byModel.get(device.model) ?? []), device])
  }
  const models: DeviceModelSummary[] = [...byModel.entries()]
    .map(([model, devices]) => {
      const newest = [...devices].sort((a, b) => b.versionRank - a.versionRank)[0]!
      const running = devices.filter((device) => device.running).length
      return {
        model,
        devices: devices.length,
        latest: newest.platformVersion,
        ...(running > 0 ? { running } : {}),
        ...(read.multiPlatform ? { platform: newest.platform } : {}),
      }
    })
    .sort((a, b) => a.model.localeCompare(b.model))

  return {
    kind,
    name: mine[0]?.kindName ?? kind,
    models,
    note: models.length === 0
      ? 'No devices of that kind. Call device_list with no arguments for the kinds that exist.'
      : 'Call device_list with model to get ids, or name the model directly in '
        + 'device_request_control to take its newest runtime.',
  }
}

/** Tier 0 — what is running, what this project used before, and what kinds exist. */
function overviewTier(
  read: CatalogRead,
  sessionId: string,
  recentIds: string[],
): Record<string, unknown> {
  const { offerable, multiPlatform } = read
  const running = offerable.filter((device) => device.running)
  const runningIds = new Set(running.map((device) => device.id))
  // Recents that are still installed and not already named above. A device that is
  // both recent and running is worth exactly one row, in the more urgent list.
  const recent = recentIds.flatMap((id) => {
    const device = offerable.find((entry) => entry.id === id)
    return device && !runningIds.has(id) ? [device] : []
  })

  // Grouped by family, then ordered the way each platform orders ITS OWN families —
  // iPhone before iPad before Apple Watch is an editorial choice, not alphabetical
  // and not by count, so it rides on the descriptor rather than being reconstructed
  // here. Platforms keep the order they were registered in.
  const platformOrder = new Map(read.ports.map((port, index) => [port.platform, index] as const))
  const families = new Map<string, { devices: DeviceDescriptor[]; sort: [number, number] }>()
  for (const device of offerable) {
    const key = multiPlatform ? `${device.platform}/${device.kind}` : device.kind
    const family = families.get(key)
    if (family) {
      family.devices.push(device)
      continue
    }
    families.set(key, {
      devices: [device],
      sort: [platformOrder.get(device.platform) ?? 0, device.kindRank],
    })
  }
  const kinds: DeviceKindSummary[] = [...families.values()]
    .sort((a, b) => (a.sort[0] - b.sort[0]) || (a.sort[1] - b.sort[1]))
    .map(({ devices }) => {
      const first = devices[0]!
      return {
        kind: first.kind,
        name: first.kindName,
        models: new Set(devices.map((device) => device.model)).size,
        devices: devices.length,
        ...(multiPlatform ? { platform: first.platform } : {}),
      }
    })

  const controlled = controlledSummary(read.controlled)
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

/**
 * Recents were stored as bare native handles before ids carried a platform.
 *
 * Normalized on read rather than migrated: it is a hint living in `app_meta`, and a
 * one-line read fixup is cheaper than a schema migration for something whose worst
 * failure is one extra tool call. Anything unprefixed predates the change and can
 * only have been a simulator.
 */
/** `device_list` — one tier of the catalog, plus what this session already holds. */
export async function listDeviceCatalog(options: {
  sessionId: string
  ports: readonly DevicePlatformPort[]
  request?: DeviceListRequest
  recents?: DeviceRecentsPort
}): Promise<Record<string, unknown>> {
  const { sessionId, ports, request = {}, recents = NO_DEVICE_RECENTS } = options
  const read = await readCatalog(sessionId, ports)

  if (read.offerable.length === 0) {
    return {
      controlled: controlledSummary(read.controlled),
      running: [],
      kinds: [],
      total: 0,
      // Each platform explains its own emptiness — "create one in Xcode" and "create
      // one in Android Studio" are different instructions, and a generic line would
      // help with neither.
      note: ports.map((port) => port.emptyNote(read.installed)).join(' '),
    }
  }

  if (request.model) return modelTier(read, sessionId, request.model)
  if (request.kind) {
    const known = read.offerable.some((device) => normalize(device.kind) === normalize(request.kind!))
    if (!known) {
      return {
        kind: request.kind,
        models: [],
        note: `Unknown kind "${request.kind}". Call device_list with no arguments to see which exist.`,
      }
    }
    return kindTier(read, request.kind)
  }
  return overviewTier(read, sessionId, recents.read().map(normalizeDeviceId))
}
