import { describe, expect, it } from 'vitest'
import {
  appHarnessPinsObjectKey,
  appHarnessPinsUrl,
  currentProcessAppHarnessPins,
  parseAppHarnessPins,
  resolveAppHarnessPins,
} from './app-harness-pins'
import { managedPackagePins } from './managed-tarball-installer'

describe('app harness pins', () => {
  it('builds a CDN object key and URL', () => {
    expect(appHarnessPinsObjectKey('1.2.3-alpha.1')).toBe(
      'app/harness-pins/1.2.3-alpha.1.json',
    )
    expect(appHarnessPinsUrl('1.2.3')).toBe(
      'https://dl.super-one.dev/app/harness-pins/1.2.3.json',
    )
  })

  it('rejects unsafe versions in the object key', () => {
    expect(() => appHarnessPinsObjectKey('../etc/passwd')).toThrow(/unsafe/)
  })

  it('parses a valid pins document', () => {
    expect(
      parseAppHarnessPins({
        version: '9.0.0',
        pins: { claude: '0.3.226', codex: '0.146.1' },
      }),
    ).toEqual({
      version: '9.0.0',
      pins: { claude: '0.3.226', codex: '0.146.1' },
    })
  })

  it('falls back to process pins when remote is missing', async () => {
    const resolved = await resolveAppHarnessPins({
      appVersion: '1.0.0',
      fetchJson: async () => null,
    })
    expect(resolved.version).toBe('1.0.0')
    expect(resolved.pins.claude).toBe(managedPackagePins('claude').runtimeVersion)
    expect(resolved.pins.codex).toBe(managedPackagePins('codex').runtimeVersion)
  })

  it('uses remote pins when published', async () => {
    const resolved = await resolveAppHarnessPins({
      appVersion: '2.0.0',
      fetchJson: async () => ({
        version: '2.0.0',
        pins: { claude: '9.9.9', codex: '8.8.8' },
      }),
    })
    expect(resolved.pins).toEqual({ claude: '9.9.9', codex: '8.8.8' })
  })

  it('currentProcessAppHarnessPins mirrors managedPackagePins', () => {
    const pins = currentProcessAppHarnessPins('dev')
    expect(pins.pins.claude).toBe(managedPackagePins('claude').runtimeVersion)
    expect(pins.pins.codex).toBe(managedPackagePins('codex').runtimeVersion)
  })
})
