/**
 * What Android has to offer, assembled from two sources that each know half of it.
 *
 * `emulator -list-avds` knows every AVD installed, including the ones that are not
 * running — which is most of them, and the ones a user most needs to see. `adb
 * devices` knows what is actually up, including cable-attached phones the AVD list
 * has never heard of. Neither alone is the catalog.
 *
 * The join between them is the interesting part: a booted AVD appears in BOTH, once
 * as `Medium_Phone_API_36.1` and once as `emulator-5554`, and listing it twice would
 * offer the user the same device under two names — one of which boots a second copy.
 * `adb -s emulator-5554 emu avd name` is what ties them together.
 */

import { formatDeviceId, type DeviceDescriptor } from '@superone/shared/device'
import type { AdbDevice } from './adb'
import type { AvdSummary } from './avd'
import { androidVersionName } from './android-version'

/**
 * Families, in the order the catalog should offer them.
 *
 * Phones first for the same reason iPhone comes before iPad: it is what almost
 * everyone is looking for. The order is editorial and rides on the descriptor as
 * `kindRank` — see `DeviceDescriptor`.
 *
 * Every display name names the platform, because the picker is not a list of Android
 * devices — it is one list holding every platform this Mac can reach. A heading of
 * "Phone" sitting under one that says "iPhone" tells the reader nothing about which
 * is which; "Android Phone" does. The `kind` slugs stay in Android's own vocabulary
 * (`phone`, not `iphone`) exactly as `DeviceDescriptor` requires — this is the label,
 * not the classification.
 */
const KINDS: Array<{ kind: string; name: string; match: RegExp }> = [
  { kind: 'phone', name: 'Android Phone', match: /phone|pixel|nexus|galaxy/i },
  { kind: 'tablet', name: 'Android Tablet', match: /tablet|pad/i },
  { kind: 'foldable', name: 'Android Foldable', match: /fold|flip/i },
  // Already unambiguous, and Google's own product names besides — "Android Wear OS"
  // is not a thing anyone writes.
  { kind: 'wear', name: 'Wear OS', match: /wear|watch/i },
  { kind: 'tv', name: 'Android TV', match: /\btv\b|television/i },
  // Both anchored at a word start. Unanchored, `car` matches the `car` inside
  // `nosdcard` — which is what `ro.build.characteristics` reads on a great many
  // ordinary phones, every one of which was then filed under Android Auto.
  { kind: 'auto', name: 'Android Auto', match: /\bauto|\bcar\b/i },
  { kind: 'desktop', name: 'Android Desktop', match: /desktop|freeform/i },
]

const OTHER = { kind: 'other', name: 'Other Android', rank: KINDS.length }

/**
 * Classify from whatever text describes the hardware.
 *
 * For an AVD that is `hw.device.name` (`medium_phone`, `pixel_tablet`, `tv_1080p`);
 * for a real device it is `ro.build.characteristics` plus the model. Both are
 * free-form, so this matches rather than looks up — and answers `phone` for anything
 * unrecognized, since that is what an unlabelled Android device overwhelmingly is.
 * Only a device that described itself with NOTHING is filed under other: a phone
 * announces itself as `nosdcard` or `default`, which name a handset by saying nothing
 * interesting, while an empty string means the read failed and there is no fact here
 * to guess from.
 */
export function androidKind(subject: string): { kind: string; name: string; rank: number } {
  // Underscores become spaces first, because AVD profiles use them as the word
  // separator and `\b` does not: `_` is a word character, so `\btv\b` does not match
  // `tv_1080p`. Normalizing the input once beats making every pattern above account
  // for it.
  const text = subject.replace(/_/g, ' ')
  // Ordered scan, not a find over the whole list: a device profile reading
  // "pixel_fold" matches both `phone` (via `pixel`) and `foldable`, and the more
  // specific answer is the useful one. Foldable is therefore checked before the
  // generic handset patterns can claim it.
  const specific = KINDS.slice(1).find((entry) => entry.match.test(text))
  if (specific) return { kind: specific.kind, name: specific.name, rank: KINDS.indexOf(specific) }
  const phone = KINDS[0]!
  if (phone.match.test(text)) return { kind: phone.kind, name: phone.name, rank: 0 }
  // A real phone's model is a vendor part number — `2410DPN6CC`, `SM-S928B` — which
  // shares no vocabulary with the AVD profile names the patterns above were built
  // from. Falling through to `other` put every non-Pixel handset on the machine in a
  // trailing bucket of its own, which is worse than the occasional miscall.
  return text.trim() ? { kind: phone.kind, name: phone.name, rank: 0 } : OTHER
}

/** Handle for an AVD. Stable across boots, unlike the `emulator-5554` port it gets. */
export function avdDeviceId(avdId: string): string {
  return formatDeviceId('android', `avd:${avdId}`)
}

/** Handle for a device adb sees directly — a phone, or an emulator with no AVD name. */
export function serialDeviceId(serial: string): string {
  return formatDeviceId('android', serial)
}

/** What a running device told us about itself, when it was reachable enough to ask. */
export interface AndroidRuntimeInfo {
  serial: string
  /** `Medium_Phone_API_36.1` for an emulator; absent for a physical device. */
  avdId?: string
  /** `ro.build.version.sdk`. */
  apiLevel?: number
  /** `ro.product.model`. A vendor part number on most phones: `2410DPN6CC`. */
  model?: string
  /**
   * The name printed on the box, when the vendor records one anywhere.
   *
   * Android defines no standard property for it — `ro.product.model` is the closest
   * thing the platform has, and on everything but a Pixel it holds a part number.
   * See `MARKET_NAME_PROPS` for where this is read from.
   */
  marketName?: string
  /** `ro.build.characteristics` — `emulator`, `tablet`, `tv`, `nosdcard,emulator`. */
  characteristics?: string
}

function descriptorForAvd(
  avd: AvdSummary,
  running: AndroidRuntimeInfo | undefined,
  owners: ReadonlyMap<string, string>,
): DeviceDescriptor {
  const { kind, name, rank } = androidKind(`${avd.deviceProfile} ${avd.displayName}`)
  const id = avdDeviceId(avd.id)
  // A running device reports its real API level; an AVD config only claims one. They
  // agree in practice, but the running one is the fact.
  const apiLevel = running?.apiLevel ?? avd.apiLevel
  return {
    id,
    provider: 'android',
    platform: 'android',
    name: avd.displayName,
    kind,
    kindName: name,
    kindRank: rank,
    // An AVD is its own model: unlike iOS, there is no matrix of one device across ten
    // runtimes to collapse, so the model tier is simply shallow rather than absent.
    model: avd.displayName,
    platformVersion: androidVersionName(apiLevel),
    // Nothing to rank against within a model, since each AVD stands alone. The API
    // level keeps the ordering sane if two AVDs ever share a display name.
    versionRank: apiLevel,
    running: Boolean(running),
    available: true,
    ...(owners.get(id) ? { boundSessionId: owners.get(id)! } : {}),
  }
}

function descriptorForPhysical(
  device: AdbDevice,
  info: AndroidRuntimeInfo | undefined,
  owners: ReadonlyMap<string, string>,
): DeviceDescriptor {
  const model = info?.model ?? device.properties.model ?? device.serial
  // Classified on the part number, LABELLED with the market name. Different questions:
  // the classifier wants every scrap of text it can get, while the label wants the one
  // string a person would recognize — and would rather fall back than show both.
  const label = info?.marketName || model
  const { kind, name, rank } = androidKind(`${info?.characteristics ?? ''} ${model}`)
  const id = serialDeviceId(device.serial)
  const apiLevel = info?.apiLevel ?? 0
  return {
    id,
    provider: 'android',
    platform: 'android',
    // Underscores because adb reports `sdk_gphone64_arm64`; nobody writes it that way.
    name: label.replace(/_/g, ' '),
    kind,
    kindName: name,
    kindRank: rank,
    model: label.replace(/_/g, ' '),
    platformVersion: androidVersionName(apiLevel),
    versionRank: apiLevel,
    // It is attached, so it is running by definition — there is nothing to boot.
    running: true,
    // A phone whose debugging prompt has not been accepted answers nothing. Offered
    // but marked unavailable, so the catalog can explain rather than hide it.
    available: device.state === 'device',
    ...(owners.get(id) ? { boundSessionId: owners.get(id)! } : {}),
  }
}

/**
 * Merge both sources into one catalog.
 *
 * `runtime` is keyed by serial and holds whatever could be read off the running
 * devices. It is passed in rather than fetched here so this stays a pure function —
 * the round trips are the caller's problem, and they are what make this slow.
 */
export function mergeAndroidDevices(options: {
  avds: readonly AvdSummary[]
  attached: readonly AdbDevice[]
  runtime: ReadonlyMap<string, AndroidRuntimeInfo>
  owners?: ReadonlyMap<string, string>
}): DeviceDescriptor[] {
  const { avds, attached, runtime, owners = new Map() } = options
  const byAvdId = new Map<string, AndroidRuntimeInfo>()
  for (const info of runtime.values()) {
    if (info.avdId) byAvdId.set(info.avdId, info)
  }

  const devices = avds.map((avd) => descriptorForAvd(avd, byAvdId.get(avd.id), owners))

  // Everything adb sees that is NOT one of the AVDs above: physical phones, and any
  // emulator whose AVD name could not be read (a console that refused, or an AVD
  // deleted while still running).
  const claimed = new Set(
    [...byAvdId.values()]
      .filter((info) => avds.some((avd) => avd.id === info.avdId))
      .map((info) => info.serial),
  )
  for (const device of attached) {
    if (claimed.has(device.serial)) continue
    devices.push(descriptorForPhysical(device, runtime.get(device.serial), owners))
  }
  return devices
}
