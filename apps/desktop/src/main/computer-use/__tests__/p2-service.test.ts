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

  it('apps returns grant + running from adapter', async () => {
    const snap = await service.apps()
    expect(snap.granted[0]?.bundleId).toBe('com.apple.TextEdit')
    expect(snap.running[0]?.app).toBe('TextEdit')
    expect(snap.frontmost).toBe('TextEdit')
  })
})
