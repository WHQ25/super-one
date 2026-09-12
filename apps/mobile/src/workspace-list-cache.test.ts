import { describe, expect, it } from 'vitest'
import { WorkspaceListCache } from './workspace-list-cache'

const list = (revision: number) => ({ rows: [{ sessionId: 's1', title: 'one' }], total: 1, revision })

describe('WorkspaceListCache', () => {
  it('holds a stored list at the revision it was read', () => {
    const cache = new WorkspaceListCache()
    expect(cache.get('/a')).toBeUndefined()
    cache.store('/a', list(cache.revisionOf('/a')))
    expect(cache.get('/a')?.revision).toBe(cache.revisionOf('/a'))
  })

  it('stales only the project the host named', () => {
    const cache = new WorkspaceListCache()
    cache.store('/a', list(cache.revisionOf('/a')))
    cache.store('/b', list(cache.revisionOf('/b')))
    cache.invalidate('/a')
    expect(cache.get('/a')?.revision).not.toBe(cache.revisionOf('/a'))
    expect(cache.get('/b')?.revision).toBe(cache.revisionOf('/b'))
  })

  it('stales every project on a reconnect, including ones never invalidated by name', () => {
    const cache = new WorkspaceListCache()
    cache.store('/a', list(cache.revisionOf('/a')))
    cache.store('/b', list(cache.revisionOf('/b')))
    cache.invalidateAll()
    expect(cache.get('/a')?.revision).not.toBe(cache.revisionOf('/a'))
    expect(cache.get('/b')?.revision).not.toBe(cache.revisionOf('/b'))
  })

  it('keeps per-project and reconnect bumps from cancelling out', () => {
    // A list read after a named bump but before a reconnect must still read as
    // stale afterwards; a revision that is a sum can only grow.
    const cache = new WorkspaceListCache()
    cache.invalidate('/a')
    cache.store('/a', list(cache.revisionOf('/a')))
    cache.invalidateAll()
    expect(cache.get('/a')?.revision).toBeLessThan(cache.revisionOf('/a'))
  })

  it('stales the pinned section on any change, since it spans every project', () => {
    const cache = new WorkspaceListCache()
    cache.pinned = { rows: [], revision: cache.pinnedRevision }
    cache.invalidate('/anywhere')
    expect(cache.pinned.revision).not.toBe(cache.pinnedRevision)
    const after = cache.pinnedRevision
    cache.invalidateAll()
    expect(cache.pinnedRevision).toBeGreaterThan(after)
  })
})
