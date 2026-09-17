import { describe, expect, it } from 'vitest'
import {
  DEV_VARIANT_ID,
  isRetiredMacBundle,
  isVariantId,
  macBundleIdentifier,
  macKeychainAccessGroup,
  parseBundleIdentifier,
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
  it.each(['appId', 'macAppId', 'legacyMacAppId', 'productName', 'packageName', 'executableName', 'dataDirName', 'downloadPrefix', 'computerUseBundleId', 'icon'])(
    'gives every variant a distinct %s',
    (field) => {
      const values = entries.map(([, v]) => v[field as keyof typeof v])
      expect(new Set(values).size).toBe(entries.length)
    },
  )

  it('moved every macOS bundle id off the legacy one', () => {
    // `legacyMacAppId` is the id the bridge build still ships under; a variant
    // whose new id equals it would never detect the bridge, and a new id under
    // com.superone.app.* is one we cannot register (another team owns the root).
    for (const [, v] of entries) {
      expect(v.macAppId).not.toBe(v.legacyMacAppId)
      expect(v.macAppId.startsWith('com.superone.app')).toBe(false)
      expect(v.legacyMacAppId).toBe(v.appId)
    }
  })

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

  it('has no keychain group and no bundle id when unpackaged', () => {
    expect(macKeychainAccessGroup()).toBeNull()
    expect(macBundleIdentifier()).toBeNull()
    expect(isRetiredMacBundle()).toBe(false)
  })
})

describe('parseBundleIdentifier', () => {
  it('reads CFBundleIdentifier out of an Info.plist', () => {
    const plist = `<?xml version="1.0"?>
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key>
  <string>SuperOne</string>
  <key>CFBundleIdentifier</key>
  <string>com.superone.app</string>
</dict></plist>`
    expect(parseBundleIdentifier(plist)).toBe('com.superone.app')
    expect(parseBundleIdentifier('<plist/>')).toBeNull()
  })
})
