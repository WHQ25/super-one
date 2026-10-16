import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationIntent } from '@superone/shared/notifications'
import { NotificationService, type NotificationServiceDeps } from './notification-service'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

const projectPath = 'remote:vps:/srv/project'
const status = (value: 'streaming' | 'idle', path = projectPath): AgentEvent => ({
  type: 'status_change', status: value, sessionId: 'same-session', projectPath: path,
})
const permission = (path = projectPath): AgentEvent => ({
  type: 'permission_request', sessionId: 'same-session', projectPath: path,
  request: { requestId: 'same-request', toolName: 'Bash', input: {}, allowAlwaysAllow: true },
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function setup(describeSession: NotificationServiceDeps['describeSession']) {
  const delivered: NotificationIntent[] = []
  const withdrawn: string[] = []
  const settings = structuredClone(DEFAULT_NOTIFICATION_SETTINGS)
  const presence = { focused: false, mobileOnline: false }
  const service = new NotificationService({
    readSettings: () => settings, isAppFocused: () => presence.focused, hasMobileOnline: () => presence.mobileOnline,
    // Remote metadata comes from the owning node, without loading a transcript.
    describeSession,
    t: key => key, now: () => 1,
  })
  service.registerChannel({ id: 'desktop', isAvailable: () => true,
    deliver: intent => { delivered.push(intent) }, withdraw: id => { withdrawn.push(id) } })
  return { service, delivered, withdrawn, settings, presence }
}

describe('remote session notifications', () => {
  it('uses the owning node title and project route for completion and click activation', async () => {
    const describeSession = vi.fn().mockResolvedValue({ title: 'Fix login', environmentLabel: 'VPS' })
    const { service, delivered } = setup(describeSession)
    service.handleEvent(status('streaming'))
    service.handleEvent(status('idle'))

    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    expect(describeSession).toHaveBeenCalledExactlyOnceWith('same-session', projectPath)
    expect(delivered[0]).toMatchObject({
      sessionId: 'same-session', projectPath, title: 'VPS · Fix login', body: 'notifications.completed',
    })
  })

  it('keeps the remote project route when the node cannot describe the session', async () => {
    const { service, delivered } = setup(vi.fn().mockRejectedValue(new Error('offline')))
    service.handleEvent(permission())
    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    expect(delivered[0]).toMatchObject({ projectPath, title: 'project' })
  })

  it('does not mix runs with the same session id on different nodes', async () => {
    const { service, delivered } = setup(() => ({ title: 'Named' }))
    service.handleEvent(status('streaming'))
    service.handleEvent(status('idle', 'remote:other:/srv/project'))
    expect(delivered).toHaveLength(0)
    service.handleEvent(status('idle'))
    expect(delivered).toHaveLength(1)
  })

  it('keeps equal request ids on different nodes independent when resolving one', async () => {
    const { service, delivered, withdrawn } = setup(() => ({ title: 'Named' }))
    service.handleEvent(permission())
    service.handleEvent(permission('remote:other:/srv/project'))
    expect(delivered).toHaveLength(2)
    expect(new Set(delivered.map(intent => intent.id)).size).toBe(2)
    service.handleEvent({ type: 'interaction_resolved', sessionId: 'same-session', projectPath,
      interactionType: 'permission', requestId: 'same-request' })
    expect(withdrawn).toEqual([delivered[0].id])
  })

  it('does not post an answered request when its metadata arrives late', async () => {
    const metadata = deferred<{ title: string }>()
    const { service, delivered } = setup(() => metadata.promise)
    service.handleEvent(permission())
    service.handleEvent({ type: 'interaction_resolved', sessionId: 'same-session', projectPath,
      interactionType: 'permission', requestId: 'same-request' })
    metadata.resolve({ title: 'Too late' })
    await metadata.promise
    await Promise.resolve()
    expect(delivered).toHaveLength(0)
  })

  it('does not let an earlier completion replace a later run while metadata is loading', async () => {
    const first = deferred<{ title: string }>()
    const second = deferred<{ title: string }>()
    const { service, delivered } = setup(vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise))
    service.handleEvent(status('streaming'))
    service.handleEvent(status('idle'))
    service.handleEvent(status('streaming'))
    service.handleEvent(status('idle'))
    second.resolve({ title: 'Latest run' })
    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    first.resolve({ title: 'Old run' })
    await first.promise
    await Promise.resolve()
    expect(delivered.map(intent => intent.title)).toEqual(['Latest run'])
  })

  it('does not query node metadata for disabled notifications or ordinary stream events', () => {
    const describeSession = vi.fn()
    const { service, settings } = setup(describeSession)
    service.handleEvent({ type: 'message_complete', sessionId: 'same-session', projectPath, messageId: 'message' })
    settings.kinds.permission = false
    service.handleEvent(permission())
    expect(describeSession).not.toHaveBeenCalled()
  })

  it.each(['focused', 'mobileOnline', 'disabled', 'disposed'] as const)(
    'rechecks %s before posting metadata that arrived late', async state => {
      const metadata = deferred<{ title: string }>()
      const { service, delivered, settings, presence } = setup(() => metadata.promise)
      service.handleEvent(permission())
      if (state === 'disabled') settings.enabled = false
      else if (state === 'disposed') service.dispose()
      else presence[state] = true
      metadata.resolve({ title: 'Too late' })
      await metadata.promise
      await Promise.resolve()
      expect(delivered).toHaveLength(0)
    },
  )
})
