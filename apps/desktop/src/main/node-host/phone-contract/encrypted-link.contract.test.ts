import { afterEach, describe, expect, it, vi } from 'vitest'
import { restoreSession } from '@superone/relay-client'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))
import { encryptedPhone } from '../encrypted-phone-test-fixtures'
import { phoneDomain } from '../phone-endpoint-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })


describe('paired encrypted phone and desktop endpoint', () => {
  it.each(['lan', 'relay'] as const)('releases sidebar control after an unopened-session action and retains visible control over %s', async route => {
    const { domain, projectDir, store } = phoneDomain(cleanup)
    const client = await encryptedPhone(cleanup, domain, route, 'sidebar')
    const resource = { environmentId: domain.identity.environmentId, sessionId: 'own' }
    await client.operateSession(resource, 'session.setUiFlags', { isPinned: true })
    expect(store.rows.get('own')).toMatchObject({ isPinned: true })
    expect(domain.leases.get(resource)).toBeNull()
    await restoreSession(client, projectDir, 'own')
    const visibleGrant = domain.leases.get(resource)!
    await client.operateSession(resource, 'session.setUiFlags', { isPinned: false })
    expect(domain.leases.get(resource)).toMatchObject({ leaseId: visibleGrant.leaseId, generation: visibleGrant.generation })
    await client.stopSession()
    expect(domain.leases.get(resource)).toBeNull()
  })
  it.each(['lan', 'relay'] as const)('keeps source control when a same-session preparation is cancelled over %s', async route => {
    const { domain, projectDir } = phoneDomain(cleanup)
    const client = await encryptedPhone(cleanup, domain, route, 'same-view')
    const resource = { environmentId: domain.identity.environmentId, sessionId: 'own' }
    await restoreSession(client, projectDir, 'own')
    const original = domain.leases.get(resource)!
    const candidate = client.createSessionView()
    await restoreSession(candidate.client, projectDir, 'own')
    await candidate.client.stopSession()
    expect(domain.leases.get(resource)).toMatchObject({ leaseId: original.leaseId, generation: original.generation })
    await client.controlledRpc(resource, 'session.send', { text: 'source still controls', clientMessageId: 'source' })
    await client.stopSession()
    expect(domain.leases.get(resource)).toBeNull()
    await expect(client.controlledRpc(resource, 'session.send', { text: 'retired' })).rejects.toMatchObject({ code: 'lease_required' })
  })
  it.each(['lan', 'relay'] as const)('prepares a second stream and retires source control only at commit over %s', async route => {
    const { domain, projectDir, sessions, store } = phoneDomain(cleanup)
    store.createRow({ sessionId: 'target', projectPath: projectDir, title: 'Target', cwd: projectDir })
    sessions.createSession({ id: 'target', projectPath: projectDir })
    const events: unknown[][] = []
    const client = await encryptedPhone(cleanup, domain, route, 'switch-view', events)
    const source = { environmentId: domain.identity.environmentId, sessionId: 'own' }
    const target = { ...source, sessionId: 'target' }
    await restoreSession(client, projectDir, 'own')
    const candidate = client.createSessionView()
    await restoreSession(candidate.client, projectDir, 'target')
    await client.controlledRpc(source, 'session.send', { text: 'source before commit', clientMessageId: 'source-before' })
    await candidate.client.controlledRpc(target, 'session.send', { text: 'target before commit', clientMessageId: 'target-before' })
    expect(events.flat()).toContainEqual(expect.objectContaining({ type: 'user_message_appended', sessionId: 'own' }))
    expect(events.flat()).not.toContainEqual(expect.objectContaining({ sessionId: 'target' }))
    expect(candidate.commit().flat()).toContainEqual(expect.objectContaining({ type: 'user_message_appended', sessionId: 'target' }))
    await vi.waitFor(() => expect(domain.leases.get(source)).toBeNull())
    await expect(client.controlledRpc(source, 'session.send', { text: 'retired source' })).rejects.toMatchObject({ code: 'lease_required' })
    await candidate.client.controlledRpc(target, 'session.send', { text: 'target after commit', clientMessageId: 'target-after' })
    expect(events.flat()).toContainEqual(expect.objectContaining({ type: 'user_message_appended', sessionId: 'target' }))
    await client.stopSession()
    expect(domain.leases.get(target)).toBeNull()
  })
  it.each(['lan', 'relay'] as const)('restores at the atomic cursor and feeds native phone events over %s', async route => {
    const { domain, own, projectDir } = phoneDomain(cleanup)
    const events: unknown[][] = []
    const client = await encryptedPhone(cleanup, domain, route, 'restore', events)
    const restored = await restoreSession(client, projectDir, 'own')
    expect(restored.snapshot.sourceEnvironmentId).toBe(domain.identity.environmentId)
    expect(restored.state).toMatchObject({ status: 'idle', sessionProvider: 'claude' })
    const resource = { environmentId: domain.identity.environmentId, sessionId: 'own' }
    await client.controlledRpc(resource, 'session.send', { text: 'after restore', clientMessageId: 'restored-turn' })
    expect(own.sent).toHaveLength(1)
    expect(events.flat()).toContainEqual(expect.objectContaining({ type: 'user_message_appended', environmentId: resource.environmentId, sessionId: 'own', projectPath: projectDir }))
    await client.stopSession()
  })
  it.each(['lan', 'relay'] as const)('loads, follows, and mutates the native session with fenced control over %s', async (route) => {
    const { domain, own } = phoneDomain(cleanup)
    const a = await encryptedPhone(cleanup, domain, route, 'a')
    const b = await encryptedPhone(cleanup, domain, route, 'b')
    const resource = { environmentId: domain.identity.environmentId, sessionId: 'own' }
    const grant = await a.acquireControl(resource)
    await expect(b.acquireControl(resource)).rejects.toMatchObject({ code: 'failed_precondition' })
    const snapshot = await a.rpc<{ cursor: { sequence: string; epoch: string; version: number }; restore: { sourceEnvironmentId: string } }>('session.load', { sessionId: 'own' })
    expect(snapshot.restore.sourceEnvironmentId).toBe(resource.environmentId)
    const frames: Array<{ events: unknown[] }> = []
    const stream = await a.subscribeTopics({ afterSequence: snapshot.cursor.sequence, epoch: snapshot.cursor.epoch, versions: { own: snapshot.cursor.version }, topics: [{ kind: 'session', ...resource }] }, { onFrame: (frame) => frames.push(frame), onEnd: () => {} })
    await a.controlledRpc(resource, 'session.send', { text: 'native phone turn', clientMessageId: 'turn', model: 'm', priority: 'later' }, { idempotencyKey: 'send' })
    expect(own.sent).toContainEqual(expect.objectContaining({ content: 'native phone turn', model: 'm', priority: 'later' }))
    expect(frames.some((frame) => frame.events.length > 0)).toBe(true)
    await expect(b.rpc('session.send', { sessionId: 'own', leaseId: grant.leaseId, generation: grant.generation, text: 'stolen' })).rejects.toMatchObject({ code: 'lease_stale' })
    domain.leases.revoke(resource)
    await expect(a.controlledRpc(resource, 'session.send', { text: 'late stale' })).rejects.toMatchObject({ code: 'lease_required' })
    await expect(b.acquireControl(resource)).resolves.toMatchObject({ delegate: 'phone:b' })
    expect(own.sent).toHaveLength(1)
    await stream.close()
  })
  it.each(['lan', 'relay'] as const)('notifies a replacement connection when its reused proof is revoked over %s', async route => {
    const { domain } = phoneDomain(cleanup)
    const resource = { environmentId: domain.identity.environmentId, sessionId: 'own' }
    const first = await encryptedPhone(cleanup, domain, route, 'same-phone')
    const original = await first.acquireControl(resource)
    first.disconnect()
    const lost = vi.fn()
    const replacement = await encryptedPhone(cleanup, domain, route, 'same-phone', [], { onControlLost: lost })
    expect(await replacement.acquireControl(resource)).toMatchObject({ leaseId: original.leaseId, generation: original.generation })
    domain.leases.revoke(resource)
    expect(lost).toHaveBeenCalledTimes(1)
    await expect(replacement.controlledRpc(resource, 'session.send', { text: 'revoked' })).rejects.toMatchObject({ code: 'lease_required' })
  })

})
