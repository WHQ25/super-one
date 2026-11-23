import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CLIENT_PLUGIN_API_VERSION,
  DSH_PLUGIN_REGISTRY_VERSION,
  enabledPlugins,
  readClientPluginEntries,
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

describe('readClientPluginEntries', () => {
  async function writeFakePackage(
    pkgName: string,
    manifest: Record<string, unknown>,
    files: Record<string, string> = {},
  ): Promise<string> {
    const pkgDir = join(root, 'node_modules', ...pkgName.split('/'))
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify(manifest), 'utf8')
    for (const [rel, content] of Object.entries(files)) {
      const target = join(pkgDir, ...rel.split('/'))
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, content, 'utf8')
    }
    return pkgDir
  }

  it('reads superone.client entries with apiVersion 1, including scoped packages and styles', async () => {
    await writeFakePackage(
      '@acme/dsh-sample',
      {
        name: '@acme/dsh-sample',
        version: '1.2.3',
        superone: {
          client: {
            entry: './dist/client.js',
            styles: ['dist/client.css'],
            apiVersion: CLIENT_PLUGIN_API_VERSION,
          },
        },
      },
      {
        'dist/client.js': 'export default function() {}\n',
        'dist/client.css': ':root {}\n',
      },
    )
    await seed(
      JSON.stringify({
        version: 1,
        plugins: [{ id: '@acme/dsh-sample', name: '@acme/dsh-sample', version: '1.2.3' }],
      }),
    )

    const result = await readClientPluginEntries(root)
    expect(result.problems).toEqual([])
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      id: '@acme/dsh-sample',
      name: '@acme/dsh-sample',
      version: '1.2.3',
      apiVersion: 1,
      entry: 'dist/client.js',
      styles: ['dist/client.css'],
    })
    expect(result.entries[0]!.entryUrl).toMatch(
      /^superone-plugin:\/\/pkg\/%40acme%2Fdsh-sample\/dist\/client\.js\?v=1\.2\.3-\d+$/,
    )
    expect(result.entries[0]!.styleUrls[0]).toMatch(
      /^superone-plugin:\/\/pkg\/%40acme%2Fdsh-sample\/dist\/client\.css\?v=1\.2\.3-\d+$/,
    )
  })

  it('skips disabled rows, ignores upstream dsh.client, and skips node-only plugins', async () => {
    await writeFakePackage(
      'disabled-ui',
      {
        name: 'disabled-ui',
        version: '1.0.0',
        superone: { client: { entry: 'client.js', apiVersion: 1 } },
      },
      { 'client.js': 'export default () => {}\n' },
    )
    await writeFakePackage(
      'upstream-dsh-only',
      {
        name: 'upstream-dsh-only',
        version: '1.0.0',
        dsh: { client: { entry: 'dsh-client.js' } },
      },
      { 'dsh-client.js': 'export default () => {}\n' },
    )
    await seed(
      JSON.stringify({
        version: 1,
        plugins: [
          { id: 'disabled-ui', name: 'disabled-ui', version: '1.0.0', disabled: true },
          { id: 'upstream-dsh-only', name: 'upstream-dsh-only', version: '1.0.0' },
        ],
      }),
    )

    const result = await readClientPluginEntries(root)
    expect(result.entries).toEqual([])
    expect(result.problems).toEqual([])
  })

  it('reports problems for apiVersion mismatch, malformed manifests, and path traversal', async () => {
    await writeFakePackage(
      'bad-version',
      {
        name: 'bad-version',
        version: '1.0.0',
        superone: { client: { entry: 'client.js', apiVersion: 2 } },
      },
      { 'client.js': 'export {}\n' },
    )
    await writeFakePackage(
      'traversal-entry',
      {
        name: 'traversal-entry',
        version: '1.0.0',
        superone: { client: { entry: '../escape.js', apiVersion: 1 } },
      },
    )
    const malformedDir = join(root, 'node_modules', 'malformed-json')
    await mkdir(malformedDir, { recursive: true })
    await writeFile(join(malformedDir, 'package.json'), '{bad', 'utf8')

    await seed(
      JSON.stringify({
        version: 1,
        plugins: [
          { id: 'bad-version', name: 'bad-version', version: '1.0.0' },
          { id: 'traversal-entry', name: 'traversal-entry', version: '1.0.0' },
          { id: 'malformed-json', name: 'malformed-json', version: '1.0.0' },
          { id: 'missing-pkg', name: 'missing-pkg', version: '1.0.0' },
        ],
      }),
    )

    const result = await readClientPluginEntries(root)
    expect(result.entries).toEqual([])
    expect(result.problems.map((p) => p.id)).toEqual([
      'bad-version',
      'traversal-entry',
      'malformed-json',
      'missing-pkg',
    ])
    expect(result.problems[0]!.reason).toMatch(/apiVersion/)
  })

  it('supports symlinked local dev plugin directory while blocking escaping symlinks', async () => {
    const externalSrc = await realpath(await mkdtemp(join(tmpdir(), 'dsh-dev-src-')))
    const outsideSecret = join(externalSrc, '..', 'outside.js')
    try {
      await writeFile(
        join(externalSrc, 'package.json'),
        JSON.stringify({
          name: 'linked-dev',
          version: '0.1.0',
          superone: { client: { entry: 'dist/client.js', apiVersion: 1 } },
        }),
      )
      await mkdir(join(externalSrc, 'dist'), { recursive: true })
      await writeFile(join(externalSrc, 'dist', 'client.js'), 'export default () => {}\n')
      await writeFile(outsideSecret, 'secret\n')
      await symlink(outsideSecret, join(externalSrc, 'dist', 'escape.js'))

      await mkdir(join(root, 'node_modules'), { recursive: true })
      await symlink(externalSrc, join(root, 'node_modules', 'linked-dev'))
      await seed(
        JSON.stringify({
          version: 1,
          plugins: [{ id: 'linked-dev', name: 'linked-dev', version: '0.1.0' }],
        }),
      )

      const okResult = await readClientPluginEntries(root)
      expect(okResult.entries).toHaveLength(1)

      await writeFile(
        join(externalSrc, 'package.json'),
        JSON.stringify({
          name: 'linked-dev',
          version: '0.1.0',
          superone: { client: { entry: 'dist/escape.js', apiVersion: 1 } },
        }),
      )
      const escapedResult = await readClientPluginEntries(root)
      expect(escapedResult.entries).toEqual([])
      expect(escapedResult.problems).toHaveLength(1)
    } finally {
      await rm(externalSrc, { recursive: true, force: true })
      await rm(outsideSecret, { force: true })
    }
  })
})
