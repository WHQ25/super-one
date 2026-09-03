import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { VARIANTS, type VariantId } from './variant'

const require_ = createRequire(import.meta.url)
const CONFIG_PATH = fileURLToPath(new URL('../../electron-builder.config.cjs', import.meta.url))
const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url))

const { version: baseVersion } = require_(PKG_PATH) as { version: string }

const entries = Object.entries(VARIANTS) as [VariantId, (typeof VARIANTS)[VariantId]][]
/** Any variant works for base-config assertions; nothing here is variant-specific. */
const someVariant = entries[0]![0]
const stable = entries.find(([, v]) => v.prereleaseTag === null)![0]
const alpha = entries.find(([, v]) => v.prereleaseTag !== null)![0]

function packagedVersion(config: Record<string, unknown>): string {
  return (config.extraMetadata as { version: string }).version
}

/** The config reads env and package.json at require time, so reload per case. */
function loadConfig(variant?: string, versionOverride?: string): Record<string, unknown> {
  delete require_.cache[CONFIG_PATH]
  const previous = { ...process.env }
  if (variant === undefined) delete process.env.SUPERONE_VARIANT
  else process.env.SUPERONE_VARIANT = variant
  if (versionOverride === undefined) delete process.env.SUPERONE_VERSION
  else process.env.SUPERONE_VERSION = versionOverride
  try {
    return require_(CONFIG_PATH) as Record<string, unknown>
  } finally {
    for (const key of ['SUPERONE_VARIANT', 'SUPERONE_VERSION']) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
}

beforeEach(() => {
  delete require_.cache[CONFIG_PATH]
})

describe('electron-builder variant config', () => {
  it('refuses to build without an explicit variant', () => {
    // A default here would silently ship a build under the wrong identity —
    // the failure is invisible until two installs fight over one directory.
    expect(() => loadConfig(undefined)).toThrow(/SUPERONE_VARIANT is required/)
  })

  it('refuses an unknown variant', () => {
    expect(() => loadConfig('nightly')).toThrow(/Unknown SUPERONE_VARIANT "nightly"/)
  })

  it('derives one base version into each variant lane', () => {
    // package.json holds the plain release number and the variant appends its
    // own tag, so "stable build carrying an -alpha version" is not expressible
    // rather than merely rejected.
    expect(baseVersion).not.toMatch(/-/)
    expect(packagedVersion(loadConfig(stable))).toBe(baseVersion)
    expect(packagedVersion(loadConfig(alpha))).toBe(`${baseVersion}-${VARIANTS[alpha].prereleaseTag}`)
  })

  it.each(entries)('wires every identity chain from the variant table (%s)', (id, v) => {
    const config = loadConfig(id)

    expect(config.appId).toBe(v.appId)
    expect(config.productName).toBe(v.productName)
    expect(config.icon).toBe(v.icon)
    expect(
      (config.extraResources as Array<{ from?: string; to?: string }>).find(
        (resource) => resource.to === 'icon.png',
      ),
    ).toMatchObject({ from: v.icon })
    expect(config.extraMetadata).toMatchObject({
      name: v.packageName,
      productName: v.productName,
      variant: id,
    })
    if (v.downloadPrefix === null) {
      // No prefix means no R2 layout to point at. A null feed is what stops
      // electron-builder baking an app-update.yml, so a local build cannot
      // auto-update itself onto a shipping line.
      expect(config.publish).toBeNull()
    } else {
      expect(config.publish).toEqual({
        provider: 'generic',
        url: `https://dl.super-one.dev/${v.downloadPrefix}`,
        channel: 'latest',
      })
    }
    expect((config.directories as { output: string }).output).toBe(`dist/${id}`)
    expect((config.linux as { executableName: string }).executableName).toBe(v.executableName)
    expect(packagedVersion(config)).toBe(
      v.prereleaseTag ? `${baseVersion}-${v.prereleaseTag}` : baseVersion,
    )
  })

  it('keeps the shared base config intact', () => {
    const config = loadConfig(someVariant)
    expect((config.mac as { target: string[] }).target).toEqual(['dmg', 'zip'])
    expect((config.mac as { notarize: boolean }).notarize).toBe(true)
    expect((config.files as string[]).length).toBeGreaterThan(10)
    expect((config.asarUnpack as string[]).length).toBeGreaterThan(0)
  })

  describe('base version override', () => {
    it('cuts a release from an older commit without a bump commit', () => {
      // Otherwise the binary is "the validated tree plus a commit nobody ran".
      // The override is the BASE, so each variant still gets its own lane.
      expect(packagedVersion(loadConfig(stable, '99.0.0'))).toBe('99.0.0')
      expect(packagedVersion(loadConfig(alpha, '99.0.0'))).toBe('99.0.0-alpha')
      expect(loadConfig(stable, '99.0.0').appId).toBe(VARIANTS[stable].appId)
    })

    it('rejects a base that already carries a prerelease tag', () => {
      // Passing "99.0.0-alpha" is the natural mistake now that the tag is
      // implicit; taking it literally would double it to "99.0.0-alpha-alpha".
      for (const id of [stable, alpha]) {
        expect(() => loadConfig(id, '99.0.0-alpha')).toThrow(/must be a plain release version/)
      }
    })

    it('rejects an override that is not valid semver', () => {
      expect(() => loadConfig(someVariant, 'v99')).toThrow(/is not a valid semver version/)
    })
  })

  describe('installer filenames', () => {
    /** Every target that produces a file a human downloads or the updater fetches. */
    function templates(config: Record<string, unknown>): Record<string, string> {
      const at = (key: string) =>
        (config[key] as { artifactName?: string } | undefined)?.artifactName ?? ''
      return { mac: at('mac'), dmg: at('dmg'), nsis: at('nsis'), linux: at('linux') }
    }

    it('names installers from the artifact base, never the product name', () => {
      // `${productName}` is "SuperOne Alpha", which would put the word in the
      // filename twice -- once for the app, once for the version's -alpha.
      for (const id of [stable, alpha]) {
        for (const [target, template] of Object.entries(templates(loadConfig(id)))) {
          expect(template, target).not.toContain('${productName}')
          expect(template, target).toMatch(
            new RegExp(`^${VARIANTS[id as VariantId].artifactBaseName}-`),
          )
        }
      }
    })

    it('puts the version directly after the base on every target', () => {
      // `fixedLinkName` strips the version core in place, so the variant tag
      // lands where the version was. Any target that ordered its tokens
      // differently would put the tag somewhere `fixedInstallerName` does not
      // expect, and its fixed download link would 404.
      for (const id of [stable, alpha]) {
        for (const [target, template] of Object.entries(templates(loadConfig(id)))) {
          expect(template, target).toContain('-${version}')
          expect(template.indexOf('${version}'), target).toBe(
            `${VARIANTS[id as VariantId].artifactBaseName}-`.length,
          )
        }
      }
    })

    it('leaves no spaces for GitHub to normalise into dots', () => {
      for (const id of [stable, alpha]) {
        for (const [target, template] of Object.entries(templates(loadConfig(id)))) {
          expect(template, target).not.toContain(' ')
        }
      }
    })

    it('gives every variant the same base, so only the tag separates them', () => {
      const bases = new Set(entries.map(([, v]) => v.artifactBaseName))
      expect(bases.size).toBe(1)
    })
  })

  it('does not leave identity fields in the shared base', () => {
    // Two sources of truth is how the variants drift into colliding.
    const yaml = require_('js-yaml') as { load: (s: string) => Record<string, unknown> }
    const { readFileSync } = require_('node:fs') as typeof import('node:fs')
    const base = yaml.load(
      readFileSync(fileURLToPath(new URL('../../electron-builder.yml', import.meta.url)), 'utf8'),
    )
    expect(base.appId).toBeUndefined()
    expect(base.productName).toBeUndefined()
    expect(base.publish).toBeUndefined()
    expect((base.linux as { executableName?: string }).executableName).toBeUndefined()
  })
})
