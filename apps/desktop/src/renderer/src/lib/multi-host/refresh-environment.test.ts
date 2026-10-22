/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSnapshot } from '@superone/shared/environment'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'
import type { EnvironmentBucket } from './types'
import { catalogLoads } from './catalog'
import { refreshEnvironmentCheckouts } from './refresh-environment'

const keptCheckout = {
  ref: { environmentId: 'office', projectId: 'old' },
  environmentId: 'office',
  connectionId: 'office',
  projectId: 'old',
  name: 'app',
  pathKey: 'remote:office:/srv/app',
  hostPath: '/srv/app',
  repoIdentity: null,
  addedAt: 1,
  lastOpened: 2,
}

const bucket: EnvironmentBucket = {
  environmentId: 'office',
  connectionId: 'office',
  label: 'Office',
  kind: 'cli-node',
  connection: 'connected',
  projectsStatus: 'ready',
  projectsError: null,
  checkouts: [keptCheckout],
}

describe('refreshEnvironmentCheckouts', () => {
  beforeEach(() => {
    useMultiHostSidebarStore.setState({ environments: [bucket] })
  })

  it('does not overwrite a newer catalog load', async () => {
    let release: (projects: ProjectSnapshot[]) => void = () => {}
    window.environment.listProjects = vi.fn(() => new Promise<ProjectSnapshot[]>((resolve) => {
      release = resolve
    }))
    const pending = refreshEnvironmentCheckouts('office')
    await vi.waitFor(() => expect(window.environment.listProjects).toHaveBeenCalled())
    catalogLoads.next()
    release([])
    await pending
    expect(useMultiHostSidebarStore.getState().environments[0]?.checkouts).toEqual([keptCheckout])
  })
})
