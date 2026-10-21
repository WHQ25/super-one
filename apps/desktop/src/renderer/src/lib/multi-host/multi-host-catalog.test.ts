import { describe, expect, it } from 'vitest'
import { projectRef } from '@superone/shared/environment'
import type { EnvironmentListItem, ProjectSnapshot } from '@superone/shared/environment'
import { loadEnvironmentCatalog } from './catalog'
import { connectionOf, environmentKindOf, multiHostChromeVisible } from './environment-kind'
import { checkoutMergeKey, groupCheckoutsByRepo, sortProjectGroups } from './group-projects'
import { beginSessionLoad, commitSessionPage, failSessionPage, mergeRowsById } from './session-pages'
import { parseSidebarSettings, readSidebarSettings, writeSidebarSettings, type SidebarSettingsStorage } from './sidebar-settings'
import type { HostCheckout } from './types'

function memory(): SidebarSettingsStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}

function checkout(partial: Partial<HostCheckout> & Pick<HostCheckout, 'projectId' | 'environmentId' | 'name'>): HostCheckout {
  return {
    ref: projectRef(partial.environmentId, partial.projectId),
    environmentId: partial.environmentId,
    projectId: partial.projectId,
    name: partial.name,
    connectionId: partial.connectionId ?? 'local',
    pathKey: partial.pathKey ?? `/p/${partial.projectId}`,
    hostPath: partial.hostPath ?? `/p/${partial.projectId}`,
    repoIdentity: partial.repoIdentity ?? null,
    addedAt: partial.addedAt ?? 0,
    lastOpened: partial.lastOpened ?? 0,
  }
}

function item(partial: Partial<EnvironmentListItem> & Pick<EnvironmentListItem, 'connectionId' | 'environmentId'>): EnvironmentListItem {
  return {
    label: partial.connectionId,
    kind: partial.connectionId === 'local' ? 'local' : 'remote',
    state: 'connected',
    endpointProfiles: [],
    ...partial,
  }
}

describe('sidebar settings', () => {
  it('drops unknown values and keeps a valid sort', () => {
    expect(parseSidebarSettings(JSON.stringify({
      groupBy: 'environment',
      sort: 'added',
      expandedProjectKeys: ['local:p1', 4],
      expandedEnvironmentIds: ['env-1'],
    }))).toEqual({
      groupBy: 'environment',
      sort: 'added',
      expandedProjectKeys: ['local:p1'],
      expandedEnvironmentIds: ['env-1'],
    })
    expect(parseSidebarSettings('not-json').sort).toBe('recent')
    expect(parseSidebarSettings(JSON.stringify({ sort: 'alphabetical' })).sort).toBe('recent')
  })

  it('round-trips through storage', () => {
    const storage = memory()
    writeSidebarSettings(storage, {
      groupBy: 'environment',
      sort: 'added',
      expandedProjectKeys: ['local:p1'],
      expandedEnvironmentIds: [],
    })
    expect(readSidebarSettings(storage).groupBy).toBe('environment')
    expect(readSidebarSettings(storage).sort).toBe('added')
  })
})

describe('environment kind', () => {
  it('treats a remote local-electron profile as a desktop and anything else as a CLI node', () => {
    expect(environmentKindOf({ kind: 'local', installationProfile: 'local-electron' })).toBe('local')
    expect(environmentKindOf({ kind: 'remote', installationProfile: 'local-electron' })).toBe('remote-desktop')
    expect(environmentKindOf({ kind: 'remote', installationProfile: 'systemd-user' })).toBe('cli-node')
    expect(environmentKindOf({ kind: 'remote' })).toBe('cli-node')
  })

  it('keeps an explicit disconnect offline even when an upgrade is available', () => {
    expect(connectionOf({ state: 'connected', desired: false, nodeUpgrade: { remoteVersion: '1', targetVersion: '2', canUpgradeOverSsh: true } })).toBe('offline')
    expect(connectionOf({ state: 'connected', nodeUpgrade: { remoteVersion: '1', targetVersion: '2', canUpgradeOverSsh: true } })).toBe('needs-upgrade')
    expect(connectionOf({ state: 'offline' })).toBe('offline')
    expect(connectionOf({ state: 'connecting' })).toBe('connecting')
  })

  it('hides multi-host chrome when the flag is off or only this machine is listed', () => {
    expect(multiHostChromeVisible(true, [{ connectionId: 'local' }])).toBe(false)
    expect(multiHostChromeVisible(false, [{ connectionId: 'local' }, { connectionId: 'node' }])).toBe(false)
    expect(multiHostChromeVisible(true, [{ connectionId: 'local' }, { connectionId: 'node' }])).toBe(true)
  })
})

describe('project grouping', () => {
  const local = checkout({
    environmentId: 'desktop',
    projectId: 'p-local',
    name: 'app',
    connectionId: 'local',
    repoIdentity: 'git:git@github.com:acme/app.git',
    lastOpened: 20,
    addedAt: 5,
  })
  const remote = checkout({
    environmentId: 'node-1',
    projectId: 'p-remote',
    name: 'app',
    connectionId: 'node-1',
    repoIdentity: 'git:https://github.com/acme/app.git',
    lastOpened: 10,
    addedAt: 1,
    hostPath: '/srv/app',
    pathKey: 'remote:node-1:/srv/app',
  })
  const fork = checkout({
    environmentId: 'node-1',
    projectId: 'p-fork',
    name: 'app-fork',
    connectionId: 'node-1',
    repoIdentity: 'git:https://github.com/other/app.git',
    lastOpened: 30,
    addedAt: 30,
  })
  const plain = checkout({
    environmentId: 'desktop',
    projectId: 'p-plain',
    name: 'notes',
    repoIdentity: 'path:/Users/a/notes',
    lastOpened: 1,
  })

  it('merges ssh and https origins and leaves forks and non-git folders alone', () => {
    const groups = groupCheckoutsByRepo([local, remote, fork, plain])
    const merged = groups.find((group) => group.key === checkoutMergeKey(local))
    expect(merged?.checkouts.map((row) => row.projectId).sort()).toEqual(['p-local', 'p-remote'])
    expect(groups.find((group) => group.checkouts.some((row) => row.projectId === 'p-fork'))?.checkouts).toHaveLength(1)
    expect(groups.find((group) => group.checkouts.some((row) => row.projectId === 'p-plain'))?.checkouts).toHaveLength(1)
    expect(merged?.name).toBe('app')
  })

  it('sorts a merged row by the newest checkout', () => {
    const groups = sortProjectGroups(groupCheckoutsByRepo([local, remote, fork]), 'recent')
    expect(groups.map((group) => group.name)).toEqual(['app-fork', 'app'])
    expect(sortProjectGroups(groups, 'added').map((group) => group.name)).toEqual(['app', 'app-fork'])
  })
})

describe('session pages', () => {
  it('appends a later page without duplicating ids and keeps rows when a refresh fails', () => {
    const started = beginSessionLoad(undefined)
    expect(started.status).toBe('loading')
    const first = commitSessionPage(started, [{ sessionId: 'a' }, { sessionId: 'b' }], true, false)
    const more = commitSessionPage(beginSessionLoad(first), [{ sessionId: 'b' }, { sessionId: 'c' }], false, true)
    expect(more.sessions.map((row) => row.sessionId)).toEqual(['a', 'b', 'c'])
    expect(more.hasMore).toBe(false)
    const failed = failSessionPage(more, 'offline')
    expect(failed.sessions).toHaveLength(3)
    expect(failed.error).toBe('offline')
    expect(mergeRowsById([{ sessionId: 'a' }], [])).toEqual([{ sessionId: 'a' }])
  })
})

describe('loadEnvironmentCatalog', () => {
  const localProject: ProjectSnapshot = {
    projectId: 'p1',
    path: '/src/app',
    name: 'app',
    repoIdentity: 'git:https://github.com/acme/app.git',
    lastActiveAt: 50,
  }
  const remoteProject: ProjectSnapshot = {
    projectId: 'p2',
    path: '/srv/app',
    name: 'app',
    repoIdentity: 'git:https://github.com/acme/app.git',
    lastActiveAt: 40,
  }

  it('loads each connected environment and does not dial an offline node', async () => {
    const calls: string[] = []
    const buckets = await loadEnvironmentCatalog({
      remoteEnabled: true,
      localLabel: 'This Mac',
      localFolders: [],
      listItems: async () => [
        item({ connectionId: 'local', environmentId: 'desktop', label: 'This Mac', kind: 'local', installationProfile: 'local-electron' }),
        item({ connectionId: 'cli-1', environmentId: 'node-1', label: 'build', kind: 'remote', installationProfile: 'systemd-user' }),
        item({ connectionId: 'desk-2', environmentId: 'desk', label: 'studio', kind: 'remote', installationProfile: 'local-electron', state: 'offline' }),
      ],
      listProjects: async (connectionId) => {
        calls.push(connectionId)
        if (connectionId === 'local') return [localProject]
        if (connectionId === 'cli-1') return [remoteProject]
        throw new Error(`should not list ${connectionId}`)
      },
    })
    expect(calls).toEqual(['local', 'cli-1'])
    expect(buckets.map((bucket) => bucket.kind)).toEqual(['local', 'cli-node', 'remote-desktop'])
    expect(buckets[2]?.projectsStatus).toBe('idle')
    expect(buckets[2]?.checkouts).toEqual([])
    expect(buckets[0]?.checkouts[0]?.ref).toEqual({ environmentId: 'desktop', projectId: 'p1' })
    expect(buckets[1]?.checkouts[0]?.pathKey).toBe('remote:cli-1:/srv/app')
  })

  it('keeps a per-environment error and falls back to recent folders for this machine', async () => {
    const buckets = await loadEnvironmentCatalog({
      remoteEnabled: true,
      localLabel: 'This Mac',
      localFolders: [{ id: 'recent-1', path: '/src/notes', name: 'notes', lastOpened: '2026-01-01T00:00:00.000Z' }],
      listItems: async () => [
        item({ connectionId: 'local', environmentId: 'desktop', kind: 'local' }),
        item({ connectionId: 'cli-1', environmentId: 'node-1', kind: 'remote', state: 'connected' }),
      ],
      listProjects: async (connectionId) => {
        if (connectionId === 'local') throw new Error('local registry down')
        throw new Error('node refused')
      },
    })
    expect(buckets[0]?.projectsStatus).toBe('ready')
    expect(buckets[0]?.checkouts[0]?.projectId).toBe('recent-1')
    expect(buckets[0]?.checkouts[0]?.repoIdentity).toBeNull()
    expect(buckets[1]?.projectsStatus).toBe('error')
    expect(buckets[1]?.projectsError).toBe('node refused')
  })

  it('ignores remote hosts when the experiment is off', async () => {
    const buckets = await loadEnvironmentCatalog({
      remoteEnabled: false,
      localLabel: 'This Mac',
      localFolders: [],
      listItems: async () => { throw new Error('should not list items') },
      listProjects: async () => [localProject],
    })
    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.connectionId).toBe('local')
  })
})
