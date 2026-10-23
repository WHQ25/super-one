import { describe, expect, it, vi } from 'vitest'
import { projectRef } from '@superone/shared/environment'
import type { EnvironmentListItem, ProjectSnapshot } from '@superone/shared/environment'
import { applyCatalogBucket, createCatalogGeneration, loadEnvironmentCatalog, shareCatalog, shareProjectLoad } from './catalog'
import type { EnvironmentBucket } from './types'
import { connectionOf, environmentKindOf, multiHostChromeVisible } from './environment-kind'
import { checkoutMergeKey, groupCheckoutsByRepo, sortProjectGroups } from './group-projects'
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
    ...(partial.extraDirs ? { extraDirs: partial.extraDirs } : {}),
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
      collapsedEnvironmentIds: ['env-1'],
    }))).toEqual({
      groupBy: 'environment',
      sort: 'added',
      expandedProjectKeys: ['local:p1'],
      collapsedEnvironmentIds: ['env-1'],
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
      collapsedEnvironmentIds: [],
    })
    expect(readSidebarSettings(storage).groupBy).toBe('environment')
    expect(readSidebarSettings(storage).sort).toBe('added')
  })

  it('keeps the newest expansion keys when the list is over the cap', () => {
    const keys = Array.from({ length: 205 }, (_, index) => `k${index}`)
    const parsed = parseSidebarSettings(JSON.stringify({ expandedProjectKeys: keys }))
    expect(parsed.expandedProjectKeys).toHaveLength(200)
    expect(parsed.expandedProjectKeys[0]).toBe('k5')
    expect(parsed.expandedProjectKeys.at(-1)).toBe('k204')
    const storage = memory()
    writeSidebarSettings(storage, { ...parsed, expandedProjectKeys: keys, collapsedEnvironmentIds: keys })
    const saved = readSidebarSettings(storage)
    expect(saved.expandedProjectKeys[0]).toBe('k5')
    expect(saved.collapsedEnvironmentIds.at(-1)).toBe('k204')
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

describe('catalog generation', () => {
  it('marks an older load stale once a newer one starts', () => {
    const loads = createCatalogGeneration()
    const first = loads.next()
    const second = loads.next()
    expect(first.current()).toBe(false)
    expect(second.current()).toBe(true)
    expect(first.id).toBeLessThan(second.id)
  })

  it('marks a watch stale once a newer load starts', () => {
    const loads = createCatalogGeneration()
    const seen = loads.watch()
    expect(seen.current()).toBe(true)
    loads.next()
    expect(seen.current()).toBe(false)
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

  it('carries the live link path of a connected remote for its icon', async () => {
    const buckets = await loadEnvironmentCatalog({
      remoteEnabled: true,
      localLabel: 'This Mac',
      localFolders: [],
      listItems: async () => [
        item({ connectionId: 'local', environmentId: 'desktop', label: 'This Mac', kind: 'local', installationProfile: 'local-electron' }),
        item({ connectionId: 'cli-1', environmentId: 'node-1', label: 'build', kind: 'remote', installationProfile: 'systemd-user', activePath: 'lan' }),
        item({ connectionId: 'cli-2', environmentId: 'node-2', label: 'gpu', kind: 'remote', installationProfile: 'systemd-user', state: 'offline' }),
      ],
      listProjects: async () => [],
    })
    expect(buckets.map((bucket) => bucket.path)).toEqual([undefined, 'lan', undefined])
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

  it('dials a host that needs an upgrade and skips one that is still connecting', async () => {
    const calls: string[] = []
    const buckets = await loadEnvironmentCatalog({
      remoteEnabled: true,
      localLabel: 'This Mac',
      localFolders: [],
      listItems: async () => [
        item({ connectionId: 'local', environmentId: 'desktop', kind: 'local' }),
        item({
          connectionId: 'cli-1',
          environmentId: 'node-1',
          kind: 'remote',
          state: 'connected',
          nodeUpgrade: { remoteVersion: '1', targetVersion: '2', canUpgradeOverSsh: true },
        }),
        item({ connectionId: 'cli-2', environmentId: 'node-2', kind: 'remote', state: 'connecting' }),
        item({ connectionId: 'cli-3', environmentId: 'node-3', kind: 'remote', state: 'disconnected' }),
      ],
      listProjects: async (connectionId) => {
        calls.push(connectionId)
        return connectionId === 'local' ? [localProject] : [remoteProject]
      },
    })
    expect(calls).toEqual(['local', 'cli-1'])
    expect(buckets.find((bucket) => bucket.connectionId === 'cli-1')?.connection).toBe('needs-upgrade')
    expect(buckets.find((bucket) => bucket.connectionId === 'cli-1')?.projectsStatus).toBe('ready')
    expect(buckets.find((bucket) => bucket.connectionId === 'cli-2')).toMatchObject({ connection: 'connecting', projectsStatus: 'idle', checkouts: [] })
    expect(buckets.find((bucket) => bucket.connectionId === 'cli-3')).toMatchObject({ connection: 'offline', projectsStatus: 'idle', checkouts: [] })
  })

  it('loads remotes together and publishes each bucket as it settles', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const started: string[] = []
    const events: string[] = []
    const pending = loadEnvironmentCatalog({
      remoteEnabled: true,
      localLabel: 'This Mac',
      localFolders: [],
      timeoutMs: 1000,
      listItems: async () => [
        item({ connectionId: 'local', environmentId: 'desktop', kind: 'local' }),
        item({ connectionId: 'cli-1', environmentId: 'node-1', kind: 'remote' }),
        item({ connectionId: 'cli-2', environmentId: 'node-2', kind: 'remote' }),
      ],
      listProjects: async (connectionId) => {
        started.push(connectionId)
        if (connectionId !== 'local') await gate
        return []
      },
      onBucket: (bucket) => { events.push(`${bucket.connectionId}:${bucket.projectsStatus}`) },
    })
    await vi.waitFor(() => expect(started).toEqual(['local', 'cli-1', 'cli-2']))
    release()
    const buckets = await pending
    expect(buckets.map((bucket) => bucket.connectionId)).toEqual(['local', 'cli-1', 'cli-2'])
    expect(events).toContain('local:loading')
    expect(events).toContain('cli-1:loading')
    expect(events).toContain('cli-1:ready')
    expect(events).toContain('cli-2:ready')
  })

  it('times out one environment without dropping the others', async () => {
    const buckets = await loadEnvironmentCatalog({
      remoteEnabled: true,
      localLabel: 'This Mac',
      localFolders: [],
      timeoutMs: 20,
      listItems: async () => [
        item({ connectionId: 'local', environmentId: 'desktop', kind: 'local' }),
        item({ connectionId: 'cli-1', environmentId: 'node-1', kind: 'remote' }),
        item({ connectionId: 'cli-slow', environmentId: 'node-slow', kind: 'remote' }),
      ],
      listProjects: async (connectionId) => {
        if (connectionId === 'cli-slow') return new Promise(() => {})
        return connectionId === 'local' ? [localProject] : [remoteProject]
      },
    })
    expect(buckets.find((bucket) => bucket.connectionId === 'cli-1')?.projectsStatus).toBe('ready')
    expect(buckets.find((bucket) => bucket.connectionId === 'cli-slow')).toMatchObject({
      projectsStatus: 'error',
      projectsError: 'timed out',
      checkouts: [],
    })
  })

  it('times out the environment list and still returns the local bucket', async () => {
    const buckets = await loadEnvironmentCatalog({
      remoteEnabled: true,
      localLabel: 'This Mac',
      localFolders: [],
      timeoutMs: 20,
      listItems: () => new Promise(() => {}),
      listProjects: async () => [localProject],
    })
    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.connectionId).toBe('local')
    expect(buckets[0]?.projectsStatus).toBe('ready')
  })
})

describe('catalog bucket writes', () => {
  function localBucket(checkouts: HostCheckout[], extra?: Partial<EnvironmentBucket>): EnvironmentBucket {
    return {
      environmentId: 'local',
      connectionId: 'local',
      label: 'This Mac',
      kind: 'local',
      connection: 'connected',
      projectsStatus: 'ready',
      projectsError: null,
      checkouts,
      ...extra,
    }
  }

  it('does not write a reload of a settled environment until it lands', () => {
    const kept = checkout({ environmentId: 'local', projectId: 'old', name: 'app' })
    const previous = [localBucket([kept])]
    const loading = applyCatalogBucket(previous, localBucket([], { projectsStatus: 'loading' }))
    expect(loading).toBe(previous)
    const ready = applyCatalogBucket(loading, localBucket([]))
    expect(ready[0]?.checkouts).toEqual([])
  })

  it('keeps the checkouts of an unsettled environment while it loads', () => {
    const kept = checkout({ environmentId: 'local', projectId: 'old', name: 'app' })
    const previous = [localBucket([kept], { projectsStatus: 'idle' })]
    const loading = applyCatalogBucket(previous, localBucket([], { projectsStatus: 'loading' }))
    expect(loading[0]?.projectsStatus).toBe('loading')
    expect(loading[0]?.checkouts).toEqual([kept])
  })

  it('returns the same catalog when a reload lists the same projects', () => {
    const previous = [localBucket([
      checkout({ environmentId: 'local', projectId: 'a', name: 'a' }),
      checkout({ environmentId: 'local', projectId: 'b', name: 'b', extraDirs: ['/x'] }),
    ])]
    const reloaded = [localBucket([
      checkout({ environmentId: 'local', projectId: 'a', name: 'a' }),
      checkout({ environmentId: 'local', projectId: 'b', name: 'b', extraDirs: ['/x'] }),
    ])]
    expect(shareCatalog(previous, reloaded)).toBe(previous)
  })

  it('replaces only the checkout that changed', () => {
    const a = checkout({ environmentId: 'local', projectId: 'a', name: 'a' })
    const b = checkout({ environmentId: 'local', projectId: 'b', name: 'b' })
    const previous = [localBucket([a, b])]
    const opened = checkout({ environmentId: 'local', projectId: 'b', name: 'b', lastOpened: 5 })
    const next = shareCatalog(previous, [localBucket([
      checkout({ environmentId: 'local', projectId: 'a', name: 'a' }),
      opened,
    ])])
    expect(next).not.toBe(previous)
    expect(next[0]?.checkouts[0]).toBe(a)
    expect(next[0]?.checkouts[1]).toBe(opened)
  })

  it('shares one listProjects call until it settles', async () => {
    let calls = 0
    let release: (projects: ProjectSnapshot[]) => void = () => {}
    const first = shareProjectLoad('share-test', () => {
      calls += 1
      return new Promise((resolve) => { release = resolve })
    })
    const second = shareProjectLoad('share-test', async () => {
      calls += 1
      return []
    })
    expect(calls).toBe(1)
    expect(second).toBe(first)
    release([{ projectId: 'p', path: '/p', name: 'p' }])
    await first
    await shareProjectLoad('share-test', async () => {
      calls += 1
      return []
    })
    expect(calls).toBe(2)
  })
})
