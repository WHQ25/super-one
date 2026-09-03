import { describe, expect, it } from 'vitest'
import VARIANTS from '../apps/desktop/variants.json'
import { HARNESS_MANIFEST_CHANNELS } from '../packages/runtime/src/harness/cdn'
import { appVersionForChannel } from './publish-harness-artifacts'

describe('appVersionForChannel', () => {
  it('keys the pins by the version the shipped app reports', () => {
    // The updater asks for app/harness-pins/<app.getVersion()>.json. The alpha
    // app runs as "<base>-alpha", so pins written under the bare base are a key
    // no client ever requests.
    expect(appVersionForChannel('alpha', '0.61.0')).toBe('0.61.0-alpha')
    expect(appVersionForChannel('stable', '0.61.0')).toBe('0.61.0')
  })

  it('rejects a channel no variant declares', () => {
    expect(() => appVersionForChannel('beta' as 'alpha', '0.61.0')).toThrow(
      /no variant declares channel "beta"/,
    )
  })

  it('covers exactly the variants that publish', () => {
    // The channel IS the variant id. If a publishing variant ever has no
    // channel, its pins silently never get written; if a channel has no
    // variant, the run fails at dispatch instead of writing a wrong key.
    const publishing = Object.entries(
      VARIANTS as Record<string, { downloadPrefix: string | null }>,
    )
      .filter(([, v]) => v.downloadPrefix !== null)
      .map(([id]) => id)
      .sort()
    expect([...HARNESS_MANIFEST_CHANNELS].sort()).toEqual(publishing)
  })

  it('derives the tag from variants.json rather than restating it', () => {
    for (const channel of HARNESS_MANIFEST_CHANNELS) {
      const { prereleaseTag } = (
        VARIANTS as Record<string, { prereleaseTag: string | null }>
      )[channel]!
      const expected = prereleaseTag ? `9.9.9-${prereleaseTag}` : '9.9.9'
      expect(appVersionForChannel(channel, '9.9.9')).toBe(expected)
    }
  })
})
