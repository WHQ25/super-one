import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { VARIANTS, type VariantId } from './variant'

const require_ = createRequire(import.meta.url)
const CONFIG_PATH = fileURLToPath(new URL('../../electron-builder.config.cjs', import.meta.url))
const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url))

const { version } = require_(PKG_PATH) as { version: string }
const prereleaseTag = /^\d+\.\d+\.\d+-([0-9a-z]+)/i.exec(version)?.[1] ?? null

const entries = Object.entries(VARIANTS) as [VariantId, (typeof VARIANTS)[VariantId]][]
const matching = entries.find(([, v]) => v.prereleaseTag === prereleaseTag)?.[0]
const mismatched = entries.find(([, v]) => v.prereleaseTag !== prereleaseTag)?.[0]

/** The config reads env and package.json at require time, so reload per case. */
function loadConfig(variant?: string): Record<string, unknown> {
  delete require_.cache[CONFIG_PATH]
  const previous = process.env.SUPERONE_VARIANT
  if (variant === undefined) delete process.env.SUPERONE_VARIANT
  else process.env.SUPERONE_VARIANT = variant
  try {
    return require_(CONFIG_PATH) as Record<string, unknown>
  } finally {
    if (previous === undefined) delete process.env.SUPERONE_VARIANT
    else process.env.SUPERONE_VARIANT = previous
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

  it('refuses a variant whose prerelease tag disagrees with the version', () => {
    // `@super-one/cli`, the harness manifest channel and the GitHub prerelease
    // flag all still derive from the version string, so the two must agree.
    expect(mismatched).toBeDefined()
    expect(() => loadConfig(mismatched)).toThrow(/does not match variant/)
  })

  it('wires every identity chain from the variant table', () => {
    expect(matching).toBeDefined()
    const id = matching as VariantId
    const v = VARIANTS[id]
    const config = loadConfig(id)

    expect(config.appId).toBe(v.appId)
    expect(config.productName).toBe(v.productName)
    expect(config.extraMetadata).toMatchObject({
      name: v.packageName,
      productName: v.productName,
      variant: id,
    })
    expect(config.publish).toEqual({
      provider: 'generic',
      url: `https://dl.super-one.dev/${v.downloadPrefix}`,
      channel: 'latest',
    })
    expect((config.directories as { output: string }).output).toBe(`dist/${id}`)
    expect((config.linux as { executableName: string }).executableName).toBe(v.executableName)
  })

  it('keeps the shared base config intact', () => {
    const config = loadConfig(matching)
    expect((config.mac as { target: string[] }).target).toEqual(['dmg', 'zip'])
    expect((config.mac as { notarize: boolean }).notarize).toBe(true)
    expect((config.files as string[]).length).toBeGreaterThan(10)
    expect((config.asarUnpack as string[]).length).toBeGreaterThan(0)
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
