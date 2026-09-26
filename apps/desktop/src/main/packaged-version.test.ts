import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)
const {
  nextAlphaBuild,
  nextAlphaRelease,
  parsePrereleaseN,
  resolvePackagedVersion,
} = require_(fileURLToPath(new URL('../../packaged-version.cjs', import.meta.url))) as {
  nextAlphaBuild: (version: string) => { base: string; prereleaseN: number; version: string }
  nextAlphaRelease: (
    latestAlpha: string,
    latestStable: string | null,
    options?: { major?: boolean },
  ) => { bump: string; base: string; prereleaseN: number | null; version: string }
  parsePrereleaseN: (raw: unknown) => number | null
  resolvePackagedVersion: (
    packageVersion: string,
    variantId: string,
    options?: { versionOverride?: string; prereleaseN?: unknown },
  ) => string
}

describe('parsePrereleaseN', () => {
  it('treats blank and 0 as no sequence', () => {
    expect(parsePrereleaseN(undefined)).toBeNull()
    expect(parsePrereleaseN(null)).toBeNull()
    expect(parsePrereleaseN('')).toBeNull()
    expect(parsePrereleaseN('  ')).toBeNull()
    expect(parsePrereleaseN('0')).toBeNull()
    expect(parsePrereleaseN(0)).toBeNull()
  })

  it('accepts a positive integer', () => {
    expect(parsePrereleaseN('1')).toBe(1)
    expect(parsePrereleaseN(2)).toBe(2)
    expect(parsePrereleaseN('10')).toBe(10)
  })

  it('rejects anything else', () => {
    expect(() => parsePrereleaseN('-1')).toThrow(/positive integer/)
    expect(() => parsePrereleaseN('1.5')).toThrow(/positive integer/)
    expect(() => parsePrereleaseN('alpha')).toThrow(/positive integer/)
    expect(() => parsePrereleaseN('01')).toThrow(/positive integer/)
  })
})

describe('resolvePackagedVersion', () => {
  it('appends only the variant tag when there is no sequence', () => {
    expect(resolvePackagedVersion('0.63.0', 'stable')).toBe('0.63.0')
    expect(resolvePackagedVersion('0.63.0', 'alpha')).toBe('0.63.0-alpha')
    expect(resolvePackagedVersion('0.63.0', 'dev')).toBe('0.63.0-dev')
  })

  it('appends tag.N for a build bump', () => {
    expect(resolvePackagedVersion('0.63.0', 'alpha', { prereleaseN: 1 })).toBe('0.63.0-alpha.1')
    expect(resolvePackagedVersion('0.63.0', 'alpha', { prereleaseN: '2' })).toBe('0.63.0-alpha.2')
    expect(resolvePackagedVersion('0.63.0', 'dev', { prereleaseN: 1 })).toBe('0.63.0-dev.1')
  })

  it('still overrides the base, then applies the variant tag and sequence', () => {
    expect(resolvePackagedVersion('0.63.0', 'alpha', { versionOverride: '99.0.0' })).toBe(
      '99.0.0-alpha',
    )
    expect(
      resolvePackagedVersion('0.63.0', 'alpha', { versionOverride: '99.0.0', prereleaseN: 1 }),
    ).toBe('99.0.0-alpha.1')
    expect(resolvePackagedVersion('0.63.0', 'stable', { versionOverride: ' 99.0.0 ' })).toBe(
      '99.0.0',
    )
  })

  it('treats an empty version override as missing, the way a blank workflow input arrives', () => {
    expect(resolvePackagedVersion('0.63.0', 'alpha', { versionOverride: '' })).toBe('0.63.0-alpha')
  })

  it('rejects a sequence on stable', () => {
    expect(() => resolvePackagedVersion('0.63.0', 'stable', { prereleaseN: 1 })).toThrow(
      /only valid for prerelease variants/,
    )
  })

  it('rejects a base that already carries a prerelease tag', () => {
    expect(() => resolvePackagedVersion('0.63.0-alpha', 'alpha')).toThrow(
      /must be a plain release version/,
    )
    expect(() => resolvePackagedVersion('0.63.0', 'alpha', { versionOverride: '0.63.0-alpha.1' })).toThrow(
      /must be a plain release version/,
    )
  })

  it('rejects an unknown variant', () => {
    expect(() => resolvePackagedVersion('0.63.0', 'nightly')).toThrow(/Unknown variant/)
  })
})

describe('nextAlphaBuild', () => {
  it('turns the first alpha of a base into .1', () => {
    expect(nextAlphaBuild('0.63.0-alpha')).toEqual({
      base: '0.63.0',
      prereleaseN: 1,
      version: '0.63.0-alpha.1',
    })
    expect(nextAlphaBuild('v0.63.0-alpha')).toEqual({
      base: '0.63.0',
      prereleaseN: 1,
      version: '0.63.0-alpha.1',
    })
  })

  it('increments an existing sequence', () => {
    expect(nextAlphaBuild('0.63.0-alpha.1')).toEqual({
      base: '0.63.0',
      prereleaseN: 2,
      version: '0.63.0-alpha.2',
    })
    expect(nextAlphaBuild('0.63.0-alpha.9')).toEqual({
      base: '0.63.0',
      prereleaseN: 10,
      version: '0.63.0-alpha.10',
    })
  })

  it('refuses a non-alpha version', () => {
    expect(() => nextAlphaBuild('0.63.0')).toThrow(/expects an -alpha version/)
    expect(() => nextAlphaBuild('0.63.0-dev.1')).toThrow(/expects an -alpha version/)
  })
})

describe('nextAlphaRelease', () => {
  it('iterates the base while stable is behind it', () => {
    expect(nextAlphaRelease('v0.69.0-alpha.1', 'v0.68.0')).toEqual({
      bump: 'build',
      base: '0.69.0',
      prereleaseN: 2,
      version: '0.69.0-alpha.2',
    })
    expect(nextAlphaRelease('0.69.0-alpha', null).version).toBe('0.69.0-alpha.1')
  })

  it('opens the next minor once stable has shipped the base', () => {
    expect(nextAlphaRelease('0.69.0-alpha.2', '0.69.0')).toEqual({
      bump: 'feature',
      base: '0.70.0',
      prereleaseN: null,
      version: '0.70.0-alpha',
    })
  })

  it('opens the next minor above a stable hotfix that moved past the base', () => {
    expect(nextAlphaRelease('0.69.0-alpha.3', '0.69.1').version).toBe('0.70.0-alpha')
  })

  it('opens the next major when asked, whatever stable did', () => {
    expect(nextAlphaRelease('1.2.0-alpha.4', '1.1.0', { major: true })).toEqual({
      bump: 'major',
      base: '2.0.0',
      prereleaseN: null,
      version: '2.0.0-alpha',
    })
    expect(nextAlphaRelease('1.2.0-alpha.4', '1.2.0', { major: true }).version).toBe('2.0.0-alpha')
  })

  it('refuses a stable carrying a prerelease tag', () => {
    expect(() => nextAlphaRelease('0.69.0-alpha', '0.69.0-alpha.1')).toThrow(/plain release version/)
  })
})
