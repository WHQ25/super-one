import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: () => ({ executable: '/fake/node', env: {} }),
}))

import {
  antigravityPermissionLaunchProfile,
  applyAntigravityPermissionLaunchArgs,
} from './antigravity-runtime-bridge'
import type { AcpRuntimeOptions } from './acp-runtime'
import { AcpBackend, setAcpRuntimeFactory } from '../session/backends/acp-backend'
import { acpStartOpts as startOpts, mockAcpRuntime as mockRuntime } from '../../test/fixtures/acp-backend-fixtures'

describe('antigravity permission launch profile and runtime restart', () => {
  beforeEach(() => {
    setAcpRuntimeFactory(async () => mockRuntime())
  })

  afterEach(() => {
    setAcpRuntimeFactory(null)
  })

  it('maps permission modes to launch profiles and CLI flags without duplicating args', () => {
    expect(antigravityPermissionLaunchProfile(undefined)).toBe('standard')
    expect(antigravityPermissionLaunchProfile('default')).toBe('standard')
    expect(antigravityPermissionLaunchProfile('acceptEdits')).toBe('standard')
    expect(antigravityPermissionLaunchProfile('plan')).toBe('standard')
    expect(antigravityPermissionLaunchProfile('auto')).toBe('auto')
    expect(antigravityPermissionLaunchProfile('bypassPermissions')).toBe('bypass')

    expect(applyAntigravityPermissionLaunchArgs(['acp'], 'default')).toEqual(['acp'])
    expect(applyAntigravityPermissionLaunchArgs(['acp'], 'acceptEdits')).toEqual(['acp'])
    expect(applyAntigravityPermissionLaunchArgs(['acp'], 'plan')).toEqual(['acp'])
    expect(applyAntigravityPermissionLaunchArgs(['acp'], 'auto')).toEqual([
      'acp',
      '--sandbox',
      '--dangerously-skip-permissions',
    ])
    expect(applyAntigravityPermissionLaunchArgs(['acp'], 'bypassPermissions')).toEqual([
      'acp',
      '--dangerously-skip-permissions',
    ])
    expect(
      applyAntigravityPermissionLaunchArgs(
        ['acp', '--sandbox', '--dangerously-skip-permissions'],
        'auto',
      ),
    ).toEqual(['acp', '--sandbox', '--dangerously-skip-permissions'])
    expect(applyAntigravityPermissionLaunchArgs(['acp', '--', 'extra'], 'auto')).toEqual([
      'acp',
      '--sandbox',
      '--dangerously-skip-permissions',
      '--',
      'extra',
    ])
  })

  it('restarts antigravity runtime with resumeSessionId across auto/bypass transitions while keeping standard modes in-process', async () => {
    const spawns: Array<{
      permissionMode: AcpRuntimeOptions['permissionMode']
      resumeSessionId: string | undefined
      closeSpy: ReturnType<typeof vi.fn>
      setPermissionModeSpy: ReturnType<typeof vi.fn>
    }> = []

    setAcpRuntimeFactory(async (opts) => {
      const closeSpy = vi.fn(async () => {})
      const setPermissionModeSpy = vi.fn(async () => {})
      spawns.push({
        permissionMode: opts.permissionMode,
        resumeSessionId: opts.resumeSessionId,
        closeSpy,
        setPermissionModeSpy,
      })
      return mockRuntime({
        sessionId: opts.resumeSessionId ?? 'agy-live-session-1',
        close: closeSpy,
        setPermissionMode: setPermissionModeSpy,
      })
    })

    const backend = new AcpBackend('acp-antigravity')
    await backend.start({ ...startOpts({ agentId: 'antigravity' }), permissionMode: 'default' })
    await vi.waitFor(() => expect(backend.hasActiveRuntime()).toBe(true))
    expect(spawns).toHaveLength(1)
    expect(spawns[0]?.permissionMode).toBe('default')

    await backend.setPermissionMode('plan')
    await backend.setPermissionMode('acceptEdits')
    expect(spawns).toHaveLength(1)
    expect(spawns[0]?.setPermissionModeSpy).toHaveBeenNthCalledWith(1, 'plan')
    expect(spawns[0]?.setPermissionModeSpy).toHaveBeenNthCalledWith(2, 'acceptEdits')

    await backend.setPermissionMode('auto')
    expect(spawns[0]?.closeSpy).toHaveBeenCalledTimes(1)
    expect(spawns).toHaveLength(2)
    expect(spawns[1]?.permissionMode).toBe('auto')
    expect(spawns[1]?.resumeSessionId).toBe('agy-live-session-1')

    await backend.setPermissionMode('bypassPermissions')
    expect(spawns[1]?.closeSpy).toHaveBeenCalledTimes(1)
    expect(spawns).toHaveLength(3)
    expect(spawns[2]?.permissionMode).toBe('bypassPermissions')
    expect(spawns[2]?.resumeSessionId).toBe('agy-live-session-1')

    await backend.setPermissionMode('default')
    expect(spawns[2]?.closeSpy).toHaveBeenCalledTimes(1)
    expect(spawns).toHaveLength(4)
    expect(spawns[3]?.permissionMode).toBe('default')
    expect(spawns[3]?.resumeSessionId).toBe('agy-live-session-1')

    await backend.close()
  })

  it('defers antigravity process restart when setPermissionMode is called mid-turn and restarts on the next prompt', async () => {
    let releasePrompt!: () => void
    const spawns: Array<{
      permissionMode: AcpRuntimeOptions['permissionMode']
      resumeSessionId: string | undefined
      setPermissionModeSpy: ReturnType<typeof vi.fn>
    }> = []

    setAcpRuntimeFactory(async (opts) => {
      const setPermissionModeSpy = vi.fn(async () => {})
      spawns.push({
        permissionMode: opts.permissionMode,
        resumeSessionId: opts.resumeSessionId,
        setPermissionModeSpy,
      })
      return mockRuntime({
        sessionId: opts.resumeSessionId ?? 'agy-busy-session',
        setPermissionMode: setPermissionModeSpy,
        prompt: async (_text, messageId, onEvent) => {
          if (spawns.length === 1) {
            await new Promise<void>((resolve) => {
              releasePrompt = resolve
            })
          }
          onEvent({ type: 'message_complete', messageId })
          onEvent({ type: 'status_change', status: 'idle' })
        },
      })
    })

    const backend = new AcpBackend('acp-antigravity')
    await backend.start({ ...startOpts({ agentId: 'antigravity' }), permissionMode: 'default' })
    await vi.waitFor(() => expect(backend.hasActiveRuntime()).toBe(true))

    const turn1 = backend.send({ content: 'First turn' })
    await vi.waitFor(() => expect(releasePrompt).toBeTypeOf('function'))

    await backend.setPermissionMode('auto')
    expect(spawns).toHaveLength(1)
    expect(spawns[0]?.setPermissionModeSpy).toHaveBeenCalledWith('auto')

    releasePrompt()
    await turn1

    await backend.send({ content: 'Second turn' })
    expect(spawns).toHaveLength(2)
    expect(spawns[1]?.permissionMode).toBe('auto')
    expect(spawns[1]?.resumeSessionId).toBe('agy-busy-session')

    await backend.close()
  })
})
