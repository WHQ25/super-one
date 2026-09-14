import { describe, expect, it } from 'vitest'
import {
  FilePreviewCache,
  cachedPreviewFileName,
  hydratePreviewFromCache,
  hydrateTransferFromCache,
  persistPreviewToCache,
  planPreviewCacheEviction,
  previewCacheFingerprint,
  previewCacheKey,
  safePairingSegment,
  type FilePreviewCacheDisk,
  type FilePreviewCacheEntry,
  type FilePreviewCacheIdentity,
} from './file-preview-cache'
import type { FilePreviewState } from './file-preview-state'

function identity(over: Partial<FilePreviewCacheIdentity> = {}): FilePreviewCacheIdentity {
  return { pairingId: 'desk-1', path: '/proj/art/hero.png', size: 100, modifiedAt: 10, ...over }
}

function memoryDisk(): FilePreviewCacheDisk & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  const id = (pairingId: string, fileName: string) => `${pairingId}/${fileName}`
  return {
    files,
    read(pairingId, fileName) { return files.get(id(pairingId, fileName)) ?? null },
    write(pairingId, fileName, bytes) {
      files.set(id(pairingId, fileName), bytes)
      return `file:///cache/${id(pairingId, fileName)}`
    },
    exists(pairingId, fileName) { return files.has(id(pairingId, fileName)) },
    uri(pairingId, fileName) { return `file:///cache/${id(pairingId, fileName)}` },
    remove(pairingId, fileName) { files.delete(id(pairingId, fileName)) },
    wipePairing(pairingId) {
      for (const key of [...files.keys()]) {
        if (key.startsWith(`${pairingId}/`)) files.delete(key)
      }
    },
  }
}

const transfer = (over: Partial<Extract<FilePreviewState, { kind: 'transfer' }>> = {}): Extract<FilePreviewState, { kind: 'transfer' }> => ({
  kind: 'transfer',
  path: '/proj/art/hero.png',
  name: 'hero.png',
  size: 100,
  mimeType: 'image/png',
  needsConfirm: true,
  phase: 'idle',
  modifiedAt: 10,
  ...over,
})

describe('preview cache identity', () => {
  it('restores cached files and transcripts after restart, and Forget removes both', () => {
    const disk = memoryDisk()
    const first = new FilePreviewCache(disk)
    first.put(identity(), 'hero.png', new Uint8Array(100))
    first.putBlob('desk-1', 'session\0/p\0s', new Uint8Array([1, 2, 3]))
    const restarted = new FilePreviewCache(disk)
    expect(restarted.lookup(identity())).not.toBeNull()
    expect(restarted.lookupBlob('desk-1', 'session\0/p\0s')).toEqual(new Uint8Array([1, 2, 3]))
    restarted.clearPairing('desk-1')
    expect(new FilePreviewCache(disk).lookup(identity())).toBeNull()
    expect(disk.files.size).toBe(0)
  })
  it('treats a changed mtime as a different object', () => {
    expect(previewCacheKey(identity())).not.toBe(previewCacheKey(identity({ modifiedAt: 11 })))
    expect(previewCacheFingerprint('a')).toHaveLength(16)
    expect(cachedPreviewFileName(identity(), 'hero.png')).toMatch(/^[0-9a-f]{16}-hero\.png$/)
  })

  it('does not collapse distinct pairing ids into one directory', () => {
    expect(safePairingSegment('a.b')).not.toBe(safePairingSegment('ab'))
    expect(safePairingSegment('主机A')).not.toBe(safePairingSegment('主机B'))
    expect(safePairingSegment('主机')).toMatch(/^p-[0-9a-f]{16}$/)
  })
})

describe('preview cache eviction', () => {
  const entry = (over: Partial<FilePreviewCacheEntry>): FilePreviewCacheEntry => ({
    ...identity(),
    key: 'k',
    fileName: 'f',
    lastAccess: 1,
    ...over,
  })

  it('drops the least recently used files until the new one fits', () => {
    const drop = planPreviewCacheEviction([
      entry({ key: 'old', path: '/old', size: 40, lastAccess: 1 }),
      entry({ key: 'mid', path: '/mid', size: 40, lastAccess: 2 }),
      entry({ key: 'new', path: '/new', size: 40, lastAccess: 3 }),
    ], 50, 100)
    expect(drop.map((item) => item.key)).toEqual(['old', 'mid'])
  })

  it('keeps everything when there is room', () => {
    expect(planPreviewCacheEviction([entry({ size: 10, lastAccess: 1 })], 10, 100)).toEqual([])
  })
})

describe('FilePreviewCache', () => {
  it('returns a hit only for the same pairing, path, size and mtime', () => {
    const disk = memoryDisk()
    let now = 1
    const cache = new FilePreviewCache(disk, 1_000, () => now)
    const bytes = new Uint8Array(100)
    const uri = cache.put(identity(), 'hero.png', bytes)
    now = 2
    expect(cache.lookup(identity())).toEqual({ uri })
    expect(cache.lookup(identity({ modifiedAt: 99 }))).toBeNull()
    expect(cache.lookup(identity({ pairingId: 'desk-2' }))).toBeNull()
  })

  it('evicts the oldest file when the pairing is over budget', () => {
    const disk = memoryDisk()
    let now = 1
    const cache = new FilePreviewCache(disk, 150, () => now)
    cache.put(identity({ path: '/a', size: 80 }), 'a.bin', new Uint8Array(80))
    now = 2
    cache.put(identity({ path: '/b', size: 80 }), 'b.bin', new Uint8Array(80))
    expect(cache.lookup(identity({ path: '/a', size: 80 }))).toBeNull()
    expect(cache.lookup(identity({ path: '/b', size: 80 }))).not.toBeNull()
    expect([...disk.files.keys()].some((key) => key.endsWith('-a.bin'))).toBe(false)
  })

  it('wipes one pairing without touching another', () => {
    const disk = memoryDisk()
    const cache = new FilePreviewCache(disk, 1_000, () => 1)
    cache.put(identity(), 'hero.png', new Uint8Array(100))
    cache.put(identity({ pairingId: 'desk-2', path: '/other', size: 2 }), 'other.bin', new Uint8Array(2))
    cache.clearPairing('desk-1')
    expect(cache.lookup(identity())).toBeNull()
    expect(cache.lookup(identity({ pairingId: 'desk-2', path: '/other', size: 2 }))).not.toBeNull()
  })

  it('treats a missing file on disk as a miss', () => {
    const disk = memoryDisk()
    const cache = new FilePreviewCache(disk, 1_000, () => 1)
    cache.put(identity(), 'hero.png', new Uint8Array(100))
    disk.files.clear()
    expect(cache.lookup(identity())).toBeNull()
  })

  it('shares the LRU budget between files and session blobs', () => {
    const disk = memoryDisk()
    let now = 1
    const cache = new FilePreviewCache(disk, 150, () => now)
    cache.putBlob('desk-1', 'session\0/p\0s', new Uint8Array(80))
    now = 2
    cache.put(identity({ size: 80 }), 'hero.png', new Uint8Array(80))
    expect(cache.lookupBlob('desk-1', 'session\0/p\0s')).toBeNull()
    expect(cache.lookup(identity({ size: 80 }))).not.toBeNull()
  })

  it('returns a session blob until the pairing is cleared', () => {
    const disk = memoryDisk()
    const cache = new FilePreviewCache(disk, 1_000, () => 1)
    const payload = new TextEncoder().encode('{"messages":[]}')
    cache.putBlob('desk-1', 'session\0/p\0s', payload)
    expect(cache.lookupBlob('desk-1', 'session\0/p\0s')).toEqual(payload)
    cache.clearPairing('desk-1')
    expect(cache.lookupBlob('desk-1', 'session\0/p\0s')).toBeNull()
  })

  it('refuses to keep a blob larger than the cap', () => {
    const disk = memoryDisk()
    const cache = new FilePreviewCache(disk, 100, () => 1)
    cache.putBlob('desk-1', 'session\0/p\0s', new Uint8Array(101))
    expect(cache.lookupBlob('desk-1', 'session\0/p\0s')).toBeNull()
  })

  it('accounts for the written byte length, not the caller-supplied size', () => {
    const disk = memoryDisk()
    const cache = new FilePreviewCache(disk, 100, () => 1)
    cache.put(identity({ size: 10 }), 'hero.png', new Uint8Array(80))
    cache.put(identity({ path: '/b', size: 10 }), 'b.bin', new Uint8Array(80))
    expect(cache.lookup(identity({ size: 80 }))).toBeNull()
    expect(cache.lookup({ pairingId: 'desk-1', path: '/proj/art/hero.png', size: 80, modifiedAt: 10 })).toBeNull()
    expect(cache.lookup({ pairingId: 'desk-1', path: '/b', size: 80, modifiedAt: 10 })).not.toBeNull()
  })
})

describe('hydrateTransferFromCache', () => {
  it('turns a cached picture into the image body and leaves a miss idle', () => {
    const disk = memoryDisk()
    const cache = new FilePreviewCache(disk, 1_000, () => 1)
    cache.put(identity(), 'hero.png', new Uint8Array(100))
    expect(hydrateTransferFromCache(transfer(), 'desk-1', cache)).toMatchObject({
      kind: 'image', src: expect.stringContaining('hero.png'),
    })
    expect(hydrateTransferFromCache(transfer(), 'desk-2', cache)).toMatchObject({ kind: 'transfer', phase: 'idle' })
    expect(hydrateTransferFromCache(transfer({ mimeType: 'application/pdf' }), 'desk-1', cache)).toMatchObject({
      kind: 'transfer', phase: 'ready',
    })
  })
})

describe('inline preview blobs', () => {
  it('reopens cached text without another inline payload', () => {
    const disk = memoryDisk()
    const cache = new FilePreviewCache(disk, 1_000, () => 1)
    persistPreviewToCache(
      { kind: 'text', path: '/p/a.ts', name: 'a.ts', text: 'const a = 1', size: 11, markdown: false },
      'desk-1',
      { size: 11, modifiedAt: 9 },
      cache,
    )
    expect(hydratePreviewFromCache(
      { path: '/p/a.ts', name: 'a.ts', line: 2 },
      { size: 11, modifiedAt: 9, mimeType: 'text/plain' },
      'desk-1',
      cache,
    )).toMatchObject({ kind: 'text', text: 'const a = 1', line: 2 })
  })
})
