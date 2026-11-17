import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { jsonObjectRecord } from '@superone/shared/json-object-string'
import { contentDigest } from '@superone/shared/transcript-window/content-digest'
import { toolBodyText, toolBodyType, withToolBody, TOOL_CHUNK_CHARS, type ToolBodyAddress, type ToolBodyBlock, type ToolBodyRef, type ToolChunkRequest } from '@superone/shared/transcript-window/tool-body'

/** Keep a bounded set across restarts. A disabled or full IndexedDB still permits in-memory use. */
const MAX_STORED_BODIES = 64
const MAX_DISK_CHARS = 16 * 1024 * 1024
const MAX_MEMORY_CHARS = 4 * 1024 * 1024
let database: Promise<IDBDatabase> | undefined
function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('superone-remote-widget-bodies', 2)
    let blocked = false
    request.onblocked = () => {
      blocked = true
      reject(new Error('Tool body storage is open in an older window'))
    }
    request.onupgradeneeded = event => {
      const store = event.oldVersion === 0
        ? request.result.createObjectStore('bodies', { keyPath: 'key' })
        : request.transaction!.objectStore('bodies')
      store.createIndex('byAgeAndSize', ['written', 'chars'])
      if (event.oldVersion === 1) {
        // Carry forward widget bodies written before the cache had a total size budget.
        const scan = store.openCursor()
        scan.onsuccess = () => {
          const row = scan.result
          if (!row) return
          row.update({ ...row.value, chars: row.value.text.length })
          row.continue()
        }
      }
    }
    request.onsuccess = () => {
      const db = request.result
      if (blocked) { db.close(); return }
      db.onversionchange = () => { db.close(); database = undefined }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  }).catch(error => { database = undefined; throw error })
}

interface ToolBodyStorage {
  read(key: string): Promise<string | undefined>
  write(key: string, text: string): Promise<void>
}

const disk: ToolBodyStorage = {
  async read(key) {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const request = db.transaction('bodies').objectStore('bodies').get(key)
      request.onsuccess = () => resolve(request.result?.text)
      request.onerror = () => reject(request.error)
    })
  },
  async write(key, text) {
    if (text.length > MAX_DISK_CHARS) return
    const db = await openDatabase()
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('bodies', 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      const store = tx.objectStore('bodies')
      store.put({ key, text, written: Date.now(), chars: text.length })
      // Index keys carry the sizes, so eviction never reads old body strings.
      const scan = store.index('byAgeAndSize').openKeyCursor(null, 'prev')
      let count = 0
      let chars = 0
      scan.onsuccess = () => {
        const row = scan.result
        if (!row) return
        const [, size] = row.key as [number, number]
        chars += size
        if (++count > MAX_STORED_BODIES || chars > MAX_DISK_CHARS) store.delete(row.primaryKey)
        row.continue()
      }
    })
  },
}

type Address = Omit<ToolChunkRequest, 'offset'>
type ReadChunk = (connectionId: string, request: ToolChunkRequest) => Promise<string>

function cacheKey(connectionId: string, a: Address): string {
  return JSON.stringify([connectionId, a.sessionId, a.messageId, a.toolUseId, a.type, a.digest])
}

export function windowToolBody(block: ContentBlock): ToolBodyRef | undefined {
  if (block.type === 'notice') return block.toolBody
  if (block.type === 'tool_result' && block.remoteBody) {
    const { remoteBody, ...head } = block
    return { head, ...remoteBody }
  }
  return undefined
}

function liveCallKey(connectionId: string, sessionId: string, messageId: string, block: ToolBodyBlock): string {
  return JSON.stringify([connectionId, sessionId, messageId, block.toolUseId, toolBodyType(block)])
}

export class ToolBodyCache {
  private readonly memory = new Map<string, string>()
  private chars = 0
  private readonly pending = new Map<string, Promise<string>>()

  // IPC dispatches a batch synchronously. Keep the raw blocks until dispatch finishes,
  // even if their size exceeds the longer-lived cache budget or IndexedDB is disabled.
  private readonly batch = new Map<string, ToolBodyBlock[]>()

  constructor(private readonly readChunk: ReadChunk, private readonly storage: ToolBodyStorage = disk) {}

  private retain(key: string, text: string): void {
    if (this.memory.has(key) || text.length > MAX_MEMORY_CHARS) return
    this.memory.set(key, text)
    this.chars += text.length
    while (this.chars > MAX_MEMORY_CHARS || this.memory.size > MAX_STORED_BODIES) {
      const [oldest, body] = this.memory.entries().next().value!
      this.memory.delete(oldest)
      this.chars -= body.length
    }
  }

  remember(connectionId: string, address: Address, text: string): void {
    const key = cacheKey(connectionId, address)
    if (this.memory.has(key)) return
    this.retain(key, text)
    void this.storage.write(key, text).catch(() => {})
  }

  rememberBlock(connectionId: string, sessionId: string, messageId: string, block: ToolBodyBlock): void {
    if (block.type === 'tool_result' && block.remoteBody) return
    const text = toolBodyText(block)
    // Short text alone fits in a fragment, and unfinished JSON is still streaming.
    if (typeof text !== 'string' || text.length < 4096 || ('input' in block && block.status !== 'complete' && !jsonObjectRecord(text))) return
    this.remember(connectionId, { sessionId, messageId, toolUseId: block.toolUseId, type: toolBodyType(block), digest: contentDigest(text) }, text)
  }

  receiveBlock(connectionId: string, sessionId: string, messageId: string, block: ToolBodyBlock): void {
    if (!this.batch.size) queueMicrotask(() => this.batch.clear())
    const key = liveCallKey(connectionId, sessionId, messageId, block)
    const versions = this.batch.get(key)
    if (versions) versions.push(block)
    else this.batch.set(key, [block])
    this.rememberBlock(connectionId, sessionId, messageId, block)
  }

  /** Join a window reference to an earlier event before React can batch away the full row. */
  reuseReceived(connectionId: string, sessionId: string, row: ChatMessage): ChatMessage {
    if (!this.batch.size) return row
    let content = row.content
    for (const [index, block] of row.content.entries()) {
      const ref = windowToolBody(block)
      if (!ref) continue
      const versions = this.batch.get(liveCallKey(connectionId, sessionId, row.id, ref.head))
      if (!versions) continue
      for (const incoming of versions) {
        const text = ref.wholeBlock ? JSON.stringify(incoming) : toolBodyText(incoming)
        if (typeof text !== 'string' || text.length !== ref.length || contentDigest(text) !== ref.digest) continue
        if (content === row.content) content = [...content]
        content[index] = ref.wholeBlock ? incoming : withToolBody(ref.head, text)
        break
      }
    }
    return content === row.content ? row : { ...row, content }
  }

  load(connectionId: string, sessionId: string, ref: ToolBodyAddress, subscriptionId?: string): Promise<string> {
    const address = { sessionId, messageId: ref.messageId, toolUseId: ref.toolUseId, type: ref.type, digest: ref.digest }
    const key = cacheKey(connectionId, address)
    const hit = this.memory.get(key)
    if (hit !== undefined) return Promise.resolve(hit)
    // Closing one expansion releases its snapshot on the node. Independent subscriptions
    // share verified bodies, while their in-flight requests have separate lifetimes.
    const flight = subscriptionId ? JSON.stringify([key, subscriptionId]) : key
    const active = this.pending.get(flight)
    if (active) return active
    const read = async () => {
      const saved = await this.storage.read(key).catch(() => undefined)
      if (saved !== undefined && saved.length === ref.length && contentDigest(saved) === ref.digest) {
        this.retain(key, saved)
        return saved
      }
      const live = this.memory.get(key)
      if (live !== undefined) return live
      const chunks: string[] = []
      for (let offset = 0; offset < ref.length;) {
        const chunk = await this.readChunk(connectionId, { ...address, offset, ...(subscriptionId ? { subscriptionId } : {}) })
        if (typeof chunk !== 'string' || chunk.length !== Math.min(TOOL_CHUNK_CHARS, ref.length - offset)) {
          throw new Error('Incomplete remote tool body chunk')
        }
        chunks.push(chunk)
        offset += chunk.length
      }
      const text = chunks.join('')
      if (contentDigest(text) !== ref.digest) throw new Error('Remote tool body changed while loading')
      this.remember(connectionId, address, text)
      return text
    }
    const pending = read().finally(() => this.pending.delete(flight))
    this.pending.set(flight, pending)
    return pending
  }
}

export const remoteToolBodies = new ToolBodyCache((connectionId, request) => window.environment.readToolChunk(connectionId, request))
