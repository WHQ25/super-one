import { describe, expect, it } from 'vitest'
import {
  DEV_VARIANT_ID,
  isVariantId,
  resolveVariantId,
  VARIANTS,
  variant,
  variantId,
  variantScopedId,
} from './variant'

describe('resolveVariantId', () => {
  it('takes the packaged variant field when it names a known variant', () => {
    expect(resolveVariantId('stable')).toBe('stable')
    expect(resolveVariantId('alpha')).toBe('alpha')
  })

  it('falls back to the dev variant for an unpackaged launch', () => {
    // A packaged build always carries the field, so a miss means dev/e2e —
    // not a broken release. Crashing here would brick a shipped app for a
    // condition that can only happen outside packaging.
    expect(resolveVariantId(undefined)).toBe(DEV_VARIANT_ID)
    expect(resolveVariantId('nightly')).toBe(DEV_VARIANT_ID)
    expect(resolveVariantId(42)).toBe(DEV_VARIANT_ID)
  })
})

describe('isVariantId', () => {
  it('accepts declared variants and rejects anything else', () => {
    expect(isVariantId('stable')).toBe(true)
    expect(isVariantId('beta')).toBe(false)
    expect(isVariantId(null)).toBe(false)
  })
})

describe('variant identity table', () => {
  const entries = Object.entries(VARIANTS)

  // Two variants must be installable side by side. Each of these is a separate
  // identity chain in electron-builder — appId drives OS registration,
  // productName drives app.name (logs, safeStorage), packageName drives the
  // NSIS install dir and the updater cache dir. A shared value in any one of
  // them makes the two builds overwrite each other.
  it.each(['appId', 'productName', 'packageName', 'executableName', 'dataDirName', 'downloadPrefix'])(
    'gives every variant a distinct %s',
    (field) => {
      const values = entries.map(([, v]) => v[field as keyof typeof v])
      expect(new Set(values).size).toBe(entries.length)
    },
  )

  it('gives every variant a distinct prerelease tag so a version implies one variant', () => {
    const tags = entries.map(([, v]) => v.prereleaseTag)
    expect(new Set(tags).size).toBe(entries.length)
  })

  it('keeps packageName free of characters that break NSIS and AppImage paths', () => {
    for (const [, v] of entries) {
      expect(v.packageName).toMatch(/^[a-z0-9][a-z0-9-]*$/)
      expect(v.executableName).toMatch(/^[a-z0-9][a-z0-9-]*$/)
    }
  })
})

describe('runtime lookup', () => {
  it('reports the dev variant when there is no packaged package.json', () => {
    expect(variantId()).toBe(DEV_VARIANT_ID)
    expect(variant().appId).toBe(VARIANTS[DEV_VARIANT_ID].appId)
  })

  it('scopes sidecar ids under the variant appId', () => {
    expect(variantScopedId('computer-use')).toBe(`${VARIANTS[DEV_VARIANT_ID].appId}.computer-use`)
  })
})
