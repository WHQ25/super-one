import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
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

/** Unpackaged runs (dev, e2e against `out/`) are alpha-flavoured. */
export const DEV_VARIANT_ID: VariantId = 'alpha'

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

function readPackagedVariantField(): unknown {
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as {
      variant?: unknown
    }
    return pkg.variant
  } catch {
    return undefined
  }
}

let cachedId: VariantId | null = null

export function variantId(): VariantId {
  cachedId ??= resolveVariantId(readPackagedVariantField())
  return cachedId
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
