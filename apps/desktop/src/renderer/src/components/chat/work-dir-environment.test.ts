/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import type { HostCheckout } from '@/lib/multi-host/types'
import { environmentRowsOrLocal, projectDirectoryName, workDirEnvironmentOptions } from './work-dir-environment'

const ORIGIN = 'git:https://github.com/acme/app.git'

function checkout(repoIdentity: string | null): HostCheckout {
  return {
    ref: { environmentId: 'env', projectId: 'project' },
    environmentId: 'env',
    connectionId: 'conn',
    projectId: 'project',
    name: 'app',
    pathKey: '/repo',
    hostPath: '/repo',
    repoIdentity,
    addedAt: 0,
    lastOpened: 0,
  }
}

function buckets() {
  return [
    {
      environmentId: 'local-env',
      connectionId: 'local',
      label: 'This Mac',
      connection: 'connected' as const,
      checkouts: [checkout(ORIGIN)],
    },
    {
      environmentId: 'office',
      connectionId: 'office',
      label: 'Office',
      connection: 'connected' as const,
      checkouts: [] as HostCheckout[],
    },
  ]
}

describe('environmentRowsOrLocal', () => {
  it('names this machine when the catalog is empty', () => {
    expect(environmentRowsOrLocal([], 'This Mac')).toEqual([{
      environmentId: 'local',
      connectionId: 'local',
      label: 'This Mac',
      kind: 'current',
      needsUpgrade: false,
      hostKind: 'local',
    }])
  })
})

describe('workDirEnvironmentOptions', () => {
  it('offers clone-here when another machine has no checkout of this origin', () => {
    const rows = workDirEnvironmentOptions({
      buckets: buckets(),
      currentEnvironmentId: 'local',
      repoIdentity: ORIGIN,
      isGitRepo: true,
    })
    expect(rows.map((row) => [row.environmentId, row.kind])).toEqual([
      ['local-env', 'current'],
      ['office', 'clone-here'],
    ])
  })

  it('disables other machines when this checkout has no origin', () => {
    const rows = workDirEnvironmentOptions({
      buckets: buckets(),
      currentEnvironmentId: 'local-env',
      repoIdentity: null,
      isGitRepo: true,
    })
    expect(rows[1]?.kind).toBe('no-origin')
  })

  it('lets offline win over the current environment', () => {
    const [local, office] = buckets()
    const rows = workDirEnvironmentOptions({
      buckets: [{ ...local!, connection: 'offline' }, office!],
      currentEnvironmentId: 'local',
      repoIdentity: ORIGIN,
      isGitRepo: true,
    })
    expect(rows[0]?.kind).toBe('offline')
  })

  it('lets offline win over a missing checkout', () => {
    const [local, office] = buckets()
    const rows = workDirEnvironmentOptions({
      buckets: [local!, { ...office!, connection: 'offline' }],
      currentEnvironmentId: 'local',
      repoIdentity: ORIGIN,
      isGitRepo: true,
    })
    expect(rows[1]).toMatchObject({ kind: 'offline', needsUpgrade: false })
  })

  it('marks a connected checkout that still needs an upgrade', () => {
    const [local, office] = buckets()
    const rows = workDirEnvironmentOptions({
      buckets: [local!, { ...office!, connection: 'needs-upgrade', checkouts: [checkout(ORIGIN)] }],
      currentEnvironmentId: 'local',
      repoIdentity: ORIGIN,
      isGitRepo: true,
    })
    expect(rows[1]).toMatchObject({ kind: 'needs-upgrade', needsUpgrade: true })
  })
})

describe('projectDirectoryName', () => {
  it('uses the folder name and strips a remote route key', () => {
    expect(projectDirectoryName('/Users/me/Projects/app/')).toBe('app')
    expect(projectDirectoryName('remote:office:/srv/src/app')).toBe('app')
    expect(projectDirectoryName(null)).toBe('project')
  })
})
