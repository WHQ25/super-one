import type { DeviceDescriptor, DevicePlatform, DeviceProvider } from '@superone/shared/device'

/**
 * The flat device list, rebuilt into the tiers the picker asks for: family, then
 * model, then version.
 *
 * Nothing here classifies anything. `kind`, `kindName`, `kindRank`, `model` and
 * `versionRank` are all computed by the platform that owns the device and carried on
 * the descriptor — see `DeviceDescriptor` — which is precisely what lets one set of
 * tiers serve simctl's model × runtime matrix and a list of AVDs without either
 * platform learning the other's vocabulary. iOS says `iphone`, Android says `phone`,
 * and this file never has to know those are the same idea.
 *
 * The depth is therefore data too. On iOS one "iPhone 17 Pro Max" stands for the ten
 * runtimes it is installed for, so its model tier fans out; an AVD is its own model,
 * so the same tier collapses to a single row and the menu is simply shallower. No
 * branch expresses that — it falls out of how many devices share a `model`.
 */

/**
 * Provider order in the menu, matching the order the ports are registered in.
 *
 * Keyed on PROVIDER rather than platform, because provider is the axis a reader has
 * to tell apart. Two providers now serve iOS — a simulator and a real phone mirrored
 * from this Mac — and grouping by platform put both under one "iPhone" heading, where
 * the only thing distinguishing a real device from a simulator was that its row
 * happened to be named "iPhone" rather than "iPhone 17 Pro Max". Choosing the wrong
 * one of those is not a small mistake: one of them belongs to somebody.
 */
const PROVIDER_ORDER: readonly DeviceProvider[] = ['ios-sim', 'android', 'ios-mirror']

export interface DeviceCatalogModel {
  name: string
  /** Every version of this model, newest first. */
  devices: DeviceDescriptor[]
}

export interface DeviceCatalogFamily {
  /** `${provider}:${kind}` — unique, which `kind` and `${platform}:${kind}` are not. */
  id: string
  provider: DeviceProvider
  platform: DevicePlatform
  /** The platform's own slug: `iphone`, `phone`, `tablet`. Drives the icon. */
  kind: string
  label: string
  models: DeviceCatalogModel[]
}

function providerRank(provider: DeviceProvider): number {
  const index = PROVIDER_ORDER.indexOf(provider)
  return index === -1 ? PROVIDER_ORDER.length : index
}

/** Newest version first among devices of one model. Ties fall back to the name. */
function byVersionDescending(a: DeviceDescriptor, b: DeviceDescriptor): number {
  return b.versionRank - a.versionRank
    || a.platformVersion.localeCompare(b.platformVersion, undefined, { numeric: true })
}

/**
 * Group into family → model → version.
 *
 * Unavailable devices are dropped outright rather than listed as disabled. A runtime
 * whose profile Xcode never finished downloading cannot be booted, and neither can a
 * phone that has not accepted its USB debugging prompt — a menu of rows that refuse
 * to be clicked reads as a broken menu. The panel says so in words instead.
 */
export function buildDeviceCatalog(devices: DeviceDescriptor[]): DeviceCatalogFamily[] {
  const families = new Map<string, {
    provider: DeviceProvider
    platform: DevicePlatform
    kind: string
    label: string
    kindRank: number
    models: Map<string, DeviceDescriptor[]>
  }>()

  for (const device of devices) {
    if (!device.available) continue
    const id = `${device.provider}:${device.kind}`
    const family = families.get(id) ?? {
      provider: device.provider,
      platform: device.platform,
      kind: device.kind,
      label: device.kindName,
      kindRank: device.kindRank,
      models: new Map<string, DeviceDescriptor[]>(),
    }
    families.set(id, family)
    family.models.set(device.model, [...(family.models.get(device.model) ?? []), device])
  }

  return [...families.entries()]
    .sort(([, a], [, b]) =>
      providerRank(a.provider) - providerRank(b.provider) || a.kindRank - b.kindRank)
    .map(([id, family]) => ({
      id,
      provider: family.provider,
      platform: family.platform,
      kind: family.kind,
      label: family.label,
      models: [...family.models.entries()]
        .map(([model, entries]) => ({
          // Grouped by model, labelled by name — they differ once a device has been
          // renamed, and the name is the thing the person who renamed it will look
          // for. Falls back to the model when the entries disagree, which is what a
          // model installed for several runtimes and renamed on only one looks like.
          name: entries.every((entry) => entry.name === entries[0]!.name)
            ? entries[0]!.name
            : model,
          devices: [...entries].sort(byVersionDescending),
        }))
        // Ranked by their newest version, so a model that only exists on an old OS
        // sinks below one the user can actually target today.
        .sort((a, b) =>
          byVersionDescending(a.devices[0]!, b.devices[0]!)
          || a.name.localeCompare(b.name, undefined, { numeric: true })),
    }))
}
