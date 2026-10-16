import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControlLease, ExecutionEnvironmentDescriptor } from '@superone/shared/environment'

vi.mock('../../logger', () => ({ default: { info() {}, warn() {}, debug() {}, error() {} } }))

import { createPhoneMethods, type PhoneMethodHost } from '../../remote/phone-methods'
import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'
import type { FakeSessionManager } from '../node-host-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

describe('phone suggested-task launch', () => {
  it.each(['lan', 'relay'] as const)('fences and deduplicates a launch over %s', async transport => {
    let sessions: FakeSessionManager
    const launchSuggestedTask = vi.fn(async () => ({ sessionId: 'child' }))
    const options = { profiles: [], initial: { agentId: 'claude-base', settings: { model: 'opus' } } }
    const suggestedTaskLaunchOptions = vi.fn(async () => options)
    const host = { agent: {}, sessions: { getSession: (id: string) => sessions.getSession(id), launchSuggestedTask, suggestedTaskLaunchOptions } } as unknown as PhoneMethodHost
    const result = phoneDomain(cleanup, { phoneMethods: createPhoneMethods(host) })
    sessions = result.sessions
    const phone = await connectPhone(result.domain, { transport }); cleanup.push(phone.close)
    const descriptor = await phone.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(descriptor.capabilities.methods).toContain('session.launchSuggestedTask')
    expect(await phone.rpc('session.suggestedTaskLaunchOptions', { sessionId: 'own', taskId: 'task' })).toEqual(options)
    expect(suggestedTaskLaunchOptions).toHaveBeenCalledExactlyOnceWith('own', 'task')
    await expect(phone.rpc('session.launchSuggestedTask', { sessionId: 'own', taskId: 'task' })).rejects.toThrow()
    const lease = await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })
    const input = { sessionId: 'own', taskId: 'task', leaseId: lease.leaseId, generation: lease.generation }
    await expect(phone.rpc('session.launchSuggestedTask', { ...input, taskId: '' })).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(await phone.rpc('session.launchSuggestedTask', input, 'launch-task')).toEqual({ sessionId: 'child' })
    await phone.rpc('session.launchSuggestedTask', input, 'launch-task')
    expect(launchSuggestedTask).toHaveBeenCalledExactlyOnceWith('own', 'task', undefined, expect.any(Function))
    const choice = { agentId: 'codex-base', settings: { model: 'gpt-custom', permissionMode: 'bypassPermissions', fastMode: false } }
    await phone.rpc('session.launchSuggestedTask', { ...input, choice: { ...choice, settings: { ...choice.settings, cwd: '/forged' } } }, 'chosen-task')
    expect(launchSuggestedTask).toHaveBeenLastCalledWith('own', 'task', choice, expect.any(Function))
    await expect(phone.rpc('session.launchSuggestedTask', { ...input, choice: { agentId: 'codex-base', settings: { fastMode: 'true' } } })).rejects.toMatchObject({ code: 'invalid_argument' })
    result.domain.leases.revoke({ environmentId: result.domain.identity.environmentId, sessionId: 'own' })
    await expect(phone.rpc('session.launchSuggestedTask', input)).rejects.toMatchObject({ code: 'lease_stale' })
    expect(launchSuggestedTask).toHaveBeenCalledTimes(2)
  })
})
