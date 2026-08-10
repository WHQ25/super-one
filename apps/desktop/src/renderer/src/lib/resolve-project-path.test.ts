/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { resolveProjectNameFromFolders, resolveProjectPathForOpen } from './resolve-project-path'

const FOLDERS = [
  { id: 'proj-1', path: '/tmp/proj', name: 'proj', addedAt: '2026-01-01', lastOpened: '2026-01-03' },
  { id: 'proj-2', path: '/tmp/other', name: 'other', addedAt: '2026-01-01', lastOpened: '2026-01-02' },
]

/**
 * vitest.setup.ts installs `window.app` as a catch-all Proxy whose `get` trap ignores
 * the target, so assigning a property onto it is silently dropped — replace the whole
 * object to stub one IPC method.
 */
function stubGetRecentFolders(impl: () => Promise<unknown>) {
  ;(globalThis.window as unknown as Record<string, unknown>).app = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'getRecentFolders' ? impl : () => Promise.resolve(undefined),
    },
  )
}

describe('opening a session listed by the archive tools', () => {
  beforeEach(() => {
    useAppStore.setState({ recentFolders: FOLDERS, currentFolder: '/tmp/proj' })
    useChatStore.setState({ activeProject: '/tmp/proj' })
    stubGetRecentFolders(async () => FOLDERS)
  })

  it('resolves a foreign projectId to its own folder, not the active project', async () => {
    await expect(resolveProjectPathForOpen('proj-2', '/tmp/proj')).resolves.toBe('/tmp/other')
  })

  it('refreshes recentFolders once when the id is missing from the cache', async () => {
    useAppStore.setState({ recentFolders: [FOLDERS[0]!] })
    const fetchSpy = vi.fn(async () => FOLDERS)
    stubGetRecentFolders(fetchSpy)

    await expect(resolveProjectPathForOpen('proj-2', '/tmp/proj')).resolves.toBe('/tmp/other')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('returns null for an unresolvable projectId instead of opening in the active project', async () => {
    // Regression: falling back here loaded a foreign session against the wrong cwd.
    await expect(resolveProjectPathForOpen('proj-gone', '/tmp/proj')).resolves.toBeNull()
  })

  it('still falls back to the active project when the payload carries no projectId', async () => {
    await expect(resolveProjectPathForOpen(null, '/tmp/proj')).resolves.toBe('/tmp/proj')
    await expect(resolveProjectPathForOpen(undefined)).resolves.toBe('/tmp/proj')
  })

  it('survives a failed recentFolders refresh without falling back', async () => {
    stubGetRecentFolders(async () => {
      throw new Error('ipc down')
    })
    await expect(resolveProjectPathForOpen('proj-gone', '/tmp/proj')).resolves.toBeNull()
  })

  it('resolves a project display name for confirm-dialog grouping', () => {
    expect(resolveProjectNameFromFolders('proj-2', FOLDERS)).toBe('other')
    expect(resolveProjectNameFromFolders('proj-gone', FOLDERS)).toBeNull()
    expect(resolveProjectNameFromFolders(null, FOLDERS)).toBeNull()
  })
})
