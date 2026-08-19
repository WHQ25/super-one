/**
 * The wiring proof: a plugin root handed to `DeepseekRuntime.create` reaches the
 * booted runtime, and `syncPlugins()` re-reconciles a running one.
 *
 * Mount *behaviour* is covered by `mount.test.ts`; what this pins is that the
 * option is honoured and its report delivered — the part a refactor of the boot
 * sequence would silently drop.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeepseekRuntime } from '../runtime'
import { TEST_PRESET_OPTIONS } from '../test-presets'
import { installPluginFromDirectory } from './install'
import { updatePluginRegistry } from './registry'
import type { MountReport } from './mount'

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

async function writePlugin(name: string): Promise<void> {
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', type: 'module', main: 'index.js' }),
  )
  await writeFile(join(source, 'index.js'), 'export default function p() {}\n')
}

describe('runtime plugin wiring', () => {
  it('mounts installed plugins at boot and reports them', async () => {
    await writePlugin('wired-plugin')
    await installPluginFromDirectory(root, source, { trust: 'granted' })

    const reports: MountReport[] = []
    const runtime = await DeepseekRuntime.create({
      ...TEST_PRESET_OPTIONS,
      pluginRoot: root,
      onPluginMount: (report) => reports.push(report),
    })
    try {
      expect(reports).toHaveLength(1)
      expect(reports[0]!.outcomes[0]!.status).toBe('mounted')
      expect(reports[0]!.outcomes[0]!.row.name).toBe('wired-plugin')
    } finally {
      await runtime.dispose()
    }
  })

  it('picks up an install that lands after boot, without a restart', async () => {
    const reports: MountReport[] = []
    const runtime = await DeepseekRuntime.create({
      ...TEST_PRESET_OPTIONS,
      pluginRoot: root,
      onPluginMount: (report) => reports.push(report),
    })
    try {
      expect(reports[0]!.outcomes).toEqual([])

      await writePlugin('late-plugin')
      await installPluginFromDirectory(root, source, { trust: 'granted' })
      const report = await runtime.syncPlugins()

      expect(report.outcomes[0]!.status).toBe('mounted')
      expect(report.outcomes[0]!.row.name).toBe('late-plugin')
      expect(reports).toHaveLength(2)
    } finally {
      await runtime.dispose()
    }
  })

  it('boots with no plugin root configured and reconciles to nothing', async () => {
    const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS })
    try {
      await expect(runtime.syncPlugins()).resolves.toEqual({ outcomes: [] })
    } finally {
      await runtime.dispose()
    }
  })

  it('removes a row from the live tree when the registry drops it', async () => {
    await writePlugin('removable-plugin')
    await installPluginFromDirectory(root, source, { trust: 'granted' })
    const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS, pluginRoot: root })
    try {
      await updatePluginRegistry(root, (current) => ({ ...current, plugins: [] }))
      await expect(runtime.syncPlugins()).resolves.toEqual({ outcomes: [] })
    } finally {
      await runtime.dispose()
    }
  })
})
