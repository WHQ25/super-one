import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import {
  downloadPlatformFor,
  fixedDownloadUrl,
  type DownloadArch,
} from '@superone/shared/download-links'
import VARIANTS from '../../variants.json'

/**
 * Which of the side-by-side apps this process is.
 *
 * The variant is decided at package time by `electron-builder.config.cjs`,
 * which writes it into the packaged `package.json` via `extraMetadata`. It is
 * deliberately NOT derived from the version string: "which app am I" and
 * "which version am I" are orthogonal, and coupling them breaks the moment a
 * stable build carries an `-rc` tag.
 */
export type VariantId = keyof typeof VARIANTS
export type VariantIdentity = (typeof VARIANTS)[VariantId]

/**
 * Unpackaged runs (`bun run dev`, e2e against `out/`) are the dev app.
 *
 * They cannot actually take its bundle id -- macOS reads that from
 * `node_modules/electron/dist/Electron.app` at launch and Electron has no
 * runtime override -- but everything SuperOne itself controls (profile, harness
 * root, Computer Use helper) should be the dev identity rather than borrowing
 * the shipping alpha app's.
 */
export const DEV_VARIANT_ID: VariantId = 'dev'

export function isVariantId(value: unknown): value is VariantId {
  return typeof value === 'string' && Object.hasOwn(VARIANTS, value)
}

/**
 * Pure resolution, split out so tests do not need a packaged app. A packaged
 * build always has the field (the builder config writes it unconditionally),
 * so a miss means an unpackaged launch rather than a broken release.
 */
export function resolveVariantId(packagedVariant: unknown): VariantId {
  return isVariantId(packagedVariant) ? packagedVariant : DEV_VARIANT_ID
}

interface PackagedFields {
  variant?: unknown
  macKeychainAccessGroup?: unknown
}

let cachedPackaged: PackagedFields | null = null

/** Fields electron-builder.config.cjs merges into the packaged package.json. */
function packagedFields(): PackagedFields {
  if (cachedPackaged) return cachedPackaged
  try {
    cachedPackaged = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as PackagedFields
  } catch {
    cachedPackaged = {}
  }
  return cachedPackaged
}

let cachedId: VariantId | null = null

export function variantId(): VariantId {
  cachedId ??= resolveVariantId(packagedFields().variant)
  return cachedId
}

/**
 * Keychain access group the browser's Touch ID passkey authenticator stores
 * under, or null when this build carries no provisioning profile (then the
 * authenticator must stay off: the group is a restricted entitlement, and
 * only profile-backed builds are signed with it). Written at package time by
 * build/mac-signing.cjs from the profile's team, so the team id never lives
 * in source and a fork signs with its own.
 */
export function macKeychainAccessGroup(): string | null {
  const value = packagedFields().macKeychainAccessGroup
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Bundle identifier of the running .app, read from its own Info.plist. Null
 * when unpackaged (Electron.app) or off macOS. Pure parse, exported for tests.
 */
export function parseBundleIdentifier(infoPlistXml: string): string | null {
  const match = infoPlistXml.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/)
  return match ? match[1].trim() : null
}

let cachedBundleId: string | null | undefined

export function macBundleIdentifier(): string | null {
  if (cachedBundleId !== undefined) return cachedBundleId
  if (process.platform !== 'darwin' || !app.isPackaged) return (cachedBundleId = null)
  try {
    // app.getAppPath() is <bundle>/Contents/Resources/app.asar
    cachedBundleId = parseBundleIdentifier(readFileSync(resolve(app.getAppPath(), '..', '..', 'Info.plist'), 'utf8'))
  } catch {
    cachedBundleId = null
  }
  return cachedBundleId
}

/**
 * True when this process runs under the variant's *retired* macOS bundle id.
 *
 * The bundle id moved (`legacyMacAppId` → `macAppId`) because restricted
 * entitlements need a provisioning profile and the old id is registered to
 * another Apple team. Squirrel.Mac verifies updates against the running app's
 * designated requirement, which names the old id, so the last old-id release
 * is a "bridge": it is packaged with SUPERONE_MAC_BRIDGE=1, keeps the legacy id,
 * turns its updater off and asks the user to install the new-id build by hand.
 * See mac-identity-migration.ts and docs/agent-reference/packaging.md.
 */
export function isRetiredMacBundle(): boolean {
  const id = macBundleIdentifier()
  return id !== null && id === variant().legacyMacAppId && id !== variant().macAppId
}

export function variant(): VariantIdentity {
  return VARIANTS[variantId()]
}

/**
 * Bundle id for a sidecar that must be distinguishable per variant (helper
 * apps, LaunchAgent labels). Derived so adding a variant never needs a new
 * table entry.
 */
export function variantScopedId(suffix: string): string {
  return `${variant().appId}.${suffix}`
}

export { VARIANTS }

/**
 * Direct installer link for a variant on THIS machine.
 *
 * Settings offers the Alpha build from the stable app. It cannot send the user
 * to the marketing site for it: that site publishes the stable app only, so the
 * link would advertise Alpha and hand over stable. Going straight at the fixed
 * R2 link also means the right platform and architecture with no page in
 * between -- both of which this process already knows.
 */
export type PublishedVariantId = {
  [K in VariantId]: (typeof VARIANTS)[K]['downloadPrefix'] extends null ? never : K
}[VariantId]

export function variantDownloadUrl(id: PublishedVariantId): string {
  const target = VARIANTS[id]
  return fixedDownloadUrl({
    downloadPrefix: target.downloadPrefix,
    artifactBaseName: target.artifactBaseName,
    prereleaseTag: target.prereleaseTag,
    platform: downloadPlatformFor(process.platform),
    arch: process.arch === 'x64' ? 'x64' : ('arm64' as DownloadArch),
  })
}

/**
 * Which harness manifest this app reads.
 *
 * `dev` is built from the same tree as `alpha` and never publishes one of its
 * own, so it shares alpha's. Mapped explicitly rather than derived from the
 * version string -- that derivation is for consumers with no variant.
 */
export function harnessManifestChannelForVariant(): 'alpha' | 'stable' {
  return variantId() === 'stable' ? 'stable' : 'alpha'
}
