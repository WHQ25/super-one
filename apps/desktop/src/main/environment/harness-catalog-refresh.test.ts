import { describe, expect, it } from 'vitest'
import {
  harnessAdvertisementChanged,
  harnessAdvertisementKey,
  harnessIdsFromCatalogEvent,
} from './harness-catalog-refresh'

describe('harness advertisement refresh', () => {
  it('treats the same ids as unchanged regardless of order', () => {
    expect(harnessAdvertisementKey(['acp', 'claude'])).toBe(harnessAdvertisementKey(['claude', 'acp']))
    expect(harnessAdvertisementChanged(undefined, harnessAdvertisementKey(['claude']))).toBe(false)
    const previous = harnessAdvertisementKey(['claude'])
    expect(harnessAdvertisementChanged(previous, harnessAdvertisementKey(['claude']))).toBe(false)
    expect(harnessAdvertisementChanged(previous, harnessAdvertisementKey(['claude', 'acp']))).toBe(true)
  })

  it('reads harness ids only from a catalog event payload', () => {
    expect(harnessIdsFromCatalogEvent({ harnessIds: ['acp', 'claude'] })).toEqual(['acp', 'claude'])
    expect(harnessIdsFromCatalogEvent({ harnessIds: ['acp', 'not-a-harness'] })).toEqual(['acp'])
    expect(harnessIdsFromCatalogEvent({ harnessIds: [] })).toEqual([])
    expect(harnessIdsFromCatalogEvent({ harnessIds: ['acp', 1] })).toBeNull()
    expect(harnessIdsFromCatalogEvent(null)).toBeNull()
    expect(harnessIdsFromCatalogEvent({ ids: ['acp'] })).toBeNull()
  })
})
