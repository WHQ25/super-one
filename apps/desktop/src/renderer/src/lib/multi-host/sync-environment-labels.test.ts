/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyEnvironmentListChanged, resetEnvironmentListCache } from '@/lib/environment-list'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'
import type { EnvironmentBucket } from './types'
import { resetEnvironmentLabelSyncForTests, startEnvironmentLabelSync } from './sync-environment-labels'

const remote: EnvironmentBucket = {
  environmentId: 'node-1',
  connectionId: 'conn-1',
  label: 'old-box',
  kind: 'cli-node',
  connection: 'connected',
  projectsStatus: 'ready',
  projectsError: null,
  checkouts: [],
}

beforeEach(() => {
  resetEnvironmentLabelSyncForTests()
  resetEnvironmentListCache()
  useMultiHostSidebarStore.setState({ environments: [remote] })
  Object.assign(window.environment, {
    listItems: vi.fn(async () => [{ connectionId: 'conn-1', label: 'studio' }]),
    onStatusEvent: () => () => {},
  })
})

describe('startEnvironmentLabelSync', () => {
  it('copies a rename onto the sidebar catalog while that sidebar is unmounted', async () => {
    startEnvironmentLabelSync()
    notifyEnvironmentListChanged('conn-1')
    await vi.waitFor(() => {
      expect(useMultiHostSidebarStore.getState().environments[0]?.label).toBe('studio')
    })
    expect(useMultiHostSidebarStore.getState().environments[0]?.checkouts).toBe(remote.checkouts)
  })
})
