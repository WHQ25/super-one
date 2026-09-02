import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationIntent, type NotificationSettings } from '@superone/shared/notifications'
import type { NotificationChannel } from './notification-channel'
import { NotificationService } from './notification-service'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

function fakeChannel(id = 'fake') {
  const delivered: NotificationIntent[] = []
  const withdrawn: string[] = []
  const channel: NotificationChannel & { delivered: NotificationIntent[]; withdrawn: string[]; available: boolean } = {
    id,
    available: true,
    delivered,
    withdrawn,
    isAvailable: () => channel.available,
    deliver: (intent) => { delivered.push(intent) },
    withdraw: (wid) => { withdrawn.push(wid) },
  }
  return channel
}

function permissionEvent(requestId = 'req-1'): AgentEvent {
  return {
    type: 'permission_request',
    sessionId: 'sid',
    request: { requestId, toolName: 'Bash', input: {}, allowAlwaysAllow: true },
  }
}

describe('NotificationService', () => {
  let settings: NotificationSettings
  let focused: boolean

  beforeEach(() => {
    settings = structuredClone(DEFAULT_NOTIFICATION_SETTINGS)
    focused = false
  })

  function makeService() {
    return new NotificationService({
      readSettings: () => settings,
      isAppFocused: () => focused,
      describeSession: () => ({ title: 'Session', projectPath: '/repo' }),
      t: (key) => key,
      now: () => 1,
    })
  }

  it('delivers a permission request to every available channel', () => {
    const service = makeService()
    const a = fakeChannel('a')
    const b = fakeChannel('b')
    service.registerChannel(a)
    service.registerChannel(b)

    service.handleEvent(permissionEvent())

    expect(a.delivered).toHaveLength(1)
    expect(b.delivered).toHaveLength(1)
    expect(a.delivered[0].kind).toBe('permission')
  })

  it('skips channels that report themselves unavailable', () => {
    const service = makeService()
    const up = fakeChannel('up')
    const down = fakeChannel('down')
    down.available = false
    service.registerChannel(up)
    service.registerChannel(down)

    service.handleEvent(permissionEvent())

    expect(up.delivered).toHaveLength(1)
    expect(down.delivered).toHaveLength(0)
  })

  it('suppresses delivery while a SuperOne window has focus', () => {
    focused = true
    const service = makeService()
    const channel = fakeChannel()
    service.registerChannel(channel)

    service.handleEvent(permissionEvent())

    expect(channel.delivered).toHaveLength(0)
  })

  it('honours the master switch', () => {
    settings.enabled = false
    const service = makeService()
    const channel = fakeChannel()
    service.registerChannel(channel)

    service.handleEvent(permissionEvent())

    expect(channel.delivered).toHaveLength(0)
  })

  it('honours a per-kind opt-out without affecting other kinds', () => {
    settings.kinds.permission = false
    const service = makeService()
    const channel = fakeChannel()
    service.registerChannel(channel)

    service.handleEvent(permissionEvent())
    service.handleEvent({
      type: 'plan_approval',
      sessionId: 'sid',
      request: { requestId: 'p-1', planContent: '', planFilePath: '', allowedPrompts: [] },
    })

    expect(channel.delivered.map((i) => i.kind)).toEqual(['plan'])
  })

  it('notifies once for a request replayed on reconnect', () => {
    const service = makeService()
    const channel = fakeChannel()
    service.registerChannel(channel)

    service.handleEvent(permissionEvent('req-1'))
    service.handleEvent(permissionEvent('req-1'))

    expect(channel.delivered).toHaveLength(1)
  })

  it('does not re-notify a replayed request that was first seen while focused', () => {
    focused = true
    const service = makeService()
    const channel = fakeChannel()
    service.registerChannel(channel)

    service.handleEvent(permissionEvent('req-1'))
    focused = false
    service.handleEvent(permissionEvent('req-1'))

    expect(channel.delivered).toHaveLength(0)
  })

  it('withdraws the matching notification when the interaction resolves anywhere', () => {
    const service = makeService()
    const channel = fakeChannel()
    service.registerChannel(channel)

    service.handleEvent(permissionEvent('req-1'))
    service.handleEvent({ type: 'interaction_resolved', interactionType: 'permission', requestId: 'req-1', sessionId: 'sid' })

    expect(channel.withdrawn).toEqual(['req-1'])
  })

  it('ignores a resolution for an interaction that was never notified', () => {
    const service = makeService()
    const channel = fakeChannel()
    service.registerChannel(channel)

    service.handleEvent({ type: 'interaction_resolved', interactionType: 'permission', requestId: 'ghost', sessionId: 'sid' })

    expect(channel.withdrawn).toHaveLength(0)
  })

  it('re-notifies after a resolution, since the dedupe slot is freed', () => {
    const service = makeService()
    const channel = fakeChannel()
    service.registerChannel(channel)

    service.handleEvent(permissionEvent('req-1'))
    service.handleEvent({ type: 'interaction_resolved', interactionType: 'permission', requestId: 'req-1', sessionId: 'sid' })
    service.handleEvent(permissionEvent('req-1'))

    expect(channel.delivered).toHaveLength(2)
  })

  it('keeps delivering to healthy channels when one throws', () => {
    const service = makeService()
    const broken: NotificationChannel = {
      id: 'broken',
      isAvailable: () => true,
      deliver: () => { throw new Error('boom') },
      withdraw: () => {},
    }
    const healthy = fakeChannel('healthy')
    service.registerChannel(broken)
    service.registerChannel(healthy)

    service.handleEvent(permissionEvent())

    expect(healthy.delivered).toHaveLength(1)
  })
})
