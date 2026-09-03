import { describe, expect, it } from 'vitest'
import {
  artifactPathCandidates,
  compareVersions,
  fixedDownloadPath,
  fixedLinkName,
  LEGACY_ROOT_YML_NAMES,
  prefixVersionPaths,
  rootRelativePaths,
  shouldPublish,
  versionedArtifactPath,
} from './channels'
import { fixedInstallerName } from '@superone/shared/download-links'

describe('compareVersions', () => {
  it('orders core versions numerically, not lexically', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1)
  })

  it('ranks a prerelease below the same core version', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1)
  })

  it('ignores a leading v and build metadata', () => {
    expect(compareVersions('v1.2.3', '1.2.3+build.9')).toBe(0)
  })
})

describe('shouldPublish', () => {
  it('publishes when nothing is live yet', () => {
    expect(shouldPublish('1.0.0', null)).toBe(true)
  })

  it('re-publishes an identical version so a rerun is idempotent', () => {
    expect(shouldPublish('1.0.0', '1.0.0')).toBe(true)
  })

  it('refuses to clobber a newer live version', () => {
    expect(shouldPublish('1.0.0', '1.1.0')).toBe(false)
  })
})

describe('prefixVersionPaths', () => {
  it('moves relative manifest entries under the version directory', () => {
    const yml = ['files:', '  - url: SuperOne-1.0.0.dmg', 'path: SuperOne-1.0.0.dmg'].join('\n')
    expect(prefixVersionPaths(yml, '1.0.0')).toBe(
      ['files:', '  - url: v1.0.0/SuperOne-1.0.0.dmg', 'path: v1.0.0/SuperOne-1.0.0.dmg'].join('\n'),
    )
  })

  it('leaves absolute and already-prefixed entries alone', () => {
    const yml = ['  - url: https://cdn/x.dmg', 'path: v1.0.0/x.dmg'].join('\n')
    expect(prefixVersionPaths(yml, '1.0.0')).toBe(yml)
  })
})

describe('rootRelativePaths', () => {
  // A pre-variant client fetches https://dl.super-one.dev/alpha-mac.yml and
  // resolves the relative entries against the BUCKET ROOT, so the manifest it
  // reads has to name the variant that now owns those binaries.
  it('re-roots a variant manifest for a client reading from the bucket root', () => {
    const yml = ['files:', '  - url: v1.0.0/SuperOne-1.0.0.dmg', 'path: v1.0.0/SuperOne-1.0.0.dmg'].join('\n')
    const rooted = rootRelativePaths(yml, 'stable')
    expect(rooted).toBe(
      ['files:', '  - url: stable/v1.0.0/SuperOne-1.0.0.dmg', 'path: stable/v1.0.0/SuperOne-1.0.0.dmg'].join('\n'),
    )
    expect(new URL('stable/v1.0.0/SuperOne-1.0.0.dmg', 'https://dl.super-one.dev/alpha-mac.yml').pathname).toBe(
      '/stable/v1.0.0/SuperOne-1.0.0.dmg',
    )
  })

  it('is idempotent, so re-running set-latest cannot double the prefix', () => {
    const yml = 'path: stable/v1.0.0/x.dmg'
    expect(rootRelativePaths(yml, 'stable')).toBe(yml)
  })

  it('covers every legacy root name for a platform whose manifest we publish', () => {
    // The runtime channel setting let a legacy client override its build
    // channel, so any of the three names may be the one it actually polls.
    expect(LEGACY_ROOT_YML_NAMES.mac).toContain('alpha-mac.yml')
    expect(LEGACY_ROOT_YML_NAMES.win).toContain('alpha.yml')
    expect(LEGACY_ROOT_YML_NAMES.linux).toContain('alpha-linux.yml')
  })
})

describe('fixedLinkName', () => {
  it('strips the release number so the link is stable across releases', () => {
    expect(fixedLinkName('SuperOne-0.62.0-arm64.dmg', '0.62.0')).toBe('SuperOne-arm64.dmg')
    expect(fixedLinkName('SuperOne-0.62.0-Setup.exe', '0.62.0')).toBe('SuperOne-Setup.exe')
  })

  it('keeps the prerelease tag, which is all that separates the two variants', () => {
    // Both variants name their installers "SuperOne" now. Strip the whole
    // version and stable/ and alpha/ publish the same filename.
    expect(fixedLinkName('SuperOne-0.61.0-alpha-arm64.dmg', '0.61.0-alpha')).toBe(
      'SuperOne-alpha-arm64.dmg',
    )
    expect(fixedLinkName('SuperOne-0.61.0-alpha.dmg', '0.61.0-alpha')).toBe('SuperOne-alpha.dmg')
    expect(fixedLinkName('SuperOne-0.61.0-alpha-Setup.exe', '0.61.0-alpha')).toBe(
      'SuperOne-alpha-Setup.exe',
    )
    expect(fixedLinkName('SuperOne-0.61.0-alpha.AppImage', '0.61.0-alpha')).toBe(
      'SuperOne-alpha.AppImage',
    )
  })

  it('tolerates a v-prefixed tag as the version argument', () => {
    expect(fixedLinkName('SuperOne-0.61.0-alpha-arm64.dmg', 'v0.61.0-alpha')).toBe(
      'SuperOne-alpha-arm64.dmg',
    )
  })

  it('still normalises the dots a GitHub-normalised historical name carries', () => {
    // Rolling a variant back reads that release's manifest, which can name a
    // spaced artifact from before the rename.
    expect(fixedLinkName('SuperOne.Setup.0.40.1-alpha.exe', '0.40.1-alpha')).toBe(
      'SuperOne Setup-alpha.exe',
    )
  })
})

describe('fixed link name agreement between the producing and consuming halves', () => {
  // `fixedLinkName` decides the object key set-latest writes; `fixedInstallerName`
  // decides the URL the desktop app and the marketing site request. They are in
  // different packages and nothing links them at build time, so a drift shows up
  // only as a 404 in production. Pin them against each other.
  const VERSIONS = { stable: '0.62.0', alpha: '0.61.0-alpha' } as const
  const TAGS = { stable: null, alpha: 'alpha' } as const

  const artifacts = (version: string) => [
    { file: `SuperOne-${version}-arm64.dmg`, platform: 'mac' as const, arch: 'arm64' as const },
    { file: `SuperOne-${version}.dmg`, platform: 'mac' as const, arch: 'x64' as const },
    { file: `SuperOne-${version}-Setup.exe`, platform: 'win' as const, arch: undefined },
    { file: `SuperOne-${version}.AppImage`, platform: 'linux' as const, arch: undefined },
  ]

  for (const variant of ['stable', 'alpha'] as const) {
    it(`agrees on every ${variant} installer`, () => {
      for (const { file, platform, arch } of artifacts(VERSIONS[variant])) {
        expect(fixedLinkName(file, VERSIONS[variant])).toBe(
          fixedInstallerName('SuperOne', platform, arch, TAGS[variant]),
        )
      }
    })
  }

  it('never lets the two variants collide on one filename', () => {
    for (const { platform, arch } of artifacts('0.0.0')) {
      expect(fixedInstallerName('SuperOne', platform, arch, TAGS.stable)).not.toBe(
        fixedInstallerName('SuperOne', platform, arch, TAGS.alpha),
      )
    }
  })
})

describe('variant-scoped R2 layout', () => {
  // stable and alpha are separate apps with separate bundle identities, so
  // nothing may be shared between their prefixes -- handing the alpha app a
  // stable installer would install a different appId over it.
  it('keeps each variant on its own fixed-download prefix', () => {
    expect(fixedDownloadPath('stable', 'SuperOne.dmg')).toBe('stable/latest/SuperOne.dmg')
    expect(fixedDownloadPath('alpha', 'SuperOne Alpha.dmg')).toBe('alpha/latest/SuperOne Alpha.dmg')
  })

  it('archives binaries under the variant prefix promote.yml writes', () => {
    expect(versionedArtifactPath('alpha', '0.64.0-alpha', 'x.dmg')).toBe('alpha/v0.64.0-alpha/x.dmg')
  })

  it('resolves a manifest url relative to its own variant prefix', () => {
    // The yml lives at <variant>/latest-mac.yml and its urls are relative, so
    // the version prefix alone lands the request inside the right variant.
    const url = new URL('v1.0.0/x.dmg', 'https://dl.super-one.dev/alpha/latest-mac.yml')
    expect(url.pathname).toBe('/alpha/v1.0.0/x.dmg')
  })
})

describe('artifactPathCandidates', () => {
  it('offers the dotted name GitHub produces for a Windows installer', () => {
    expect(artifactPathCandidates('v1.0.0/SuperOne Setup 1.0.0.exe')).toEqual([
      'v1.0.0/SuperOne Setup 1.0.0.exe',
      'v1.0.0/SuperOne.Setup.1.0.0.exe',
    ])
  })

  it('rescues the mac zip too, which is what the updater actually downloads', () => {
    // Every alpha artifact carries the space from "SuperOne Alpha", so gating
    // this on .exe left the one file macOS auto-update needs unresolvable.
    expect(artifactPathCandidates('v1.0.0-alpha/SuperOne Alpha-1.0.0-alpha-arm64-mac.zip')).toEqual([
      'v1.0.0-alpha/SuperOne Alpha-1.0.0-alpha-arm64-mac.zip',
      'v1.0.0-alpha/SuperOne.Alpha-1.0.0-alpha-arm64-mac.zip',
    ])
    expect(artifactPathCandidates('v1.0.0-alpha/SuperOne Alpha-1.0.0-alpha-arm64.dmg')).toEqual([
      'v1.0.0-alpha/SuperOne Alpha-1.0.0-alpha-arm64.dmg',
      'v1.0.0-alpha/SuperOne.Alpha-1.0.0-alpha-arm64.dmg',
    ])
  })

  it('leaves a name with no space untouched', () => {
    expect(artifactPathCandidates('v1.0.0/SuperOne.dmg')).toEqual(['v1.0.0/SuperOne.dmg'])
    expect(artifactPathCandidates('v1.0.0/SuperOne-1.0.0-arm64-mac.zip')).toEqual([
      'v1.0.0/SuperOne-1.0.0-arm64-mac.zip',
    ])
  })
})
