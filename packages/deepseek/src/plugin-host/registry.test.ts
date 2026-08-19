import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DSH_PLUGIN_REGISTRY_VERSION,
  enabledPlugins,
  readPluginRegistry,
  registryPath,
  renderRegistry,
  resolvePluginEntryUrl,
  updatePluginRegistry,
} from './registry'

let root: string

beforeEach(async () => {
  // realpath: on macOS mkdtemp hands back /var/... while module resolution
  // reports /private/var/..., and this test asserts on that comparison.
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-plugins-')))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Write a registry file verbatim, bypassing the writer, to seed a read test. */
async function seed(content: string): Promise<void> {
  await writeFile(registryPath(root), content, 'utf8')
}

describe('readPluginRegistry', () => {
  it('reads a missing file as an empty roster with no problem', async () => {
    const registry = await readPluginRegistry(root)
    expect(registry.plugins).toEqual([])
    expect(registry.problem).toBeUndefined()
  })

  it('reports invalid JSON instead of throwing or silently emptying', async () => {
    await seed('{ not json')
    const registry = await readPluginRegistry(root)
    expect(registry.plugins).toEqual([])
    expect(registry.problem).toMatch(/not valid JSON/)
  })

  it('reports a non-object document', async () => {
    await seed('[]')
    const registry = await readPluginRegistry(root)
    expect(registry.problem).toMatch(/not an object/)
  })

  it('drops malformed rows and keeps the usable ones', async () => {
    await seed(
      JSON.stringify({
        version: 1,
        plugins: [
          { name: 'good', version: '1.0.0' },
          { name: '', version: '1.0.0' },
          { name: 'no-version' },
          'not-an-object',
          null,
          { name: 'also-good', version: '2.0.0', disabled: true },
        ],
      }),
    )
    const registry = await readPluginRegistry(root)
    expect(registry.plugins.map((p) => p.name)).toEqual(['good', 'also-good'])
    expect(registry.problem).toBeUndefined()
  })

  it('treats a missing `disabled` as enabled, matching dsh row semantics', async () => {
    await seed(
      JSON.stringify({
        version: 1,
        plugins: [
          { name: 'default-on', version: '1.0.0' },
          { name: 'off', version: '1.0.0', disabled: true },
        ],
      }),
    )
    const registry = await readPluginRegistry(root)
    expect(enabledPlugins(registry).map((p) => p.name)).toEqual(['default-on'])
  })

  it('defaults a row id to its package name, and keeps an explicit one', async () => {
    await seed(
      JSON.stringify({
        version: 1,
        plugins: [
          { name: '@scope/dsh-tool-foo', version: '1.0.0' },
          { id: 'custom-row', name: '@scope/dsh-tool-bar', version: '1.0.0' },
        ],
      }),
    )
    const registry = await readPluginRegistry(root)
    expect(registry.plugins.map((p) => p.id)).toEqual(['@scope/dsh-tool-foo', 'custom-row'])
  })

  it('keeps a row config only when it is a plain object', async () => {
    await seed(
      JSON.stringify({
        version: 1,
        plugins: [
          { name: 'obj', version: '1.0.0', config: { a: 1 } },
          { name: 'arr', version: '1.0.0', config: [1, 2] },
        ],
      }),
    )
    const registry = await readPluginRegistry(root)
    expect(registry.plugins[0]!.config).toEqual({ a: 1 })
    expect(registry.plugins[1]!.config).toBeUndefined()
  })
})

describe('updatePluginRegistry', () => {
  it('creates the file on first write and round-trips through a read', async () => {
    await updatePluginRegistry(root, (current) => ({
      ...current,
      plugins: [...current.plugins, { id: 'first', name: 'first', version: '1.0.0' }],
    }))
    const registry = await readPluginRegistry(root)
    expect(registry.plugins).toEqual([{ id: 'first', name: 'first', version: '1.0.0' }])
  })

  it('serializes concurrent read-modify-write cycles without losing a row', async () => {
    const names = ['a', 'b', 'c', 'd', 'e']
    await Promise.all(
      names.map((name) =>
        updatePluginRegistry(root, (current) => ({
          ...current,
          plugins: [...current.plugins, { id: name, name, version: '1.0.0' }],
        })),
      ),
    )
    const registry = await readPluginRegistry(root)
    expect(registry.plugins.map((p) => p.name).sort()).toEqual(names)
  })

  it('never writes the transient `problem` field to disk', async () => {
    await seed('{ not json')
    await updatePluginRegistry(root, (current) => {
      expect(current.problem).toBeDefined()
      return { version: DSH_PLUGIN_REGISTRY_VERSION, plugins: [] }
    })
    const written = await readFile(registryPath(root), 'utf8')
    expect(written).not.toMatch(/problem/)
  })
})

describe('renderRegistry', () => {
  it('omits `problem` and ends with a newline', () => {
    const text = renderRegistry({ version: 1, plugins: [], problem: 'transient' })
    expect(text).not.toMatch(/problem/)
    expect(text.endsWith('\n')).toBe(true)
  })
})

describe('resolvePluginEntryUrl', () => {
  it('returns null when the package is not installed in the root', () => {
    expect(resolvePluginEntryUrl(root, 'absent-plugin')).toBeNull()
  })

  it('resolves an installed package to a file URL inside the root', async () => {
    const pkgDir = join(root, 'node_modules', 'fake-plugin')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'fake-plugin', version: '1.0.0', main: 'index.js' }),
    )
    await writeFile(join(pkgDir, 'index.js'), 'module.exports = {}\n')

    const url = resolvePluginEntryUrl(root, 'fake-plugin')
    expect(url).not.toBeNull()
    expect(url!.startsWith('file:')).toBe(true)
    // The resolved file must live under the plugin root — that is what makes the
    // resolver hook's importer test fire for it.
    expect(fileURLToPath(url!).startsWith(root)).toBe(true)
  })
})
