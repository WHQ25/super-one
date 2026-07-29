import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ComputerUsePolicy } from '../policy'
import {
  clearPendingComputerUseGrants,
  resolveComputerUseGrant,
  rejectComputerUseGrant,
  ensureComputerUseAppGrant,
  setComputerUseGrantDepsForTests,
} from '../grant-request'
import { ComputerUseService } from '../computer-use-service'
import type { PlatformAdapter, PlatformLook } from '../platform/types'
import type { UiRootIdentity } from '../types'

const mockSettingsState = {
  computerUseAlwaysAllowApps: [] as Array<{ app: string; bundleId: string }>,
}

const emitted: unknown[] = []

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

describe('ComputerUsePolicy session + always', () => {
  it('always-allow grants without session entry', () => {
    const policy = new ComputerUsePolicy()
    policy.setEnabled(true)
    policy.setAlwaysAllowApps([{ app: 'TextEdit', bundleId: 'com.apple.TextEdit' }])
    expect(policy.isGranted('com.apple.TextEdit')).toBe(true)
    expect(policy.scopeFor('com.apple.TextEdit')).toBe('always')
    expect(policy.listGranted()[0]?.scope).toBe('always')
  })

  it('session grant is independent of always list', () => {
    const policy = new ComputerUsePolicy()
    policy.setEnabled(true)
    policy.grantSession({ app: 'Finder', bundleId: 'com.apple.finder', tier: 'full' })
    expect(policy.isGranted('com.apple.finder')).toBe(true)
    expect(policy.scopeFor('com.apple.finder')).toBe('session')
    policy.clearSessionGrants()
    expect(policy.isGranted('com.apple.finder')).toBe(false)
  })

  it('always takes precedence in listGranted when both present', () => {
    const policy = new ComputerUsePolicy()
    policy.setAlwaysAllowApps([{ app: 'TextEdit', bundleId: 'com.apple.TextEdit' }])
    policy.grantSession({ app: 'TextEdit', bundleId: 'com.apple.TextEdit', tier: 'full' })
    expect(policy.listGranted().filter((g) => g.bundleId === 'com.apple.TextEdit')).toHaveLength(1)
    expect(policy.scopeFor('com.apple.TextEdit')).toBe('always')
  })
})

describe('ensureComputerUseAppGrant HITL', () => {
  let adapter: PlatformAdapter
  let service: ComputerUseService

  beforeEach(() => {
    clearPendingComputerUseGrants()
    emitted.length = 0
    mockSettingsState.computerUseAlwaysAllowApps = []
    setComputerUseGrantDepsForTests({
      sessionHost: {
        getSession: () => ({
          emitHostEvent: (event: unknown) => {
            emitted.push(event)
          },
        }),
      },
      settings: {
        readAppSettings: () => mockSettingsState,
        saveAppSettings: (patch) => {
          Object.assign(mockSettingsState, patch)
          return mockSettingsState
        },
      },
    })
    const root = makeRoot()
    adapter = {
      listRoots: vi.fn(async () => [root]),
      look: vi.fn(async (r) => visualLook(r)),
      act: vi.fn(async () => ({ steps: [] })),
      listApps: vi.fn(async () => [
        { app: 'TextEdit', bundleId: 'com.apple.TextEdit', pid: 7, frontmost: true },
      ]),
    }
    const policy = new ComputerUsePolicy()
    policy.setEnabled(true)
    service = new ComputerUseService({ adapter, policy })
  })

  afterEach(() => {
    clearPendingComputerUseGrants()
    setComputerUseGrantDepsForTests(null)
  })

  it('skips prompt when already session-granted', async () => {
    service.policy.grantSession({
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      tier: 'full',
    })
    await ensureComputerUseAppGrant({
      sessionId: 's1',
      service,
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      toolName: 'computer_snapshot',
    })
    expect(emitted).toHaveLength(0)
  })

  it('skips prompt when always-allow in settings', async () => {
    mockSettingsState.computerUseAlwaysAllowApps = [
      { app: 'TextEdit', bundleId: 'com.apple.TextEdit' },
    ]
    await ensureComputerUseAppGrant({
      sessionId: 's1',
      service,
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      toolName: 'computer_snapshot',
    })
    expect(emitted).toHaveLength(0)
    expect(service.policy.isGranted('com.apple.TextEdit')).toBe(true)
  })

  // Real-timer polling, not pure microtask draining: ensureComputerUseAppGrant
  // now awaits the icon lookup (a real mdfind subprocess, bounded by
  // app-icon-resolver's own LOOKUP_TIMEOUT_MS) before emitting the prompt,
  // so this needs to survive an actual macrotask hop, not just N Promise ticks.
  async function waitForPrompt(): Promise<{
    type: string
    request: { requestId: string; requestKind: string; computerUseGrant: { bundleId: string } }
  }> {
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      if (emitted.length > 0) {
        return emitted[0] as {
          type: string
          request: { requestId: string; requestKind: string; computerUseGrant: { bundleId: string } }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`permission_request was not emitted (emitted=${emitted.length})`)
  }

  it('prompts and applies session grant on accept', async () => {
    const p = ensureComputerUseAppGrant({
      sessionId: 's1',
      service,
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      toolName: 'computer_snapshot',
    })
    const event = await waitForPrompt()
    expect(event.type).toBe('permission_request')
    expect(event.request.requestKind).toBe('computer_use_grant')
    expect(event.request.computerUseGrant.bundleId).toBe('com.apple.TextEdit')

    expect(resolveComputerUseGrant(event.request.requestId, true, false)).toBe(true)
    await p
    expect(service.policy.isGranted('com.apple.TextEdit')).toBe(true)
    expect(service.policy.scopeFor('com.apple.TextEdit')).toBe('session')
    expect(mockSettingsState.computerUseAlwaysAllowApps).toEqual([])
  })

  it('prompts and persists always-allow', async () => {
    const p = ensureComputerUseAppGrant({
      sessionId: 's1',
      service,
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      toolName: 'computer_act',
    })
    const event = await waitForPrompt()
    expect(resolveComputerUseGrant(event.request.requestId, true, true)).toBe(true)
    await p
    expect(service.policy.scopeFor('com.apple.TextEdit')).toBe('always')
    expect(mockSettingsState.computerUseAlwaysAllowApps).toEqual([
      { app: 'TextEdit', bundleId: 'com.apple.TextEdit' },
    ])
  })

  it('throws NOT_GRANTED on deny', async () => {
    const p = ensureComputerUseAppGrant({
      sessionId: 's1',
      service,
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      toolName: 'computer_snapshot',
    })
    const event = await waitForPrompt()
    expect(resolveComputerUseGrant(event.request.requestId, false)).toBe(true)
    await expect(p).rejects.toMatchObject({ code: 'NOT_GRANTED' })
    expect(service.policy.isGranted('com.apple.TextEdit')).toBe(false)
  })

  it('cancel maps to NOT_GRANTED', async () => {
    const p = ensureComputerUseAppGrant({
      sessionId: 's1',
      service,
      app: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      toolName: 'computer_snapshot',
    })
    const event = await waitForPrompt()
    expect(rejectComputerUseGrant(event.request.requestId, 'User cancelled')).toBe(true)
    await expect(p).rejects.toMatchObject({ code: 'NOT_GRANTED' })
  })
})
