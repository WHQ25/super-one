import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  DSH_FAMILY_PREFIX,
  dshPluginRoots,
  importerIsExternal,
  redirectTarget,
  registerDshPluginRoot,
  resetDshPluginRoots,
} from './resolver'

const PLUGIN_ROOT = '/tmp/superone-dsh-plugins'
/** A module inside a registered plugin root — the importer we redirect for. */
const EXTERNAL_IMPORTER = pathToFileURL(join(PLUGIN_ROOT, 'my-plugin', 'index.js')).href
/** This very test file: an importer that lives inside the app tree. */
const IN_APP_IMPORTER = import.meta.url

beforeEach(() => {
  resetDshPluginRoots()
})

describe('plugin root registration', () => {
  it('normalizes a root to a trailing-separator prefix and de-duplicates it', () => {
    registerDshPluginRoot(PLUGIN_ROOT)
    registerDshPluginRoot(PLUGIN_ROOT)
    registerDshPluginRoot(`${PLUGIN_ROOT}/`)
    const roots = dshPluginRoots()
    expect(roots).toHaveLength(1)
    expect(roots[0]!.endsWith('/')).toBe(true)
  })
})

describe('importerIsExternal', () => {
  it('is false with no roots registered, whatever the importer', () => {
    expect(importerIsExternal(EXTERNAL_IMPORTER)).toBe(false)
  })

  it('is true only for importers under a registered root', () => {
    registerDshPluginRoot(PLUGIN_ROOT)
    expect(importerIsExternal(EXTERNAL_IMPORTER)).toBe(true)
    expect(importerIsExternal(IN_APP_IMPORTER)).toBe(false)
  })

  it('treats a parent-less or non-file resolve as in-app', () => {
    registerDshPluginRoot(PLUGIN_ROOT)
    expect(importerIsExternal(undefined)).toBe(false)
    expect(importerIsExternal('data:text/javascript,0')).toBe(false)
    expect(importerIsExternal('https://example.com/x.js')).toBe(false)
  })
})

describe('redirectTarget', () => {
  beforeEach(() => {
    registerDshPluginRoot(PLUGIN_ROOT)
  })

  it('leaves non-family specifiers alone even from a plugin root', () => {
    expect(redirectTarget('react', EXTERNAL_IMPORTER)).toBeNull()
    expect(redirectTarget('./relative.js', EXTERNAL_IMPORTER)).toBeNull()
    expect(redirectTarget('cosmokit', EXTERNAL_IMPORTER)).toBeNull()
  })

  it('leaves family specifiers alone when the importer is in-app', () => {
    expect(redirectTarget(`${DSH_FAMILY_PREFIX}cordis`, IN_APP_IMPORTER)).toBeNull()
  })

  it('redirects a family specifier from a plugin root to the app copy', () => {
    const target = redirectTarget(`${DSH_FAMILY_PREFIX}cordis`, EXTERNAL_IMPORTER)
    expect(target).not.toBeNull()
    expect(target!.startsWith('file:')).toBe(true)
  })

  it('redirects to exactly the file the app itself resolves — the identity guarantee', () => {
    const appRequire = createRequire(import.meta.url)
    const expected = pathToFileURL(appRequire.resolve(`${DSH_FAMILY_PREFIX}cordis`)).href
    expect(redirectTarget(`${DSH_FAMILY_PREFIX}cordis`, EXTERNAL_IMPORTER)).toBe(expected)
  })

  it('falls through for a family package the app does not carry', () => {
    const missing = `${DSH_FAMILY_PREFIX}dsh-not-a-real-package-xyz`
    expect(redirectTarget(missing, EXTERNAL_IMPORTER)).toBeNull()
  })

  it('is memoized: a repeated lookup returns the identical string', () => {
    const first = redirectTarget(`${DSH_FAMILY_PREFIX}cordis`, EXTERNAL_IMPORTER)
    const second = redirectTarget(`${DSH_FAMILY_PREFIX}cordis`, EXTERNAL_IMPORTER)
    expect(second).toBe(first)
  })
})

describe('symlinked plugin roots', () => {
  it('matches importers reported at the root\'s realpath, not its lexical path', async () => {
    // Regression: `require.resolve` returns realpaths, so a root registered
    // through a symlink would never prefix-match its own importers and the
    // redirect would silently never fire. macOS makes this the default for
    // anything under a temp dir (/var -> /private/var).
    const lexical = await mkdtemp(join(tmpdir(), 'dsh-root-'))
    const canonical = await realpath(lexical)
    try {
      registerDshPluginRoot(lexical)
      const importer = pathToFileURL(join(canonical, 'plugin', 'index.js')).href
      expect(importerIsExternal(importer)).toBe(true)
      expect(redirectTarget(`${DSH_FAMILY_PREFIX}cordis`, importer)).not.toBeNull()
    } finally {
      await rm(lexical, { recursive: true, force: true })
    }
  })
})
