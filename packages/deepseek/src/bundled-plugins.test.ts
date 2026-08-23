import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listBundledDshPlugins } from './bundled-plugins'

let root: string | undefined

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('bundled dsh plugin catalog', () => {
  it('combines core plugins with the shipped presets that reference each plugin', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-bundled-plugins-'))
    for (const preset of ['standard', 'code']) {
      await mkdir(join(root, preset))
    }
    await writeFile(
      join(root, 'standard', 'agent.cordis.yml'),
      "- id: todo\n  name: '@deepseek-ai/dsh-tool-todo'\n",
    )
    await writeFile(
      join(root, 'code', 'agent.cordis.yml'),
      "- id: todo\n  name: '@deepseek-ai/dsh-tool-todo'\n",
    )

    const plugins = await listBundledDshPlugins(root)

    expect(plugins).toContainEqual({
      name: '@deepseek-ai/dsh-tool-todo',
      version: '0.1.1-rc.2',
      scopes: ['code', 'standard'],
    })
    expect(plugins).toContainEqual({
      name: '@deepseek-ai/dsh-agent-loop',
      version: '0.1.1-rc.2',
      scopes: ['core'],
    })
  })

  it('still reports core plugins when the shipped preset root is unavailable', async () => {
    const plugins = await listBundledDshPlugins('/missing/preset/root')

    expect(plugins.some((plugin) => plugin.scopes.includes('core'))).toBe(true)
  })

  it('covers the shipped compositions with the dependency versions in this build', async () => {
    const presetRoot = join(import.meta.dirname, '../../../apps/desktop/resources/agent-presets')
    const manifest = JSON.parse(
      await readFile(join(import.meta.dirname, '../package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> }

    const plugins = await listBundledDshPlugins(presetRoot)

    expect(plugins.length).toBeGreaterThan(40)
    expect(plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '@deepseek-ai/dsh-tool-todo', scopes: ['code', 'cordis', 'standard'] }),
      expect.objectContaining({ name: '@deepseek-ai/dsh-tool-cordis', scopes: ['cordis'] }),
      expect.objectContaining({ name: '@deepseek-ai/dsh-tool-str-replace-editor', scopes: ['minimal'] }),
    ]))
    for (const plugin of plugins) {
      const packageName = plugin.name.match(/^@deepseek-ai\/[^/]+/)?.[0]
      expect(plugin.version, plugin.name).toBe(manifest.dependencies[packageName!])
    }
  })
})
