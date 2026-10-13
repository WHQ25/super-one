import { describe, expect, it } from 'vitest'
import { ChatRuntime } from './runtime'
import { runtimeTestClient } from './runtime-test-client'

describe('native session catalog refresh', () => {
  it('projects pending input and uses controlled inbox actions but read-only observation retry on its owning host', async () => {
    const client = runtimeTestClient(), runtime = new ChatRuntime(client as never, () => {})
    try {
      await runtime.open('/project', 'native-session')
      runtime.ingest([{ type: 'session_inbox_changed', environmentId: 'desktop', sessionId: 'native-session', items: [
        { id: 'pending', text: 'next', delivery: 'queue', createdAt: 1, attachmentCount: 0 },
      ] }, { type: 'harness_connection_changed', environmentId: 'desktop', sessionId: 'native-session', connection: { state: 'recovering', attempt: 2 } }])
      expect(runtime.session.sessionInbox?.[0].id).toBe('pending')
      expect(runtime.session.harnessConnection).toEqual({ state: 'recovering', attempt: 2 })
      await runtime.sessionInboxAction('pending', 'steer')
      await runtime.sessionInboxAction('pending', 'cancel')
      expect(client.controlledRpc).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'native-session' }), 'session.inbox.update', { inboxId: 'pending', delivery: 'steer' })
      expect(client.controlledRpc).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'native-session' }), 'session.inbox.cancel', { inboxId: 'pending' })
      client.rpc.mockResolvedValueOnce({ ok: true })
      await runtime.reconnectAgent()
      expect(client.rpc).toHaveBeenLastCalledWith('session.connection.reconnect', { sessionId: 'native-session' }, { environmentId: 'desktop' })
    } finally { runtime.dispose() }
  })
  it('uses the owning host descriptor and a leased session operation, then accepts its native catalog', async () => {
    const client = runtimeTestClient()
    const original = client.dispatch.getMockImplementation()!
    client.dispatch.mockImplementation(async (call) => call.method === 'environment.descriptor'
      ? { capabilities: { methods: ['session.refreshResources'] } } : original(call))
    const runtime = new ChatRuntime(client as never, () => {})
    try {
      await runtime.open('/project', 'native-session')
      await runtime.refreshResources()
      expect(client.controlledRpc).toHaveBeenCalledWith(expect.objectContaining({ environmentId: 'desktop', sessionId: 'native-session' }), 'session.refreshResources', {})
      const agents = [{ id: 'new-agent', name: 'New Agent' }]
      const commands = [{ name: 'new-skill', skillId: 'skill-id', description: '', argumentHint: '', isSkill: true }]
      runtime.ingest([{ type: 'session_agents', environmentId: 'desktop', sessionId: 'native-session', agents, commands,
        runtimeCapabilities: { harnessId: 'opencode', supportsQueuedSteer: true } }])
      expect(runtime.session.sessionAgents).toEqual(agents)
      expect(runtime.session.sessionSlashCommands).toEqual(commands)
    } finally { runtime.dispose() }
  })
  it('retains the discovery fallback when an older host does not serve session refresh', async () => {
    const client = runtimeTestClient()
    const runtime = new ChatRuntime(client as never, () => {})
    try {
      await runtime.open('/project', 'native-session')
      client.controlledRpc.mockClear()
      await runtime.refreshResources()
      expect(client.controlledRpc).not.toHaveBeenCalled()
    } finally { runtime.dispose() }
  })
  it('keeps the original owning session when navigation occurs during host capability discovery', async () => {
    const client = runtimeTestClient()
    const runtime = new ChatRuntime(client as never, () => {})
    try {
      await runtime.open('/project', 'original-session')
      let resolveDescriptor!: (value: unknown) => void
      client.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveDescriptor = resolve }))
      const refresh = runtime.refreshResources()
      await runtime.open('/next', 'next-session')
      resolveDescriptor({ capabilities: { methods: ['session.refreshResources'] } })
      await refresh
      expect(client.controlledRpc).toHaveBeenCalledWith(expect.objectContaining({ environmentId: 'desktop', sessionId: 'original-session' }), 'session.refreshResources', {})
    } finally { runtime.dispose() }
  })
})
