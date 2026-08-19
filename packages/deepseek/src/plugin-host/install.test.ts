import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, realpath, stat, readFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c as createTar } from 'tar'
import {
  setPluginDisabled,
  uninstallPlugin,
  checkPeerLockstep,
  installPluginFromDirectory,
  installPluginFromNpm,
  installPluginFromTarball,
  lockstepBlocks,
  readPluginManifest,
} from './install'
import { readPluginRegistry } from './registry'
import { dshPluginRoots, resetDshPluginRoots } from './resolver'

let root: string
let source: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-root-')))
  source = await realpath(await mkdtemp(join(tmpdir(), 'dsh-src-')))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(source, { recursive: true, force: true })
})

/** Write a plugin source tree with the given manifest fields. */
async function writePlugin(manifest: Record<string, unknown>): Promise<void> {
  await writeFile(join(source, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(source, 'index.js'), 'export default function plugin() {}\n')
}

describe('readPluginManifest', () => {
  it('rejects a manifest with no name or no version', async () => {
    await writeFile(join(source, 'package.json'), JSON.stringify({ version: '1.0.0' }))
    await expect(readPluginManifest(source)).rejects.toThrow(/no name/)
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'x' }))
    await expect(readPluginManifest(source)).rejects.toThrow(/no version/)
  })
})

describe('checkPeerLockstep', () => {
  it('ignores peers outside the dsh family — the plugin owns those', () => {
    const report = checkPeerLockstep({
      name: 'p', version: '1.0.0',
      peerDependencies: { react: '^18.0.0', 'left-pad': '*' },
    })
    expect(report).toEqual({ missing: [], mismatched: [], unchecked: [] })
  })

  it('accepts the prerelease range npm generates against this build', () => {
    // `npm install @deepseek-ai/dsh-tools` writes `^0.1.0-rc.8`, which is the
    // range a real plugin carries.
    const report = checkPeerLockstep({
      name: 'p', version: '1.0.0',
      peerDependencies: { '@deepseek-ai/dsh-tools': '^0.1.0-rc.8' },
    })
    expect(lockstepBlocks(report)).toBe(false)
  })

  it('flags a release-anchored range, because a prerelease sorts below its release', () => {
    // `^0.1.0` means `>=0.1.0`, and `0.1.0-rc.8 < 0.1.0`. A plugin written
    // against the eventual 0.1.0 release genuinely does not run on this build,
    // and saying so at install time beats a mid-turn crash. Expected to bite
    // plugin authors, so it is pinned rather than left to be rediscovered.
    const report = checkPeerLockstep({
      name: 'p', version: '1.0.0',
      peerDependencies: { '@deepseek-ai/dsh-tools': '^0.1.0' },
    })
    expect(report.mismatched).toEqual([
      { name: '@deepseek-ai/dsh-tools', wanted: '^0.1.0', actual: '0.1.0-rc.8' },
    ])
  })

  it('flags a peer whose declared range excludes the app copy', () => {
    const report = checkPeerLockstep({
      name: 'p', version: '1.0.0',
      peerDependencies: { '@deepseek-ai/cordis': '^99.0.0' },
    })
    expect(report.mismatched).toEqual([
      { name: '@deepseek-ai/cordis', wanted: '^99.0.0', actual: '4.0.1' },
    ])
    expect(lockstepBlocks(report)).toBe(true)
  })

  it('flags a family peer this build does not carry at all', () => {
    const report = checkPeerLockstep({
      name: 'p', version: '1.0.0',
      peerDependencies: { '@deepseek-ai/dsh-does-not-exist': '^0.1.0' },
    })
    expect(report.missing).toEqual(['@deepseek-ai/dsh-does-not-exist'])
    expect(lockstepBlocks(report)).toBe(true)
  })

  it('reports `workspace:^` as unchecked rather than blocking a local plugin', () => {
    const report = checkPeerLockstep({
      name: 'p', version: '1.0.0',
      peerDependencies: { '@deepseek-ai/dsh-tools': 'workspace:^' },
    })
    expect(report.unchecked).toEqual(['@deepseek-ai/dsh-tools'])
    expect(lockstepBlocks(report)).toBe(false)
  })
})

describe('installPluginFromDirectory', () => {
  it('copies the plugin under node_modules and records a row', async () => {
    await writePlugin({ name: 'my-plugin', version: '2.1.0', type: 'module', main: 'index.js' })
    const { row } = await installPluginFromDirectory(root, source, { trust: 'granted' })

    expect(row).toEqual({ id: 'my-plugin', name: 'my-plugin', version: '2.1.0' })
    await expect(stat(join(root, 'node_modules', 'my-plugin', 'index.js'))).resolves.toBeTruthy()

    const registry = await readPluginRegistry(root)
    expect(registry.plugins).toEqual([row])
  })

  it('refuses an incompatible plugin, and installs it under force', async () => {
    await writePlugin({
      name: 'bad-plugin', version: '1.0.0', type: 'module', main: 'index.js',
      peerDependencies: { '@deepseek-ai/cordis': '^99.0.0' },
    })
    await expect(installPluginFromDirectory(root, source, { trust: 'granted' })).rejects.toThrow(/not compatible/)
    expect((await readPluginRegistry(root)).plugins).toEqual([])

    const { lockstep } = await installPluginFromDirectory(root, source, { trust: 'granted', force: true })
    expect(lockstep.mismatched).toHaveLength(1)
    expect((await readPluginRegistry(root)).plugins).toHaveLength(1)
  })

  it('replaces the row on reinstall instead of duplicating it', async () => {
    await writePlugin({ name: 'my-plugin', version: '1.0.0', type: 'module', main: 'index.js' })
    await installPluginFromDirectory(root, source, { trust: 'granted' })
    await writePlugin({ name: 'my-plugin', version: '1.1.0', type: 'module', main: 'index.js' })
    await installPluginFromDirectory(root, source, { trust: 'granted' })

    const registry = await readPluginRegistry(root)
    expect(registry.plugins).toHaveLength(1)
    expect(registry.plugins[0]!.version).toBe('1.1.0')
  })

  it('honours an explicit row id, so one package can be recorded under a chosen row', async () => {
    await writePlugin({ name: 'my-plugin', version: '1.0.0', type: 'module', main: 'index.js' })
    const { row } = await installPluginFromDirectory(root, source, { trust: 'granted', id: 'custom', config: { a: 1 } })
    expect(row).toEqual({ id: 'custom', name: 'my-plugin', version: '1.0.0', config: { a: 1 } })
  })
})

describe('plugin root registration on install', () => {
  it('registers the root by its realpath once the install creates it', async () => {
    resetDshPluginRoots()
    const missing = join(root, 'not-created-yet')
    await writePlugin({ name: 'late-plugin', version: '1.0.0', type: 'module', main: 'index.js' })
    await installPluginFromDirectory(missing, source, { trust: 'granted' })
    // A root that did not exist at registration time could only be recorded
    // lexically; after the install it must be present as a prefix that
    // importers under it actually match.
    const prefixes = dshPluginRoots()
    expect(prefixes.some((prefix) => join(missing, 'node_modules').startsWith(prefix))).toBe(true)
  })
})

/** Pack `source` the way npm does: every entry under a `package/` prefix. */
async function packSource(): Promise<string> {
  const staging = await mkdtemp(join(tmpdir(), 'dsh-pack-'))
  const layout = join(staging, 'package')
  await mkdir(layout, { recursive: true })
  await cp(source, layout, { recursive: true })
  const tarball = join(staging, 'plugin.tgz')
  await createTar({ file: tarball, cwd: staging, gzip: true }, ['package'])
  return tarball
}

describe('installPluginFromTarball', () => {
  it('strips the npm `package/` prefix and installs what is inside', async () => {
    await writePlugin({ name: 'packed-plugin', version: '3.0.0', type: 'module', main: 'index.js' })
    const tarball = await packSource()

    const { row } = await installPluginFromTarball(root, tarball, { trust: 'granted' })
    expect(row).toEqual({ id: 'packed-plugin', name: 'packed-plugin', version: '3.0.0' })
    await expect(stat(join(root, 'node_modules', 'packed-plugin', 'index.js'))).resolves.toBeTruthy()
  })

  it('leaves the plugin root untouched when the archive is not a tarball', async () => {
    const bogus = join(source, 'not-a-tarball.tgz')
    await writeFile(bogus, 'definitely not gzip')
    await expect(installPluginFromTarball(root, bogus, { trust: 'granted' })).rejects.toThrow()
    expect((await readPluginRegistry(root)).plugins).toEqual([])
  })
})

describe('installPluginFromNpm', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves metadata, downloads the tarball, and installs it', async () => {
    await writePlugin({ name: 'remote-plugin', version: '1.2.3', type: 'module', main: 'index.js' })
    const tarball = await packSource()
    const bytes = await readFile(tarball)

    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(String(url))
      if (String(url).endsWith('/latest')) {
        return new Response(JSON.stringify({ dist: { tarball: 'https://example.test/remote-plugin.tgz' } }))
      }
      return new Response(bytes)
    })

    const { row } = await installPluginFromNpm(root, 'remote-plugin', { trust: 'granted' })
    expect(row.version).toBe('1.2.3')
    expect(seen[0]).toBe('https://registry.npmjs.org/remote-plugin/latest')
  })

  it('escapes a scoped name in the metadata URL', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(String(url))
      return new Response('nope', { status: 404 })
    })
    await expect(
      installPluginFromNpm(root, '@scope/dsh-tool-foo', { trust: 'granted', version: '2.0.0' }),
    ).rejects.toThrow(/cannot resolve/)
    expect(seen[0]).toBe('https://registry.npmjs.org/@scope%2fdsh-tool-foo/2.0.0')
  })

  it('reports a package whose metadata carries no tarball URL', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ dist: {} })))
    await expect(installPluginFromNpm(root, 'empty-plugin', { trust: 'granted' })).rejects.toThrow(
      /no tarball URL/,
    )
  })
})

describe('unmet dependencies', () => {
  it('reports a plugin\'s own runtime dependencies, since nothing installs them', async () => {
    await writePlugin({
      name: 'needy-plugin', version: '1.0.0', type: 'module', main: 'index.js',
      dependencies: { 'left-pad': '^1.0.0', lodash: '^4.0.0' },
    })
    const { unmetDependencies } = await installPluginFromDirectory(root, source, { trust: 'granted' })
    expect(unmetDependencies.sort()).toEqual(['left-pad', 'lodash'])
  })
})

describe('uninstallPlugin', () => {
  it('drops the row and deletes the package directory', async () => {
    await writePlugin({ name: 'doomed-plugin', version: '1.0.0', type: 'module', main: 'index.js' })
    await installPluginFromDirectory(root, source, { trust: 'granted' })

    const removed = await uninstallPlugin(root, 'doomed-plugin')
    expect(removed?.name).toBe('doomed-plugin')
    expect((await readPluginRegistry(root)).plugins).toEqual([])
    await expect(stat(join(root, 'node_modules', 'doomed-plugin'))).rejects.toThrow()
  })

  it('keeps the files when another row still names the same package', async () => {
    await writePlugin({ name: 'shared-plugin', version: '1.0.0', type: 'module', main: 'index.js' })
    await installPluginFromDirectory(root, source, { trust: 'granted', id: 'row-a' })
    await installPluginFromDirectory(root, source, { trust: 'granted', id: 'row-b' })

    await uninstallPlugin(root, 'row-a')
    expect((await readPluginRegistry(root)).plugins.map((p) => p.id)).toEqual(['row-b'])
    // row-b still needs them.
    await expect(stat(join(root, 'node_modules', 'shared-plugin'))).resolves.toBeTruthy()
  })

  it('answers null for an unknown row', async () => {
    await expect(uninstallPlugin(root, 'never-installed')).resolves.toBeNull()
  })
})

describe('setPluginDisabled', () => {
  it('toggles a row without touching its files', async () => {
    await writePlugin({ name: 'toggle-plugin', version: '1.0.0', type: 'module', main: 'index.js' })
    await installPluginFromDirectory(root, source, { trust: 'granted' })

    expect(await setPluginDisabled(root, 'toggle-plugin', true)).toBe(true)
    expect((await readPluginRegistry(root)).plugins[0]!.disabled).toBe(true)

    expect(await setPluginDisabled(root, 'toggle-plugin', false)).toBe(true)
    expect((await readPluginRegistry(root)).plugins[0]!.disabled).toBeUndefined()

    await expect(stat(join(root, 'node_modules', 'toggle-plugin'))).resolves.toBeTruthy()
  })

  it('reports an unknown row instead of inventing one', async () => {
    expect(await setPluginDisabled(root, 'nope', true)).toBe(false)
  })
})
