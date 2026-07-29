import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ComputerUseService } from '../computer-use-service'
import { ComputerUsePolicy } from '../policy'
import type { PlatformAdapter, PlatformLook } from '../platform/types'
import type { UiRootIdentity } from '../types'

function makeRoot(): UiRootIdentity {
  return {
    rootId: '@r1',
    kind: 'window',
    app: 'TextEdit',
    bundleId: 'com.apple.TextEdit',
    pid: 7,
    title: 'Untitled',
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    focused: true,
    visible: true,
    minimized: false,
    modal: false,
    resourceKey: 'pid:7',
  }
}

function visualLook(root: UiRootIdentity): PlatformLook {
  return {
    root,
    outline: {
      ref: '@e1',
      role: 'screen',
      name: root.title,
      pictureOnly: true,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    },
    image: { mimeType: 'image/png', data: 'xx', width: 800, height: 600 },
    coordinateSpace: { width: 800, height: 600, scale: 2, fullScreen: true },
    nativeLookId: 'n1',
  }
}

describe('P2 service policy + foreground gate', () => {
  let adapter: PlatformAdapter
  let policy: ComputerUsePolicy
  let service: ComputerUseService
  let frontmostBundle: string

  beforeEach(() => {
    frontmostBundle = 'com.apple.TextEdit'
    const root = makeRoot()
    adapter = {
      listRoots: vi.fn(async () => [root]),
      look: vi.fn(async (r) => visualLook(r)),
      act: vi.fn(async () => ({
        steps: [{ applied: true, unknown: true, description: 'click' }],
      })),
      listApps: vi.fn(async () => [
        { app: 'TextEdit', bundleId: 'com.apple.TextEdit', pid: 7, frontmost: true },
      ]),
      frontmost: vi.fn(async () => ({
        app: 'TextEdit',
        bundleId: frontmostBundle,
        pid: 7,
      })),
      focusApp: vi.fn(async () => {}),
      launchApp: vi.fn(async () => {}),
      zoom: vi.fn(async () => ({
        mimeType: 'image/png',
        data: 'zoom',
        width: 100,
        height: 100,
      })),
    }
    policy = new ComputerUsePolicy()
    policy.setEnabled(true)
    policy.grant({ app: 'TextEdit', bundleId: 'com.apple.TextEdit', tier: 'full' })
    service = new ComputerUseService({ adapter, policy })
  })

  it('default delivery is app-directed and does not require frontmost', async () => {
    frontmostBundle = 'com.google.Chrome' // user is elsewhere
    const obs = await service.observe()
    const result = await service.act(obs.stateId, [{ type: 'click', x: 10, y: 20 }])
    expect(result.outcome).toBe('unknown') // no AX verify yet
    expect(result.grounding).toBe('app-directed')
    expect(adapter.act).toHaveBeenCalledWith(
      expect.objectContaining({ delivery: 'app-directed' }),
    )
    expect(adapter.frontmost).not.toHaveBeenCalled()
  })

  it('defaults to window capture and preserves explicit display scope', async () => {
    const windowObs = await service.observe()
    expect(windowObs.capture).toBe('window')
    expect(adapter.look).toHaveBeenLastCalledWith(expect.anything(), 'fused', 'window')

    const displayObs = await service.observe(undefined, 'fused', 'display')
    expect(displayObs.capture).toBe('display')
    await service.zoom(displayObs.stateId, [0, 0, 100, 100])
    expect(adapter.zoom).toHaveBeenCalledWith(
      expect.anything(),
      [0, 0, 100, 100],
      displayObs.coordinateSpace,
    )

    await service.waitFor(displayObs.stateId, { kind: 'exists', ref: '@e1' }, 100)
    expect(adapter.look).toHaveBeenLastCalledWith(expect.anything(), 'fused', 'display')

    const acted = await service.act(displayObs.stateId, [{ type: 'click', x: 10, y: 20 }])
    expect(adapter.look).toHaveBeenLastCalledWith(expect.anything(), 'fused', 'display')
    expect(service.getStateStore().get(acted.successorStateId)?.capture).toBe('display')
  })

  it('blocks physical act when frontmost mismatches', async () => {
    frontmostBundle = 'com.google.Chrome'
    const obs = await service.observe()
    await expect(
      service.act(obs.stateId, [{ type: 'click', x: 10, y: 20 }], { delivery: 'physical' }),
    ).rejects.toMatchObject({ code: 'TIER_BLOCKED' })
    expect(adapter.act).not.toHaveBeenCalled()
  })

  it('allows physical act when frontmost matches', async () => {
    frontmostBundle = 'com.apple.TextEdit'
    const obs = await service.observe()
    const result = await service.act(obs.stateId, [{ type: 'click', x: 10, y: 20 }], {
      delivery: 'physical',
    })
    expect(result.grounding).toBe('physical')
    expect(adapter.act).toHaveBeenCalled()
  })

  it('exposes grantedBundleIds for capture exclusion', () => {
    expect(service.grantedBundleIds()).toEqual(['com.apple.TextEdit'])
  })

  it('allowAllApps skips per-app grant checks', async () => {
    const locked = new ComputerUseService({ adapter, policy: new ComputerUsePolicy() })
    locked.policy.setEnabled(true)
    // no grants
    await expect(locked.observe()).rejects.toMatchObject({ code: 'NOT_GRANTED' })

    locked.policy.setAllowAllApps(true)
    const obs = await locked.observe()
    expect(obs.stateId).toBeTruthy()
    expect(locked.isAllowAllApps()).toBe(true)
    expect(locked.grantedBundleIds()).toEqual([])
  })

  it('apps list returns a paginated catalog from adapter', async () => {
    const snap = await service.apps()
    expect(snap.action).toBe('list')
    if (snap.action !== 'list') return
    expect(snap.apps.some((a) => a.bundleId === 'com.apple.TextEdit')).toBe(true)
    expect(snap.apps.find((a) => a.bundleId === 'com.apple.TextEdit')?.running).toBe(true)
    expect(snap.frontmost).toBe('TextEdit')
    expect(snap.total).toBeGreaterThan(0)
  })

  it('returns the explicit app affected by launch', async () => {
    const snap = await service.apps('launch', 'textedit')

    // Launch is re-keyed to the reverse-DNS bundle id once identity is resolved.
    expect(adapter.launchApp).toHaveBeenCalledWith('com.apple.TextEdit')
    expect(snap.action).toBe('launch')
    expect(snap.target).toEqual({
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      pid: 7,
      rootId: '@r1',
    })
  })

  it('waits for a cold-launched app to appear in the running list', async () => {
    const { setResolveInstalledAppForTests, clearInstalledAppCacheForTests } =
      await import('../resolve-installed-app')
    setResolveInstalledAppForTests(async (q) => {
      if (q === 'Doubao' || q === '豆包' || q === 'com.bot.pc.doubao') {
        return {
          app: 'Doubao',
          bundleId: 'com.bot.pc.doubao',
          path: '/Applications/Doubao.app',
          aliases: ['Doubao', '豆包', 'com.bot.pc.doubao'],
        }
      }
      return null
    })

    vi.useFakeTimers()
    const baseRoot = makeRoot()
    const doubaoRoot = {
      kind: 'window' as const,
      app: 'Doubao',
      bundleId: 'com.bot.pc.doubao',
      pid: 42,
      title: '豆包',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      focused: false,
      visible: true,
      minimized: false,
      modal: false,
      resourceKey: 'pid:42',
    }
    let launched = false
    let launchPolls = 0
    vi.mocked(adapter.listRoots).mockImplementation(async () => {
      // Window appears once the process has been observed at least once.
      if (launched && launchPolls > 0) return [baseRoot, doubaoRoot]
      return [baseRoot]
    })
    vi.mocked(adapter.listApps!).mockImplementation(async () => {
      const running = [
        { app: 'TextEdit', bundleId: 'com.apple.TextEdit', pid: 7, frontmost: true },
      ]
      if (launched && launchPolls++ > 0) {
        running.push({
          app: 'Doubao',
          bundleId: 'com.bot.pc.doubao',
          pid: 42,
          frontmost: false,
        })
      }
      return running
    })
    vi.mocked(adapter.launchApp!).mockImplementation(async () => {
      launched = true
    })

    try {
      const resultPromise = service.apps('launch', 'Doubao')
      // Process poll (100ms) + optional root poll (100ms) under fake timers.
      await vi.advanceTimersByTimeAsync(2000)
      await expect(resultPromise).resolves.toMatchObject({
        target: {
          app: 'Doubao',
          bundleId: 'com.bot.pc.doubao',
          pid: 42,
          rootId: expect.stringMatching(/^@r\d+$/),
        },
      })
      expect(adapter.launchApp).toHaveBeenCalledWith('com.bot.pc.doubao')
    } finally {
      vi.useRealTimers()
      clearInstalledAppCacheForTests()
    }
  })

  it('resolves Chinese display name 豆包 to the real bundle id before launch', async () => {
    const { setResolveInstalledAppForTests, clearInstalledAppCacheForTests } =
      await import('../resolve-installed-app')
    setResolveInstalledAppForTests(async () => ({
      app: '豆包',
      bundleId: 'com.bot.pc.doubao',
      path: '/Applications/Doubao.app',
      aliases: ['豆包', 'Doubao', 'com.bot.pc.doubao'],
    }))
    const doubaoRoot = {
      kind: 'window' as const,
      app: 'Doubao',
      bundleId: 'com.bot.pc.doubao',
      pid: 42,
      title: '豆包',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      focused: false,
      visible: true,
      minimized: false,
      modal: false,
      resourceKey: 'pid:42',
    }
    vi.mocked(adapter.listRoots).mockResolvedValue([doubaoRoot])
    vi.mocked(adapter.listApps!).mockResolvedValue([
      { app: 'Doubao', bundleId: 'com.bot.pc.doubao', pid: 42, frontmost: false },
    ])

    try {
      const identity = await service.resolveAppIdentity('豆包')
      expect(identity).toEqual({ app: 'Doubao', bundleId: 'com.bot.pc.doubao' })

      const snap = await service.apps('launch', '豆包')
      expect(adapter.launchApp).toHaveBeenCalledWith('com.bot.pc.doubao')
      expect(snap.target?.bundleId).toBe('com.bot.pc.doubao')
      expect(snap.target?.rootId).toMatch(/^@r\d+$/)
    } finally {
      clearInstalledAppCacheForTests()
    }
  })

  it('returns cached target identity from query and wait', async () => {
    const observation = await service.observe()
    const query = await service.query(observation.stateId, 'inspect', { ref: '@e1' })
    const wait = await service.waitFor(
      observation.stateId,
      { kind: 'exists', ref: '@e1' },
      100,
    )

    expect(query.root).toEqual({
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      title: 'Untitled',
    })
    expect(wait.successorRoot).toEqual(query.root)
  })
})
