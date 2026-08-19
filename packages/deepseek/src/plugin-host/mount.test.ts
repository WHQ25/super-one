import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { createDeepseekTree } from '../tree'
import { installPluginFromDirectory } from './install'
import { DeepseekPlugins } from './mount'
import { updatePluginRegistry } from './registry'

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

/**
 * A plugin that reports the `Context` class it resolved and counts its mounts,
 * so a test can assert both that it ran and that it ran in OUR module graph.
 */
const PLUGIN_SOURCE = `
import { Context } from '@deepseek-ai/cordis'
export const observed = { contextClass: Context, mounts: 0, config: null }
export default function testPlugin(ctx, config) {
  observed.mounts += 1
  observed.config = config ?? null
}
`

async function writePlugin(name: string, body = PLUGIN_SOURCE): Promise<void> {
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', type: 'module', main: 'index.js' }),
  )
  await writeFile(join(source, 'index.js'), body)
}

/** A tree carrying the Loader, which is the seam plugins mount through. */
async function treeWithLoader(): Promise<Context> {
  return await createDeepseekTree({})
}

describe('DeepseekPlugins.sync', () => {
  it('mounts an external plugin, with module identity intact', async () => {
    await writePlugin('identity-plugin')
    await installPluginFromDirectory(root, source, { trust: 'granted', config: { hello: 'world' } })

    const report = await new DeepseekPlugins(await treeWithLoader(), root).sync()
    expect(report.outcomes).toHaveLength(1)
    expect(report.outcomes[0]!.status).toBe('mounted')

    const entry = pathToFileURL(join(root, 'node_modules', 'identity-plugin', 'index.js')).href
    const { observed } = (await import(/* @vite-ignore */ entry)) as {
      observed: { contextClass: unknown; mounts: number; config: unknown }
    }
    expect(observed.mounts).toBe(1)
    expect(observed.config).toEqual({ hello: 'world' })
    // The whole point of the resolver hook: the plugin's `Context` is OUR
    // `Context`, not a second copy resolved from its own tree.
    expect(observed.contextClass).toBe(Context)
  })

  it('reaches a running tree: a row disabled after boot unmounts on the next sync', async () => {
    await writePlugin('hot-plugin')
    await installPluginFromDirectory(root, source, { trust: 'granted' })

    const plugins = new DeepseekPlugins(await treeWithLoader(), root)
    expect((await plugins.sync()).outcomes[0]!.status).toBe('mounted')

    await updatePluginRegistry(root, (current) => ({
      ...current,
      plugins: current.plugins.map((row) => ({ ...row, disabled: true })),
    }))
    // No restart: the same registrar reconciles the live tree.
    expect((await plugins.sync()).outcomes).toEqual([])

    await updatePluginRegistry(root, (current) => ({
      ...current,
      plugins: current.plugins.map(({ disabled: _drop, ...row }) => row),
    }))
    expect((await plugins.sync()).outcomes[0]!.status).toBe('mounted')
  })

  it('is idempotent: re-syncing an unchanged registry does not remount', async () => {
    await writePlugin('stable-plugin')
    await installPluginFromDirectory(root, source, { trust: 'granted' })
    const plugins = new DeepseekPlugins(await treeWithLoader(), root)
    await plugins.sync()
    await plugins.sync()

    const entry = pathToFileURL(join(root, 'node_modules', 'stable-plugin', 'index.js')).href
    const { observed } = (await import(/* @vite-ignore */ entry)) as { observed: { mounts: number } }
    expect(observed.mounts).toBe(1)
  })

  it('reports a row whose package is gone instead of throwing', async () => {
    await updatePluginRegistry(root, (current) => ({
      ...current,
      plugins: [{ id: 'ghost', name: 'ghost', version: '1.0.0' }],
    }))
    const report = await new DeepseekPlugins(await treeWithLoader(), root).sync()
    expect(report.outcomes[0]!.status).toBe('unresolved')
    expect(report.outcomes[0]!.reason).toMatch(/not present/)
  })

  it('isolates a plugin that throws on load — one bad package must not sink the tree', async () => {
    await writePlugin('exploding-plugin', 'throw new Error("boom at module scope")\n')
    await installPluginFromDirectory(root, source, { trust: 'granted' })
    const report = await new DeepseekPlugins(await treeWithLoader(), root).sync()
    expect(report.outcomes[0]!.status).toBe('failed')
    expect(report.outcomes[0]!.reason).toMatch(/boom at module scope/)
  })

  it('carries a corrupt registry through instead of silently mounting nothing', async () => {
    await writeFile(join(root, 'registry.json'), '{ not json', 'utf8')
    const report = await new DeepseekPlugins(await treeWithLoader(), root).sync()
    expect(report.registryProblem).toMatch(/not valid JSON/)
  })

  it('reports a tree with no loader rather than failing silently', async () => {
    await writePlugin('needs-loader')
    await installPluginFromDirectory(root, source, { trust: 'granted' })
    const report = await new DeepseekPlugins(new Context(), root).sync()
    expect(report.registryProblem).toMatch(/no `loader` service/)
  })

  it('does nothing at all without a configured root', async () => {
    const report = await new DeepseekPlugins(await treeWithLoader(), undefined).sync()
    expect(report).toEqual({ outcomes: [] })
  })
})
