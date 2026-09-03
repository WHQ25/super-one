import { describe, expect, it } from 'vitest'
import {
  downloadPlatformFor,
  fixedDownloadUrl,
  fixedInstallerName,
} from './download-links'

describe('fixedInstallerName', () => {
  it('derives every platform name from the artifact base name', () => {
    expect(fixedInstallerName('SuperOne', 'mac', 'arm64')).toBe('SuperOne-arm64.dmg')
    expect(fixedInstallerName('SuperOne', 'mac', 'x64')).toBe('SuperOne.dmg')
    expect(fixedInstallerName('SuperOne', 'win')).toBe('SuperOne-Setup.exe')
    expect(fixedInstallerName('SuperOne', 'linux')).toBe('SuperOne.AppImage')
  })

  it('separates the variants by prerelease tag, not by product name', () => {
    // Both variants build "SuperOne" installers, so without the tag these
    // would be the same filename under two prefixes -- indistinguishable once
    // a browser has dropped them both in ~/Downloads.
    expect(fixedInstallerName('SuperOne', 'mac', 'arm64', 'alpha')).toBe(
      'SuperOne-alpha-arm64.dmg',
    )
    expect(fixedInstallerName('SuperOne', 'mac', 'x64', 'alpha')).toBe('SuperOne-alpha.dmg')
    expect(fixedInstallerName('SuperOne', 'win', undefined, 'alpha')).toBe(
      'SuperOne-alpha-Setup.exe',
    )
    expect(fixedInstallerName('SuperOne', 'linux', undefined, 'alpha')).toBe(
      'SuperOne-alpha.AppImage',
    )
  })

  it('treats a null tag as the untagged variant', () => {
    expect(fixedInstallerName('SuperOne', 'mac', 'arm64', null)).toBe('SuperOne-arm64.dmg')
  })
})

describe('fixedDownloadUrl', () => {
  it('keeps each variant on its own prefix AND its own filename', () => {
    expect(
      fixedDownloadUrl({
        downloadPrefix: 'alpha',
        artifactBaseName: 'SuperOne',
        prereleaseTag: 'alpha',
        platform: 'mac',
        arch: 'arm64',
      }),
    ).toBe('https://dl.super-one.dev/alpha/latest/SuperOne-alpha-arm64.dmg')

    expect(
      fixedDownloadUrl({
        downloadPrefix: 'stable',
        artifactBaseName: 'SuperOne',
        prereleaseTag: null,
        platform: 'linux',
      }),
    ).toBe('https://dl.super-one.dev/stable/latest/SuperOne.AppImage')
  })

  it('trims a trailing slash from an overridden base', () => {
    expect(
      fixedDownloadUrl({
        downloadPrefix: 'stable',
        artifactBaseName: 'SuperOne',
        prereleaseTag: null,
        platform: 'win',
        baseUrl: 'https://example.test/',
      }),
    ).toBe('https://example.test/stable/latest/SuperOne-Setup.exe')
  })
})

describe('downloadPlatformFor', () => {
  it('maps the node platform names we actually run on', () => {
    expect(downloadPlatformFor('darwin')).toBe('mac')
    expect(downloadPlatformFor('win32')).toBe('win')
    expect(downloadPlatformFor('linux')).toBe('linux')
  })
})
