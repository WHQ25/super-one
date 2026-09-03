import { describe, expect, it } from 'vitest'
import {
  downloadPlatformFor,
  fixedDownloadUrl,
  fixedInstallerName,
} from './download-links'

describe('fixedInstallerName', () => {
  it('derives every platform name from the variant product name', () => {
    expect(fixedInstallerName('SuperOne', 'mac', 'arm64')).toBe('SuperOne-arm64.dmg')
    expect(fixedInstallerName('SuperOne', 'mac', 'x64')).toBe('SuperOne.dmg')
    expect(fixedInstallerName('SuperOne', 'win')).toBe('SuperOne Setup.exe')
    expect(fixedInstallerName('SuperOne', 'linux')).toBe('SuperOne.AppImage')
  })

  it('carries the space through for the alpha product name', () => {
    // fixedLinkName strips only the version, so the space in "SuperOne Alpha"
    // survives into the published object key.
    expect(fixedInstallerName('SuperOne Alpha', 'mac', 'arm64')).toBe('SuperOne Alpha-arm64.dmg')
    expect(fixedInstallerName('SuperOne Alpha', 'win')).toBe('SuperOne Alpha Setup.exe')
  })
})

describe('fixedDownloadUrl', () => {
  it('percent-encodes the installer name so a spaced product name resolves', () => {
    expect(
      fixedDownloadUrl({
        downloadPrefix: 'alpha',
        productName: 'SuperOne Alpha',
        platform: 'mac',
        arch: 'arm64',
      }),
    ).toBe('https://dl.super-one.dev/alpha/latest/SuperOne%20Alpha-arm64.dmg')
  })

  it('keeps each variant on its own prefix', () => {
    const stable = fixedDownloadUrl({
      downloadPrefix: 'stable',
      productName: 'SuperOne',
      platform: 'linux',
    })
    expect(stable).toBe('https://dl.super-one.dev/stable/latest/SuperOne.AppImage')
  })

  it('trims a trailing slash from an overridden base', () => {
    expect(
      fixedDownloadUrl({
        downloadPrefix: 'stable',
        productName: 'SuperOne',
        platform: 'win',
        baseUrl: 'https://example.test/',
      }),
    ).toBe('https://example.test/stable/latest/SuperOne%20Setup.exe')
  })
})

describe('downloadPlatformFor', () => {
  it('maps the node platform names we actually run on', () => {
    expect(downloadPlatformFor('darwin')).toBe('mac')
    expect(downloadPlatformFor('win32')).toBe('win')
    expect(downloadPlatformFor('linux')).toBe('linux')
  })
})
