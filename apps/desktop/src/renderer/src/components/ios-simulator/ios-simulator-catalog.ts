import type { IosSimulatorDevice } from '@superone/shared/ios-simulator'

// simctl hands back one flat row per (model × runtime) pair. The launcher asks the
// user for a family, then a model, then a runtime — so we rebuild that three-level
// shape here rather than scattering the grouping across the component.

export type IosSimulatorFamilyId = 'iphone' | 'ipad' | 'watch' | 'tv' | 'vision' | 'other'

export interface IosSimulatorModel {
  name: string
  /** Every runtime this model is installed for, newest first. */
  devices: IosSimulatorDevice[]
}

export interface IosSimulatorFamily {
  id: IosSimulatorFamilyId
  label: string
  models: IosSimulatorModel[]
}

const FAMILY_LABELS: Record<IosSimulatorFamilyId, string> = {
  iphone: 'iPhone',
  ipad: 'iPad',
  watch: 'Apple Watch',
  tv: 'Apple TV',
  vision: 'Apple Vision',
  other: 'Other',
}

/** The order Apple's own device picker uses, phones first. */
const FAMILY_ORDER = [
  'iphone', 'ipad', 'watch', 'tv', 'vision', 'other',
] as const satisfies readonly IosSimulatorFamilyId[]

/**
 * Matched against the device name first, because that is what the user sees and it
 * survives a rename far less often than the runtime does. `ipad` has to be tested
 * before `iphone` or `iPad` would fall through on the shared `ip` prefix.
 */
const NAME_RULES: readonly (readonly [RegExp, IosSimulatorFamilyId])[] = [
  [/^apple watch/, 'watch'],
  [/^apple tv/, 'tv'],
  [/^apple vision/, 'vision'],
  [/^ipad/, 'ipad'],
  [/^(iphone|ipod)/, 'iphone'],
]

/**
 * The fallback for a renamed simulator: 'My Watch' says nothing, but the runtime it
 * is installed for still does. `xros` is the identifier Apple ships for visionOS.
 */
const RUNTIME_RULES: readonly (readonly [string, IosSimulatorFamilyId])[] = [
  ['watchos', 'watch'],
  ['tvos', 'tv'],
  ['xros', 'vision'],
  ['visionos', 'vision'],
  ['ios', 'iphone'],
]

export function classifyIosSimulatorFamily(device: IosSimulatorDevice): IosSimulatorFamilyId {
  const name = device.name.trim().toLowerCase()
  for (const [pattern, family] of NAME_RULES) {
    if (pattern.test(name)) return family
  }
  const runtime = device.runtimeIdentifier.toLowerCase()
  for (const [token, family] of RUNTIME_RULES) {
    if (runtime.includes(token)) return family
  }
  return 'other'
}

/** Newest runtime first, numerically — 'iOS 26.5' sorts above 'iOS 17.5', not below. */
function compareRuntimesDescending(a: IosSimulatorDevice, b: IosSimulatorDevice): number {
  return b.runtimeName.localeCompare(a.runtimeName, undefined, { numeric: true })
}

/**
 * Groups the flat simctl rows into family → model → runtime.
 *
 * Unavailable devices are dropped outright rather than listed as disabled: a runtime
 * whose profile Xcode never finished downloading cannot be booted at all, and a menu
 * of rows that refuse to be clicked reads as a broken menu.
 */
export function buildIosSimulatorCatalog(devices: IosSimulatorDevice[]): IosSimulatorFamily[] {
  const families = new Map<IosSimulatorFamilyId, Map<string, IosSimulatorDevice[]>>()
  for (const device of devices) {
    if (!device.available) continue
    const familyId = classifyIosSimulatorFamily(device)
    const models = families.get(familyId) ?? new Map<string, IosSimulatorDevice[]>()
    families.set(familyId, models)
    models.set(device.name, [...(models.get(device.name) ?? []), device])
  }

  return FAMILY_ORDER.flatMap((id) => {
    const models = families.get(id)
    if (!models?.size) return []
    return [{
      id,
      label: FAMILY_LABELS[id],
      models: [...models.entries()]
        .map(([name, entries]) => ({
          name,
          devices: [...entries].sort(compareRuntimesDescending),
        }))
        // Models ranked by their newest runtime, so a model that only exists on an
        // old iOS sinks below one the user can actually target today.
        .sort((a, b) =>
          compareRuntimesDescending(a.devices[0]!, b.devices[0]!)
          || a.name.localeCompare(b.name, undefined, { numeric: true })),
    }]
  })
}
