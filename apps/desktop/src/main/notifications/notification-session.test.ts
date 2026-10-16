import { describe, expect, it, vi } from 'vitest'
import type { EnvironmentListItem } from '@superone/shared/environment'
import type { EnvironmentRpcClient } from '../environment/environment-rpc-client'
import { RemoteEnvironmentGateway } from '../environment/remote-environment-gateway'
import { createNotificationSessionResolver } from './notification-session'
import { NotificationService } from './notification-service'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationIntent } from '@superone/shared/notifications'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

function setup() {
  const rpc = vi.fn().mockResolvedValue({ sessionId: 'same', title: 'Remote title' })
  const gateway = new RemoteEnvironmentGateway({ rpc } as unknown as EnvironmentRpcClient)
  const items: EnvironmentListItem[] = [{
    kind: 'remote', connectionId: 'route', environmentId: 'node', label: 'VPS',
    state: 'connected', endpointProfiles: [],
  }]
  const host = { listEnvironments: vi.fn(async () => items), getGateway: vi.fn(() => gateway) }
  const describeLocal = vi.fn(() => ({ title: 'Local title', projectPath: '/local' }))
  const getHost = vi.fn(() => host)
  return { rpc, host, items, getHost, describeLocal,
    describeSession: createNotificationSessionResolver({ getHost, describeLocal }) }
}

describe('notification metadata through the environment gateway', () => {
  it('delivers the remote title, node label and click route without reading the transcript or a local namesake', async () => {
    const { describeSession, rpc, describeLocal, host } = setup()
    const delivered: NotificationIntent[] = []
    const service = new NotificationService({ describeSession, readSettings: () => DEFAULT_NOTIFICATION_SETTINGS,
      isAppFocused: () => false, hasMobileOnline: () => false, t: key => key })
    service.registerChannel({ id: 'desktop', isAvailable: () => true,
      deliver: intent => { delivered.push(intent) }, withdraw: () => {} })
    const route = { sessionId: 'same', projectPath: 'remote:route:/srv/project' }
    service.handleEvent({ type: 'status_change', status: 'streaming', ...route })
    service.handleEvent({ type: 'status_change', status: 'idle', ...route })
    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    expect(delivered[0]).toMatchObject({ ...route, title: 'VPS · Remote title' })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('session.get', { sessionId: 'same', includeTranscript: false })
    expect(host.getGateway).toHaveBeenCalledWith('node')
    expect(host.listEnvironments).toHaveBeenCalledWith({ includeDescriptors: false })
    expect(describeLocal).not.toHaveBeenCalled()
  })

  it('keeps local and collaboration notification lookup synchronous and lazy', () => {
    const { describeSession, describeLocal, getHost } = setup()
    expect(describeSession('same', '/local')).toEqual({ title: 'Local title', projectPath: '/local' })
    expect(describeSession('same')).toEqual({ title: 'Local title', projectPath: '/local' })
    expect(describeLocal).toHaveBeenCalledTimes(2)
    expect(getHost).not.toHaveBeenCalled()
  })

  it('reads a renamed title on the next notification instead of retaining a stale snapshot', async () => {
    const { describeSession, rpc } = setup()
    await describeSession('same', 'remote:route:/srv/project')
    rpc.mockResolvedValueOnce({ sessionId: 'same', title: 'Renamed' })
    expect(await describeSession('same', 'remote:route:/srv/project')).toMatchObject({ title: 'Renamed' })
  })

  it('preserves node label and route when the node disconnects or rejects the header read', async () => {
    const { describeSession, rpc, items, describeLocal } = setup()
    rpc.mockRejectedValueOnce(new Error('connection lost'))
    const fallback = { projectPath: 'remote:route:/srv/project', environmentLabel: 'VPS' }
    expect(await describeSession('same', fallback.projectPath)).toEqual(fallback)
    items[0].state = 'disconnected'
    expect(await describeSession('same', fallback.projectPath)).toEqual(fallback)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(describeLocal).not.toHaveBeenCalled()
  })

  it('does not guess another host when the remote route is unknown', async () => {
    const { describeSession, rpc, describeLocal } = setup()
    expect(await describeSession('same', 'remote:unknown:/srv/project')).toEqual({
      projectPath: 'remote:unknown:/srv/project', environmentLabel: undefined,
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(describeLocal).not.toHaveBeenCalled()
  })
})
