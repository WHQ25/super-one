import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const getCachedHarnessResources = vi.fn()
const getHarnessResourceCacheMeta = vi.fn()
const setCachedHarnessResources = vi.fn()

vi.mock('../database', () => ({
  getCachedHarnessResources: (...args: unknown[]) => getCachedHarnessResources(...args),
  getHarnessResourceCacheMeta: (...args: unknown[]) => getHarnessResourceCacheMeta(...args),
  setCachedHarnessResources: (...args: unknown[]) => setCachedHarnessResources(...args),
}))

import {
  HARNESS_RESOURCES_CACHE_TTL_MS,
  connectWithHarnessResourceCache,
  getFreshHarnessResources,
  harnessRuntimeCacheKey,
} from './resource-cache'

describe('getFreshHarnessResources', () => {
  beforeEach(() => {
    getCachedHarnessResources.mockReset()
    getHarnessResourceCacheMeta.mockReset()
    setCachedHarnessResources.mockReset()
  })

  it('returns null when force is set', () => {
    getCachedHarnessResources.mockReturnValue({ models: [{ id: 'a' }] })
    getHarnessResourceCacheMeta.mockReturnValue({ ageMs: 1000, cacheKey: null })
    expect(getFreshHarnessResources('cursor', { force: true })).toBeNull()
  })

  it('returns null when cache is stale', () => {
    getCachedHarnessResources.mockReturnValue({ models: [{ id: 'a' }] })
    getHarnessResourceCacheMeta.mockReturnValue({ ageMs: HARNESS_RESOURCES_CACHE_TTL_MS + 1, cacheKey: null })
    expect(getFreshHarnessResources('cursor')).toBeNull()
  })

  it('returns null when isUsable rejects the cache', () => {
    getCachedHarnessResources.mockReturnValue({ models: [] })
    getHarnessResourceCacheMeta.mockReturnValue({ ageMs: 1000, cacheKey: null })
    expect(getFreshHarnessResources('cursor', {
      isUsable: (r) => (r.models?.length ?? 0) > 0,
    })).toBeNull()
  })

  it('returns fresh usable cache', () => {
    const resources = { models: [{ id: 'a' }] }
    getCachedHarnessResources.mockReturnValue(resources)
    getHarnessResourceCacheMeta.mockReturnValue({ ageMs: 5_000, cacheKey: null })
    expect(getFreshHarnessResources('cursor', {
      isUsable: (r) => (r.models?.length ?? 0) > 0,
    })).toEqual({ resources, ageMs: 5_000 })
  })

  it('misses when the row was written by another runtime', () => {
    getCachedHarnessResources.mockReturnValue({ models: [{ id: 'a' }] })
    getHarnessResourceCacheMeta.mockReturnValue({ ageMs: 1_000, cacheKey: 'old-runtime' })
    expect(getFreshHarnessResources('claude', { cacheKey: 'new-runtime' })).toBeNull()
  })

  it('misses an unkeyed legacy row once a key is expected', () => {
    getCachedHarnessResources.mockReturnValue({ models: [{ id: 'a' }] })
    getHarnessResourceCacheMeta.mockReturnValue({ ageMs: 1_000, cacheKey: null })
    expect(getFreshHarnessResources('claude', { cacheKey: 'runtime' })).toBeNull()
  })

  it('still expires a matching key after the TTL', () => {
    getCachedHarnessResources.mockReturnValue({ models: [{ id: 'a' }] })
    getHarnessResourceCacheMeta.mockReturnValue({ ageMs: HARNESS_RESOURCES_CACHE_TTL_MS, cacheKey: 'runtime' })
    expect(getFreshHarnessResources('claude', { cacheKey: 'runtime' })).toBeNull()
  })

  it('hits a matching key within the TTL', () => {
    const resources = { models: [{ id: 'a' }] }
    getCachedHarnessResources.mockReturnValue(resources)
    getHarnessResourceCacheMeta.mockReturnValue({ ageMs: 1_000, cacheKey: 'runtime' })
    expect(getFreshHarnessResources('claude', { cacheKey: 'runtime' })).toEqual({ resources, ageMs: 1_000 })
  })
})

describe('harnessRuntimeCacheKey', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-key-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('changes when the binary is replaced in place', () => {
    const bin = join(dir, 'claude')
    writeFileSync(bin, 'v1')
    utimesSync(bin, 1_000, 1_000)
    const before = harnessRuntimeCacheKey(bin)
    writeFileSync(bin, 'v2-longer')
    utimesSync(bin, 2_000, 2_000)
    expect(before).not.toBeNull()
    expect(harnessRuntimeCacheKey(bin)).not.toBe(before)
  })

  it('is null for a missing binary', () => {
    expect(harnessRuntimeCacheKey(join(dir, 'missing'))).toBeNull()
  })
})

describe('connectWithHarnessResourceCache', () => {
  beforeEach(() => {
    getCachedHarnessResources.mockReset()
    getHarnessResourceCacheMeta.mockReset()
    setCachedHarnessResources.mockReset()
  })

  it('skips probe on fresh cache', async () => {
    const resources = { models: [{ id: 'cached' }] }
    getCachedHarnessResources.mockReturnValue(resources)
    getHarnessResourceCacheMeta.mockReturnValue({ ageMs: 1_000, cacheKey: null })
    const probe = vi.fn()
    await expect(connectWithHarnessResourceCache('cursor', {
      probe,
      isUsable: (r) => (r.models?.length ?? 0) > 0,
    })).resolves.toEqual(resources)
    expect(probe).not.toHaveBeenCalled()
  })

  it('probes, writes cache, and returns fresh resources', async () => {
    getCachedHarnessResources.mockReturnValue(null)
    getHarnessResourceCacheMeta.mockReturnValue(null)
    const fresh = { models: [{ id: 'new' }] }
    const probe = vi.fn().mockResolvedValue(fresh)
    await expect(connectWithHarnessResourceCache('cursor', { probe })).resolves.toEqual(fresh)
    expect(setCachedHarnessResources).toHaveBeenCalledWith('cursor', fresh, null)
  })

  it('records the runtime key with the probe result', async () => {
    getCachedHarnessResources.mockReturnValue(null)
    getHarnessResourceCacheMeta.mockReturnValue(null)
    const fresh = { models: [{ id: 'new' }], prompts: [] }
    await expect(connectWithHarnessResourceCache('codex', {
      cacheKey: 'runtime',
      probe: vi.fn().mockResolvedValue(fresh),
    })).resolves.toEqual(fresh)
    expect(setCachedHarnessResources).toHaveBeenCalledWith('codex', fresh, 'runtime')
  })

  it('falls back to stale cache when probe fails', async () => {
    const stale = { models: [{ id: 'stale' }] }
    getCachedHarnessResources
      .mockReturnValueOnce(null) // freshness check
      .mockReturnValueOnce(stale) // fallback read
    getHarnessResourceCacheMeta.mockReturnValue(null)
    const probe = vi.fn().mockRejectedValue(new Error('network'))
    await expect(connectWithHarnessResourceCache('cursor', {
      probe,
      fallbackToCacheOnError: true,
    })).resolves.toEqual(stale)
  })
})
