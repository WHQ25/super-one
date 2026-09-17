import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { runningUnderARM64Translation: false, getPath: () => '/tmp', quit: vi.fn() },
  net: { fetch: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

import { parseManifest, pickInstaller } from './mac-identity-migration'

// Shape electron-builder emits for a generic-provider channel file.
const MANIFEST = `version: 0.67.0
files:
  - url: v0.67.0/SuperOne-0.67.0-arm64-mac.zip
    sha512: zipsha==
    size: 221329390
  - url: v0.67.0/SuperOne-0.67.0-arm64.dmg
    sha512: dmgsha==
    size: 230000000
  - url: v0.67.0/SuperOne-0.67.0-x64-mac.zip
    sha512: zipsha64==
    size: 1
  - url: 'v0.67.0/SuperOne-0.67.0-x64.dmg'
    sha512: 'dmgsha64=='
    size: 2
path: v0.67.0/SuperOne-0.67.0-arm64-mac.zip
sha512: zipsha==
releaseDate: '2026-09-17T00:00:00.000Z'
`

describe('parseManifest', () => {
  it('reads the version and every file entry, quoted or not', () => {
    const manifest = parseManifest(MANIFEST)
    expect(manifest.version).toBe('0.67.0')
    expect(manifest.files).toEqual([
      { url: 'v0.67.0/SuperOne-0.67.0-arm64-mac.zip', sha512: 'zipsha==', size: 221329390 },
      { url: 'v0.67.0/SuperOne-0.67.0-arm64.dmg', sha512: 'dmgsha==', size: 230000000 },
      { url: 'v0.67.0/SuperOne-0.67.0-x64-mac.zip', sha512: 'zipsha64==', size: 1 },
      { url: 'v0.67.0/SuperOne-0.67.0-x64.dmg', sha512: 'dmgsha64==', size: 2 },
    ])
  })

  it('rejects a manifest with no version', () => {
    expect(() => parseManifest('files: []\n')).toThrow(/no version/)
  })
})

describe('pickInstaller', () => {
  it('chooses the dmg for the host architecture, never the zip', () => {
    const manifest = parseManifest(MANIFEST)
    expect(pickInstaller(manifest, 'arm64')?.url).toBe('v0.67.0/SuperOne-0.67.0-arm64.dmg')
    expect(pickInstaller(manifest, 'x64')?.url).toBe('v0.67.0/SuperOne-0.67.0-x64.dmg')
  })

  it('returns null when the manifest carries no installer for the arch', () => {
    const manifest = parseManifest('version: 1.0.0\nfiles:\n  - url: v1.0.0/a-arm64-mac.zip\n    sha512: x\n')
    expect(pickInstaller(manifest, 'arm64')).toBeNull()
  })
})
