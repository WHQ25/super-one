/** @vitest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSnapshot } from '@superone/shared/environment'
import { projectRef } from '@superone/shared/environment'
import { useAppStore } from '@/stores/app'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'
import type { EnvironmentBucket, HostCheckout } from '@/lib/multi-host/types'
import { useLoadMultiHostCatalog } from './use-load-multi-host-catalog'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/environment-list', () => ({
  loadEnvironmentItems: vi.fn(async () => []),
  subscribeEnvironmentList: vi.fn(() => () => {}),
}))
vi.mock('@/lib/host-projects-bus', () => ({
  onHostProjectsChanged: vi.fn(() => () => {}),
}))

const kept: HostCheckout = {
  ref: projectRef('local', 'old'),
  environmentId: 'local',
  connectionId: 'local',
  projectId: 'old',
  name: 'app',
  pathKey: '/src/app',
  hostPath: '/src/app',
  repoIdentity: 'git:https://github.com/acme/app.git',
  addedAt: 1,
  lastOpened: 2,
}

const ready: EnvironmentBucket = {
  environmentId: 'local',
  connectionId: 'local',
  label: 'This Mac',
  kind: 'local',
  connection: 'connected',
  projectsStatus: 'ready',
  projectsError: null,
  checkouts: [kept],
}

describe('useLoadMultiHostCatalog', () => {
  let release: (projects: ProjectSnapshot[]) => void = () => {}

  beforeEach(() => {
    release = () => {}
    window.environment.listProjects = vi.fn(() => new Promise<ProjectSnapshot[]>((resolve) => {
      release = resolve
    }))
    Object.assign(window.app, { platform: 'darwin' })
    useAppStore.setState({ recentFolders: [] })
    useMultiHostSidebarStore.setState({ environments: [ready] })
  })

  it('keeps the current checkouts while a reload is in flight', async () => {
    renderHook(() => useLoadMultiHostCatalog(true))
    await waitFor(() => {
      const bucket = useMultiHostSidebarStore.getState().environments[0]
      expect(bucket?.projectsStatus).toBe('loading')
      expect(bucket?.checkouts).toEqual([kept])
    })
    release([{ projectId: 'new', path: '/src/new', name: 'new' }])
    await waitFor(() => {
      const bucket = useMultiHostSidebarStore.getState().environments[0]
      expect(bucket?.projectsStatus).toBe('ready')
      expect(bucket?.checkouts.map((checkout) => checkout.projectId)).toEqual(['new'])
    })
  })
})
