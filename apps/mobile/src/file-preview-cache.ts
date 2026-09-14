import { completeTransfer, type FilePreviewState } from './file-preview-state'

/** Silent ceiling for preview files and opened-session transcripts on one connection. */
export const CONNECTION_CACHE_MAX_BYTES = 512 * 1024 * 1024
/** @deprecated Use CONNECTION_CACHE_MAX_BYTES. */
export const FILE_PREVIEW_CACHE_MAX_BYTES = CONNECTION_CACHE_MAX_BYTES

export type FilePreviewCacheIdentity = {
  pairingId: string
  path: string
  size: number
  modifiedAt: number
}

export type FilePreviewCacheEntry = {
  pairingId: string
  key: string
  size: number
  lastAccess: number
  /** On-disk file name; omitted for in-memory session blobs. */
  fileName?: string
  blob?: boolean
  path?: string
  modifiedAt?: number
}

export type FilePreviewCacheDisk = {
  list?(pairingId: string): string[]
  read?(pairingId: string, fileName: string): Uint8Array | null
  write(pairingId: string, fileName: string, bytes: Uint8Array): string
  exists(pairingId: string, fileName: string): boolean
  uri(pairingId: string, fileName: string): string
  remove(pairingId: string, fileName: string): void
  wipePairing(pairingId: string): void
}

export function previewCacheKey(identity: FilePreviewCacheIdentity): string {
  return `${identity.path}\0${identity.size}\0${identity.modifiedAt}`
}

/** Directory-safe and collision-free: stripping punctuation would map `a.b` and `ab` together. */
export function safePairingSegment(pairingId: string): string {
  const readable = pairingId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
  return `${readable || 'p'}-${previewCacheFingerprint(pairingId)}`
}

/** 16 hex chars; enough to name a few hundred preview files without colliding. */
export function previewCacheFingerprint(input: string): string {
  let fnv = 2166136261
  let djb = 5381
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    fnv ^= code
    fnv = Math.imul(fnv, 16777619)
    djb = Math.imul(djb, 33) ^ code
  }
  return (fnv >>> 0).toString(16).padStart(8, '0') + (djb >>> 0).toString(16).padStart(8, '0')
}

export function cachedPreviewFileName(identity: FilePreviewCacheIdentity, originalName: string): string {
  const basename = originalName.split(/[\\/]/).pop() ?? ''
  const cleaned = basename
    .replace(/[\u0000-\u001f\u007f:]/g, '_')
    .replace(/^\.+$/, '')
    .slice(-80)
  return `${previewCacheFingerprint(previewCacheKey(identity))}-${cleaned || 'file'}`
}

/** Oldest-first entries to delete so `incomingSize` fits under `maxBytes`. */
export function planPreviewCacheEviction(
  entries: readonly FilePreviewCacheEntry[],
  incomingSize: number,
  maxBytes: number,
): FilePreviewCacheEntry[] {
  const total = entries.reduce((sum, entry) => sum + entry.size, 0)
  let extra = total + incomingSize - maxBytes
  if (extra <= 0) return []
  const oldestFirst = [...entries].sort((a, b) => a.lastAccess - b.lastAccess || a.key.localeCompare(b.key))
  const drop: FilePreviewCacheEntry[] = []
  for (const entry of oldestFirst) {
    if (extra <= 0) break
    drop.push(entry)
    extra -= entry.size
  }
  return drop
}

export class FilePreviewCache {
  private entries: FilePreviewCacheEntry[] = []
  private seen = new Set<string>()
  private blobs = new Map<string, Uint8Array>()
  private serial = 0

  constructor(
    private readonly disk: FilePreviewCacheDisk,
    private readonly maxBytes = CONNECTION_CACHE_MAX_BYTES,
    private readonly now: () => number = Date.now,
  ) {}

  lookup(identity: FilePreviewCacheIdentity): { uri: string } | null {
    this.prime(identity.pairingId)
    const key = previewCacheKey(identity)
    const found = this.entries.find((entry) => entry.pairingId === identity.pairingId && entry.key === key && entry.fileName)
    if (!found?.fileName) return null
    if (!this.disk.exists(identity.pairingId, found.fileName)) {
      this.entries = this.entries.filter((entry) => entry !== found)
      return null
    }
    found.lastAccess = this.now()
    return { uri: this.disk.uri(identity.pairingId, found.fileName) }
  }

  put(identity: FilePreviewCacheIdentity, originalName: string, bytes: Uint8Array): string {
    const size = bytes.byteLength
    const stored = { ...identity, size }
    const key = previewCacheKey(stored)
    const fileName = cachedPreviewFileName(stored, originalName)
    if (size <= this.maxBytes) this.reserve(identity.pairingId, key, size)
    else this.prime(identity.pairingId)
    const uri = this.disk.write(identity.pairingId, fileName, bytes)
    if (size > this.maxBytes) return uri
    this.entries.push({
      pairingId: identity.pairingId,
      key,
      size,
      lastAccess: this.now(),
      fileName,
      path: identity.path,
      modifiedAt: identity.modifiedAt,
    })
    this.persistIndex(identity.pairingId)
    return uri
  }

  putBlob(pairingId: string, key: string, bytes: Uint8Array): void {
    if (bytes.byteLength > this.maxBytes) return
    this.reserve(pairingId, key, bytes.byteLength)
    const fileName = this.disk.read ? `blob-${previewCacheFingerprint(key)}-${this.now()}-${++this.serial}` : undefined
    if (fileName) this.disk.write(pairingId, fileName, bytes)
    else this.blobs.set(blobId(pairingId, key), bytes)
    this.entries.push({ pairingId, key, size: bytes.byteLength, lastAccess: this.now(), ...(fileName ? { fileName, blob: true } : {}) })
    this.persistIndex(pairingId)
  }

  lookupBlob(pairingId: string, key: string): Uint8Array | null {
    this.prime(pairingId)
    const found = this.entries.find(entry => entry.pairingId === pairingId && entry.key === key && (!entry.fileName || entry.blob))
    if (!found) return null
    let bytes: Uint8Array | null = null
    try { bytes = found.fileName ? this.disk.read?.(pairingId, found.fileName) ?? null : this.blobs.get(blobId(pairingId, key)) ?? null }
    catch { /* reclaimed or corrupt cache file */ }
    if (!bytes || bytes.byteLength !== found.size) {
      this.drop([found])
      return null
    }
    found.lastAccess = this.now()
    return bytes
  }

  clearPairing(pairingId: string): void {
    this.entries = this.entries.filter((entry) => entry.pairingId !== pairingId)
    this.seen.delete(pairingId)
    for (const id of [...this.blobs.keys()]) {
      if (id.startsWith(`${pairingId}\0`)) this.blobs.delete(id)
    }
    this.disk.wipePairing(pairingId)
  }

  reset(): void {
    const pairingIds = new Set(this.entries.map((entry) => entry.pairingId))
    for (const id of this.seen) pairingIds.add(id)
    this.entries = []
    this.seen.clear()
    this.blobs.clear()
    for (const id of pairingIds) this.disk.wipePairing(id)
  }

  /** Versioned manifest; absent or corrupt state is a cache miss. */
  private prime(pairingId: string): void {
    if (this.seen.has(pairingId)) return
    this.seen.add(pairingId)
    try {
      const raw = this.disk.read?.(pairingId, 'index-v1.json')
      if (!raw || raw.length > 2 * 1024 * 1024) throw new Error('missing cache index')
      const index = JSON.parse(new TextDecoder().decode(raw)) as { version: number; entries: FilePreviewCacheEntry[] }
      if (index.version !== 1 || !Array.isArray(index.entries) || index.entries.length > 1024) throw new Error('obsolete cache index')
      const valid = index.entries.filter(entry => entry && entry.pairingId === pairingId
        && typeof entry.key === 'string' && typeof entry.fileName === 'string'
        && !/[\\/]/.test(entry.fileName) && entry.fileName !== '..'
        && Number.isFinite(entry.size) && entry.size >= 0 && entry.size <= this.maxBytes
        && Number.isFinite(entry.lastAccess) && this.disk.exists(pairingId, entry.fileName))
      this.entries.push(...valid)
      this.drop(planPreviewCacheEviction(this.entries, 0, this.maxBytes))
      const retained = new Set(this.entries.filter(entry => entry.pairingId === pairingId).map(entry => entry.fileName))
      for (const name of this.disk.list?.(pairingId) ?? []) {
        if (name !== 'index-v1.json' && !retained.has(name)) this.disk.remove(pairingId, name)
      }
    } catch { this.disk.wipePairing(pairingId) }
  }

  private persistIndex(pairingId: string): void {
    if (!this.disk.read) return
    try {
      const entries = this.entries.filter(entry => entry.pairingId === pairingId && entry.fileName).sort((a, b) => a.lastAccess - b.lastAccess)
      const encode = () => new TextEncoder().encode(JSON.stringify({ version: 1, entries }))
      let bytes = encode()
      while (entries.length && (entries.length > 1024 || bytes.length > 2 * 1024 * 1024)) {
        const dropped = entries.shift()!
        this.entries = this.entries.filter(entry => entry !== dropped)
        this.disk.remove(pairingId, dropped.fileName!)
        bytes = encode()
      }
      this.disk.write(pairingId, 'index-v1.json', bytes)
    } catch { /* a cache write cannot fail the user's operation */ }
  }

  private reserve(pairingId: string, key: string, incomingSize: number): void {
    this.prime(pairingId)
    const replaced = this.entries.find((entry) => entry.pairingId === pairingId && entry.key === key)
    if (replaced) this.drop([replaced])
    const drop = planPreviewCacheEviction(this.entries, incomingSize, this.maxBytes)
    this.drop(drop)
  }

  private drop(entries: readonly FilePreviewCacheEntry[]): void {
    if (entries.length === 0) return
    const dropping = new Set(entries)
    for (const entry of entries) {
      if (entry.fileName) this.disk.remove(entry.pairingId, entry.fileName)
      else this.blobs.delete(blobId(entry.pairingId, entry.key))
    }
    this.entries = this.entries.filter((entry) => !dropping.has(entry))
    for (const pairingId of new Set(entries.map(entry => entry.pairingId))) this.persistIndex(pairingId)
  }
}

function blobId(pairingId: string, key: string): string {
  return `${pairingId}\0${key}`
}

export function previewBlobKey(path: string, size: number, modifiedAt: number): string {
  return `preview\0${path}\0${size}\0${modifiedAt}`
}

type CachedPreviewPayload =
  | { kind: 'text'; text: string; markdown: boolean; name: string }
  | { kind: 'image-data'; dataUri: string; mimeType: string; name: string }

export function hydratePreviewFromCache(
  loading: { path: string; name: string; line?: number },
  meta: { size: number; modifiedAt: number; mimeType: string },
  pairingId: string | null,
  cache: Pick<FilePreviewCache, 'lookup' | 'lookupBlob'>,
): FilePreviewState | null {
  if (!pairingId) return null
  const blob = cache.lookupBlob(pairingId, previewBlobKey(loading.path, meta.size, meta.modifiedAt))
  if (blob) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(blob)) as CachedPreviewPayload
      if (parsed.kind === 'text') {
        return {
          kind: 'text',
          path: loading.path,
          name: parsed.name,
          text: parsed.text,
          size: meta.size,
          markdown: parsed.markdown,
          ...(loading.line != null ? { line: loading.line } : {}),
        }
      }
      if (parsed.kind === 'image-data') {
        return { kind: 'image', path: loading.path, name: parsed.name, src: parsed.dataUri, mimeType: parsed.mimeType }
      }
    } catch {
      return null
    }
  }
  const file = cache.lookup({ pairingId, path: loading.path, size: meta.size, modifiedAt: meta.modifiedAt })
  if (!file) return null
  return completeTransfer({
    kind: 'transfer',
    path: loading.path,
    name: loading.name,
    size: meta.size,
    mimeType: meta.mimeType,
    needsConfirm: false,
    phase: 'idle',
    modifiedAt: meta.modifiedAt,
  }, file.uri)
}

export function hydrateTransferFromCache(
  state: FilePreviewState,
  pairingId: string | null,
  cache: Pick<FilePreviewCache, 'lookup'>,
): FilePreviewState {
  if (!pairingId || state.kind !== 'transfer' || state.phase !== 'idle') return state
  const hit = cache.lookup({
    pairingId,
    path: state.path,
    size: state.size,
    modifiedAt: state.modifiedAt ?? 0,
  })
  return hit ? completeTransfer(state, hit.uri) : state
}

export function persistPreviewToCache(
  state: FilePreviewState,
  pairingId: string | null,
  meta: { size: number; modifiedAt: number },
  cache: Pick<FilePreviewCache, 'putBlob'>,
): void {
  if (!pairingId) return
  if (state.kind === 'text' && state.path) {
    cache.putBlob(pairingId, previewBlobKey(state.path, meta.size, meta.modifiedAt), new TextEncoder().encode(JSON.stringify({
      kind: 'text', text: state.text, markdown: state.markdown, name: state.name,
    } satisfies CachedPreviewPayload)))
    return
  }
  if (state.kind === 'image' && state.path && state.src.startsWith('data:')) {
    cache.putBlob(pairingId, previewBlobKey(state.path, meta.size, meta.modifiedAt), new TextEncoder().encode(JSON.stringify({
      kind: 'image-data', dataUri: state.src, mimeType: state.mimeType, name: state.name,
    } satisfies CachedPreviewPayload)))
  }
}
