import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCachedHarnessResources = vi.fn()
const getHarnessResourceCacheAgeMs = vi.fn()
const setCachedHarnessResources = vi.fn()

vi.mock('../database', () => ({
  getCachedHarnessResources: (...args: unknown[]) => getCachedHarnessResources(...args),
  getHarnessResourceCacheAgeMs: (...args: unknown[]) => getHarnessResourceCacheAgeMs(...args),
  setCachedHarnessResources: (...args: unknown[]) => setCachedHarnessResources(...args),
}))

import {
  HARNESS_RESOURCES_CACHE_TTL_MS,
  connectWithHarnessResourceCache,
  getFreshHarnessResources,
} from './resource-cache'

describe('getFreshHarnessResources', () => {
  beforeEach(() => {
    getCachedHarnessResources.mockReset()
    getHarnessResourceCacheAgeMs.mockReset()
    setCachedHarnessResources.mockReset()
  })

  it('returns null when force is set', () => {
    getCachedHarnessResources.mockReturnValue({ models: [{ id: 'a' }] })
    getHarnessResourceCacheAgeMs.mockReturnValue(1000)
    expect(getFreshHarnessResources('cursor', { force: true })).toBeNull()
  })

  it('returns null when cache is stale', () => {
    getCachedHarnessResources.mockReturnValue({ models: [{ id: 'a' }] })
    getHarnessResourceCacheAgeMs.mockReturnValue(HARNESS_RESOURCES_CACHE_TTL_MS + 1)
    expect(getFreshHarnessResources('cursor')).toBeNull()
  })

  it('returns null when isUsable rejects the cache', () => {
    getCachedHarnessResources.mockReturnValue({ models: [] })
    getHarnessResourceCacheAgeMs.mockReturnValue(1000)
    expect(getFreshHarnessResources('cursor', {
      isUsable: (r) => (r.models?.length ?? 0) > 0,
    })).toBeNull()
  })

  it('returns fresh usable cache', () => {
    const resources = { models: [{ id: 'a' }] }
    getCachedHarnessResources.mockReturnValue(resources)
    getHarnessResourceCacheAgeMs.mockReturnValue(5_000)
    expect(getFreshHarnessResources('cursor', {
      isUsable: (r) => (r.models?.length ?? 0) > 0,
    })).toEqual({ resources, ageMs: 5_000 })
  })
})

describe('connectWithHarnessResourceCache', () => {
  beforeEach(() => {
    getCachedHarnessResources.mockReset()
    getHarnessResourceCacheAgeMs.mockReset()
    setCachedHarnessResources.mockReset()
  })

  it('skips probe on fresh cache', async () => {
    const resources = { models: [{ id: 'cached' }] }
    getCachedHarnessResources.mockReturnValue(resources)
    getHarnessResourceCacheAgeMs.mockReturnValue(1_000)
    const probe = vi.fn()
    await expect(connectWithHarnessResourceCache('cursor', {
      probe,
      isUsable: (r) => (r.models?.length ?? 0) > 0,
    })).resolves.toEqual(resources)
    expect(probe).not.toHaveBeenCalled()
  })

  it('probes, writes cache, and returns fresh resources', async () => {
    getCachedHarnessResources.mockReturnValue(null)
    getHarnessResourceCacheAgeMs.mockReturnValue(null)
    const fresh = { models: [{ id: 'new' }] }
    const probe = vi.fn().mockResolvedValue(fresh)
    await expect(connectWithHarnessResourceCache('cursor', { probe })).resolves.toEqual(fresh)
    expect(setCachedHarnessResources).toHaveBeenCalledWith('cursor', fresh)
  })

  it('falls back to stale cache when probe fails', async () => {
    const stale = { models: [{ id: 'stale' }] }
    getCachedHarnessResources
      .mockReturnValueOnce(null) // freshness check
      .mockReturnValueOnce(stale) // fallback read
    getHarnessResourceCacheAgeMs.mockReturnValue(null)
    const probe = vi.fn().mockRejectedValue(new Error('network'))
    await expect(connectWithHarnessResourceCache('cursor', {
      probe,
      fallbackToCacheOnError: true,
    })).resolves.toEqual(stale)
  })
})
