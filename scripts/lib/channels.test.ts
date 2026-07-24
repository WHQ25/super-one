import { describe, it, expect } from 'bun:test'
import {
  nativeYmlChannel,
  cascadeTargets,
  compareVersions,
  shouldPublish,
  prefixVersionPaths,
  fixedLinkName,
  fixedDownloadPath,
  artifactPathCandidates,
} from './channels'

describe('nativeYmlChannel', () => {
  it('translates a version to its electron-builder yml channel', () => {
    expect(nativeYmlChannel('0.40.1-alpha')).toBe('alpha')
    expect(nativeYmlChannel('1.0.0-beta.1')).toBe('beta')
    expect(nativeYmlChannel('1.0.0')).toBe('latest')
  })
})

describe('cascadeTargets', () => {
  it('cascades a release into its own channel and every less-stable one', () => {
    expect(cascadeTargets('latest')).toEqual(['latest', 'beta', 'alpha'])
    expect(cascadeTargets('beta')).toEqual(['beta', 'alpha'])
    expect(cascadeTargets('alpha')).toEqual(['alpha'])
  })
})

describe('compareVersions', () => {
  it('orders by numeric core fields', () => {
    expect(compareVersions('0.40.0-alpha', '0.40.1-alpha')).toBe(-1)
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('ranks a prerelease below the same core release', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-beta.5')).toBe(1)
  })

  it('orders prerelease identifiers per semver (alpha < beta, numeric < alphanumeric, fewer fields lower)', () => {
    expect(compareVersions('1.0.0-alpha.5', '1.0.0-beta.1')).toBe(-1)
    expect(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
  })
})

describe('shouldPublish', () => {
  it('always publishes when the channel has no current release', () => {
    expect(shouldPublish('1.0.0', null)).toBe(true)
  })

  it('re-publishes equal versions but never clobbers a newer one', () => {
    expect(shouldPublish('0.40.1-alpha', '0.40.1-alpha')).toBe(true)
    expect(shouldPublish('1.0.0', '1.2.0-alpha.3')).toBe(false)
    expect(shouldPublish('1.3.0', '1.2.0')).toBe(true)
  })

  it('lets a newer beta cascade over an older alpha on the alpha channel', () => {
    expect(shouldPublish('1.0.0-beta.1', '1.0.0-alpha.9')).toBe(true)
  })
})

describe('prefixVersionPaths', () => {
  it('prefixes url/path values with the version subdir, leaving others untouched', () => {
    const flat = [
      'version: 0.40.1-alpha',
      'files:',
      '  - url: SuperOne-0.40.1-alpha.dmg',
      '    sha512: abc',
      '    size: 10',
      '  - url: SuperOne Setup 0.40.1-alpha.exe',
      '    sha512: def',
      'path: SuperOne-0.40.1-alpha.dmg',
      "releaseDate: '2026-05-31T00:00:00.000Z'",
    ].join('\n')
    const out = prefixVersionPaths(flat, '0.40.1-alpha')
    expect(out).toContain('url: v0.40.1-alpha/SuperOne-0.40.1-alpha.dmg')
    expect(out).toContain('url: v0.40.1-alpha/SuperOne Setup 0.40.1-alpha.exe')
    expect(out).toContain('path: v0.40.1-alpha/SuperOne-0.40.1-alpha.dmg')
    expect(out).toContain('sha512: abc')
    expect(out).toContain('version: 0.40.1-alpha')
  })

  it('is idempotent and ignores absolute URLs', () => {
    const already = 'path: v1.0.0/SuperOne.dmg\nurl: https://example.com/x.dmg'
    expect(prefixVersionPaths(already, '1.0.0')).toBe(already)
  })
})

describe('fixedLinkName', () => {
  it('strips the version token regardless of the separator before it', () => {
    expect(fixedLinkName('SuperOne-0.40.0-alpha-mac.zip', '0.40.0-alpha')).toBe('SuperOne-mac.zip')
    expect(fixedLinkName('SuperOne-0.40.0-alpha-arm64-mac.zip', '0.40.0-alpha')).toBe('SuperOne-arm64-mac.zip')
    expect(fixedLinkName('SuperOne-0.40.0-alpha.dmg', '0.40.0-alpha')).toBe('SuperOne.dmg')
    expect(fixedLinkName('SuperOne-0.40.0-alpha-arm64.dmg', '0.40.0-alpha')).toBe('SuperOne-arm64.dmg')
    expect(fixedLinkName('SuperOne Setup 0.40.1-alpha.exe', '0.40.1-alpha')).toBe('SuperOne Setup.exe')
    expect(fixedLinkName('SuperOne.Setup.0.40.1-alpha.exe', '0.40.1-alpha')).toBe('SuperOne Setup.exe')
    expect(fixedLinkName('SuperOne-0.40.1-alpha.AppImage', '0.40.1-alpha')).toBe('SuperOne.AppImage')
  })
})

describe('fixedDownloadPath', () => {
  it('builds the per-channel latest path', () => {
    expect(fixedDownloadPath('alpha', 'SuperOne.dmg')).toBe('alpha/latest/SuperOne.dmg')
    expect(fixedDownloadPath('stable', 'SuperOne.AppImage')).toBe('stable/latest/SuperOne.AppImage')
  })
})

describe('artifactPathCandidates', () => {
  it('falls back to GitHub-normalized names for legacy Windows artifacts', () => {
    expect(artifactPathCandidates('v0.46.6-alpha/SuperOne Setup 0.46.6-alpha.exe')).toEqual([
      'v0.46.6-alpha/SuperOne Setup 0.46.6-alpha.exe',
      'v0.46.6-alpha/SuperOne.Setup.0.46.6-alpha.exe',
    ])
  })

  it('does not rewrite non-Windows or already normalized artifact names', () => {
    expect(artifactPathCandidates('v0.46.6-alpha/SuperOne-0.46.6-alpha.dmg')).toEqual([
      'v0.46.6-alpha/SuperOne-0.46.6-alpha.dmg',
    ])
    expect(artifactPathCandidates('v0.46.6-alpha/SuperOne.Setup.0.46.6-alpha.exe')).toEqual([
      'v0.46.6-alpha/SuperOne.Setup.0.46.6-alpha.exe',
    ])
  })
})
