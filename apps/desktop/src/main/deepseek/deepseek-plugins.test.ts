import { describe, it, expect, vi, beforeEach } from 'vitest'

const readPluginRegistry = vi.fn()
const installPluginFromDirectory = vi.fn()
const installPluginFromNpm = vi.fn()
const installPluginFromTarball = vi.fn()
const setPluginDisabled = vi.fn()
const uninstallPlugin = vi.fn()
const listBundledDshPlugins = vi.fn()
const syncPlugins = vi.fn()
const peekDeepseekRuntime = vi.fn()

vi.mock('@superone/deepseek', () => ({
  readPluginRegistry: (...args: unknown[]) => readPluginRegistry(...args),
  installPluginFromDirectory: (...args: unknown[]) => installPluginFromDirectory(...args),
  installPluginFromNpm: (...args: unknown[]) => installPluginFromNpm(...args),
  installPluginFromTarball: (...args: unknown[]) => installPluginFromTarball(...args),
  setPluginDisabled: (...args: unknown[]) => setPluginDisabled(...args),
  uninstallPlugin: (...args: unknown[]) => uninstallPlugin(...args),
  listBundledDshPlugins: (...args: unknown[]) => listBundledDshPlugins(...args),
}))

vi.mock('./deepseek-runtime-host', () => ({
  dshPluginRoot: () => '/plugins',
  shippedPresetRoot: () => '/presets',
  peekDeepseekRuntime: () => peekDeepseekRuntime(),
}))

const INSTALL_RESULT = {
  row: { id: 'p', name: 'p', version: '1.0.0' },
  lockstep: { missing: [], mismatched: [], unchecked: [] },
  unmetDependencies: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  readPluginRegistry.mockResolvedValue({ version: 1, plugins: [] })
  peekDeepseekRuntime.mockResolvedValue(null)
  installPluginFromDirectory.mockResolvedValue(INSTALL_RESULT)
  installPluginFromNpm.mockResolvedValue(INSTALL_RESULT)
  installPluginFromTarball.mockResolvedValue(INSTALL_RESULT)
  setPluginDisabled.mockResolvedValue(true)
  uninstallPlugin.mockResolvedValue(INSTALL_RESULT.row)
  listBundledDshPlugins.mockResolvedValue([
    {
      name: '@deepseek-ai/dsh-agent-loop',
      version: '0.1.0-rc.8',
      scopes: ['core'],
    },
  ])
  syncPlugins.mockResolvedValue({ outcomes: [] })
})

describe('listDshPlugins', () => {
  it('does not boot a runtime just to list', async () => {
    const { listDshPlugins } = await import('./deepseek-plugins')
    readPluginRegistry.mockResolvedValue({
      version: 1,
      plugins: [{ id: 'a', name: 'pkg-a', version: '1.0.0' }],
    })

    const list = await listDshPlugins()
    // No runtime means unknown, NOT failed — rendering it as a failure would tell
    // users their plugin is broken when they simply have no dsh session open.
    expect(list.plugins[0]!.status).toBeNull()
    expect(syncPlugins).not.toHaveBeenCalled()
  })

  it('returns bundled official plugins when the user registry is empty', async () => {
    const { listDshPlugins } = await import('./deepseek-plugins')

    await expect(listDshPlugins()).resolves.toMatchObject({
      bundled: [
        {
          name: '@deepseek-ai/dsh-agent-loop',
          version: '0.1.0-rc.8',
          scopes: ['core'],
        },
      ],
      plugins: [],
    })
    expect(listBundledDshPlugins).toHaveBeenCalledWith('/presets')
  })

  it('annotates rows with live status when a runtime is already up', async () => {
    const { listDshPlugins } = await import('./deepseek-plugins')
    readPluginRegistry.mockResolvedValue({
      version: 1,
      plugins: [
        { id: 'a', name: 'pkg-a', version: '1.0.0' },
        { id: 'b', name: 'pkg-b', version: '2.0.0', disabled: true },
      ],
    })
    syncPlugins.mockResolvedValue({
      outcomes: [{ row: { id: 'a' }, status: 'failed', reason: 'boom' }],
    })
    peekDeepseekRuntime.mockResolvedValue({ syncPlugins })

    const list = await listDshPlugins()
    expect(list.plugins[0]).toMatchObject({ status: 'failed', reason: 'boom' })
    expect(list.plugins[1]).toMatchObject({ disabled: true, status: null })
    expect(list.root).toBe('/plugins')
  })

  it('surfaces a registry problem rather than presenting an empty list as healthy', async () => {
    const { listDshPlugins } = await import('./deepseek-plugins')
    readPluginRegistry.mockResolvedValue({ version: 1, plugins: [], problem: 'bad json' })
    await expect(listDshPlugins()).resolves.toMatchObject({ problem: 'bad json' })
  })
})

describe('mutations reach the running tree', () => {
  it('reconciles after an install', async () => {
    peekDeepseekRuntime.mockResolvedValue({ syncPlugins })
    const { installDshPlugin } = await import('./deepseek-plugins')

    await installDshPlugin({ kind: 'npm', name: 'pkg', version: '1.2.3' })
    expect(installPluginFromNpm).toHaveBeenCalledWith('/plugins', 'pkg', {
      trust: 'granted',
      force: false,
      version: '1.2.3',
    })
    expect(syncPlugins).toHaveBeenCalledTimes(1)
  })

  it('routes each source to its own installer', async () => {
    const { installDshPlugin } = await import('./deepseek-plugins')
    await installDshPlugin({ kind: 'directory', path: '/src' })
    expect(installPluginFromDirectory).toHaveBeenCalledWith('/plugins', '/src', {
      trust: 'granted',
      force: false,
    })
    await installDshPlugin({ kind: 'tarball', path: '/a.tgz' })
    expect(installPluginFromTarball).toHaveBeenCalledWith('/plugins', '/a.tgz', {
      trust: 'granted',
      force: false,
    })
  })

  it('reconciles after a toggle and an uninstall', async () => {
    peekDeepseekRuntime.mockResolvedValue({ syncPlugins })
    const { setDshPluginDisabled, uninstallDshPlugin } = await import('./deepseek-plugins')

    await setDshPluginDisabled('a', true)
    await uninstallDshPlugin('a')
    expect(syncPlugins).toHaveBeenCalledTimes(2)
  })

  it('does not reconcile for a row that did not exist', async () => {
    peekDeepseekRuntime.mockResolvedValue({ syncPlugins })
    setPluginDisabled.mockResolvedValue(false)
    uninstallPlugin.mockResolvedValue(null)
    const { setDshPluginDisabled, uninstallDshPlugin } = await import('./deepseek-plugins')

    expect(await setDshPluginDisabled('ghost', true)).toBe(false)
    expect(await uninstallDshPlugin('ghost')).toBe(false)
    expect(syncPlugins).not.toHaveBeenCalled()
  })

  it('passes the trust grant on every path, so no install can skip the question', async () => {
    const { installDshPlugin } = await import('./deepseek-plugins')
    await installDshPlugin({ kind: 'npm', name: 'pkg' })
    await installDshPlugin({ kind: 'directory', path: '/src' })
    await installDshPlugin({ kind: 'tarball', path: '/a.tgz' })
    for (const spy of [installPluginFromNpm, installPluginFromDirectory, installPluginFromTarball]) {
      expect(spy.mock.calls[0]!.at(-1)).toMatchObject({ trust: 'granted' })
    }
  })
})
