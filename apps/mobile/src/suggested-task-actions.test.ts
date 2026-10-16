import { describe, expect, it, vi } from 'vitest'
import type { RelayClient } from '@superone/relay-client'
import { createSuggestedTaskActions, type SuggestedTaskLaunchRequest } from './suggested-task-actions'

describe('mobile suggested-task actions', () => {
  it('waits for native configuration and launches the chosen settings on the captured source host', async () => {
    const owner = { sessionId: 'source', sourceEnvironmentId: 'remote-host' }
    const controlledRpc = vi.fn(async () => { throw new Error('Task already launched') })
    const rpc = vi.fn(async () => ({ profiles: [], initial: { agentId: 'claude-base', settings: {} } }))
    const client = { environmentId: 'paired-host', controlledRpc, rpc } as unknown as RelayClient
    let request!: SuggestedTaskLaunchRequest
    const actions = createSuggestedTaskActions(() => ({ client, owner }), value => { request = value })
    await actions.launchSuggestedTask!('task-1')
    expect(controlledRpc).not.toHaveBeenCalled()
    owner.sessionId = 'switched-session'
    await request.loadOptions()
    expect(rpc).toHaveBeenCalledExactlyOnceWith('session.suggestedTaskLaunchOptions', { sessionId: 'source', taskId: 'task-1' }, { environmentId: 'remote-host' })
    const choice = { agentId: 'codex-base', settings: { model: 'gpt-custom', permissionMode: 'plan' as const } }
    await expect(request.launch(choice)).rejects.toThrow('Task already launched')
    expect(controlledRpc).toHaveBeenCalledExactlyOnceWith({ environmentId: 'remote-host', sessionId: 'source' }, 'session.launchSuggestedTask', { taskId: 'task-1', choice }, { timeoutMs: 120_000 })
  })

  it('refuses a request without an authenticated native session', async () => {
    const actions = createSuggestedTaskActions(() => ({ client: null, owner: null }), () => {})
    await expect(actions.launchSuggestedTask!('task')).rejects.toThrow('No active session')
  })
})
