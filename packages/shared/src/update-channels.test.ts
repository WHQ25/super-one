import { describe, expect, it } from 'vitest'
import { channelFromVersion } from './update-channels'

describe('channelFromVersion', () => {
  // The desktop app never calls this -- each build variant knows its own
  // identity. It exists for @super-one/cli, which ships at the desktop version
  // but has no variant, and needs a harness manifest channel to download from.
  it('maps an alpha prerelease to the alpha channel', () => {
    expect(channelFromVersion('0.40.1-alpha')).toBe('alpha')
    expect(channelFromVersion('1.2.3-alpha.7')).toBe('alpha')
  })

  it('maps every other version to stable', () => {
    expect(channelFromVersion('1.0.0')).toBe('stable')
    expect(channelFromVersion('2.3.4')).toBe('stable')
    // An -rc build belongs to the stable app: the builder config only lets a
    // stable-identity build carry a non-alpha version.
    expect(channelFromVersion('1.0.0-rc.1')).toBe('stable')
  })
})
