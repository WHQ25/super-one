import { describe, expect, it } from 'vitest'
import type { StorageInventory } from '@superone/shared/desktop-storage'
import {
  optimizePlan,
  reclaimableBytes,
  sectionDisplayedOptimizable,
  sectionOptimizableBytes,
  STORAGE_SECTIONS,
  storageTotalBytes,
} from './storage-optimize'

const MB = 1024 * 1024

function inventory(patch: Partial<StorageInventory> = {}): StorageInventory {
  return {
    nodeEvents: { rows: 4, retentionFloor: '0', lastCompactAt: null, lastFreedBytes: null },
    categories: [
      { id: 'chat-database', bytes: 11 * MB, actions: ['reveal'] },
      { id: 'backup', bytes: 5 * MB, unusedBytes: 0, actions: ['reveal', 'delete-backups'] },
      { id: 'recovery-leftovers', bytes: 2 * MB, actions: ['reveal', 'delete-leftovers'] },
      { id: 'browser-http-cache', bytes: 3 * MB, actions: ['clear-browser-http-cache'] },
      { id: 'browser-code-cache', bytes: 1 * MB, actions: ['clear-browser-code-cache'] },
      { id: 'browser-site-data', bytes: 8 * MB, actions: ['clear-browser-site-data'] },
      { id: 'node-event-log', bytes: 9 * MB, actions: ['compact-node-events'] },
      { id: 'sync-attachments', bytes: 4 * MB, actions: ['clear-sync-attachments'] },
      { id: 'sync-media', bytes: 1 * MB, actions: ['clear-sync-media'] },
      { id: 'app-cache', bytes: 2 * MB, actions: ['clear-app-cache'] },
      { id: 'harness-runtimes', bytes: 7 * MB, unusedBytes: 1 * MB, actions: ['clear-unused-harness-runtimes'] },
      { id: 'logs', bytes: 1 * MB, actions: ['clear-logs'] },
    ],
    ...patch,
  }
}

describe('storage optimize plan', () => {
  it('frees caches, chat backups, recovery files, and unused runtimes, then compacts', () => {
    const disk = inventory()
    expect(optimizePlan(disk)).toEqual([
      'clear-browser-http-cache',
      'clear-browser-code-cache',
      'clear-app-cache',
      'delete-backups',
      'delete-leftovers',
      'clear-unused-harness-runtimes',
      'compact-node-events',
    ])
    expect(reclaimableBytes(disk)).toBe(14 * MB)
    expect(STORAGE_SECTIONS.reduce((sum, section) => sum + sectionOptimizableBytes(disk, section.id), 0)).toBe(14 * MB)
    expect(STORAGE_SECTIONS.reduce((sum, section) => sum + sectionDisplayedOptimizable(disk, section.id), 0)).toBe(14 * MB)
    expect(storageTotalBytes(disk)).toBe(54 * MB)
  })

  it('leaves chat, site data, sync files, and logs out of the plan', () => {
    const plan = optimizePlan(inventory())
    expect(plan).toContain('delete-backups')
    expect(plan).not.toContain('trim-extra-backups')
    expect(plan).not.toContain('clear-browser-site-data')
    expect(plan).not.toContain('clear-sync-attachments')
    expect(plan).not.toContain('clear-sync-media')
    expect(plan).not.toContain('clear-logs')
  })

  it('skips an empty category and still compacts a log that has rows', () => {
    const disk = inventory()
    disk.categories = disk.categories.map((category) => (
      category.id === 'browser-http-cache'
      || category.id === 'backup'
      || category.id === 'recovery-leftovers'
      || category.id === 'harness-runtimes'
        ? { ...category, bytes: 0, unusedBytes: 0 }
        : category
    ))
    expect(optimizePlan(disk)).toEqual([
      'clear-browser-code-cache',
      'clear-app-cache',
      'compact-node-events',
    ])
  })

  it('leaves a live GPU cache out of the reclaimable total', () => {
    const disk = inventory()
    disk.categories = disk.categories.map((category) => (
      category.id === 'app-cache' ? { ...category, bytes: 5 * MB, unusedBytes: 2 * MB } : category
    ))
    expect(optimizePlan(disk)).toContain('clear-app-cache')
    expect(reclaimableBytes(disk)).toBe(14 * MB)
    disk.categories = disk.categories.map((category) => (
      category.id === 'app-cache' ? { ...category, unusedBytes: 0 } : category
    ))
    expect(optimizePlan(disk)).not.toContain('clear-app-cache')
  })

  it('keeps summary reclaimable bytes aligned with section headers including harness-home downloads', () => {
    const disk = inventory({
      harnessRuntimes: [
        { id: 'claude', bytes: 5 * MB, unusedBytes: 2 * MB, path: '/h/claude' },
      ],
    })
    disk.categories = disk.categories.map((category) => (
      category.id === 'harness-runtimes' ? { ...category, bytes: 6 * MB, unusedBytes: 3 * MB } : category
    ))
    expect(sectionDisplayedOptimizable(disk, 'runtimes')).toBe(3 * MB)
    expect(reclaimableBytes(disk)).toBe(
      STORAGE_SECTIONS.reduce((sum, section) => sum + sectionDisplayedOptimizable(disk, section.id), 0),
    )
  })

  it('offers nothing when every automatic target is empty', () => {
    const disk = inventory({
      nodeEvents: { rows: 0, retentionFloor: '0', lastCompactAt: null, lastFreedBytes: null },
    })
    disk.categories = disk.categories.map((category) => ({ ...category, bytes: 0, unusedBytes: 0 }))
    expect(optimizePlan(disk)).toEqual([])
    expect(reclaimableBytes(disk)).toBe(0)
  })
})
