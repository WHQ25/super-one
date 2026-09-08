import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolveSuperoneHome } from './superone-home'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parse, stringify } from 'yaml'
import { INTERACTION_MEMORY_TOOL_DEFS, type MemoryFamily, type MemoryReadArgs, type MemoryWriteArgs } from '@superone/shared/interaction-memory'
import { resolveMemoryTarget, type MemoryTarget } from './memory-target'

const MAX_BYTES = 64 * 1024
const PAGE_SIZE = 50
const TOPIC = /^[a-z][a-z0-9_-]{0,63}$/

interface NoteMetadata {
  version: 1
  summary: string
  updatedAt: string
  archived: boolean
  source?: string
  verifiedAt?: string
}
interface Note extends NoteMetadata {
  topic: string
  content: string
  revision: string
}

function missing(err: unknown): boolean { return (err as NodeJS.ErrnoException)?.code === 'ENOENT' }
function validTopic(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !TOPIC.test(value)) throw new Error('Invalid topic: use a lowercase name with letters, digits, underscores or hyphens.')
}
function textField(value: unknown, name: string, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}: provide non-empty text within the storage limit.`)
}
function summary(note: Note) {
  const { content: _content, version: _version, ...rest } = note
  return rest
}
function indexEntry(note: Note) {
  return { topic: note.topic, summary: note.summary, archived: note.archived, updatedAt: note.updatedAt }
}

/** Personal files belong to the executing node, independently of UI hosting. */
export class InteractionMemoryStore {
  constructor(private readonly root: string = resolveSuperoneHome()) {}

  private async directory(target: MemoryTarget, create: boolean): Promise<string | null> {
    let path = this.root
    if (create) await mkdir(path, { recursive: true, mode: 0o700 })
    for (const segment of ['', ...target.segments]) {
      path = join(path, segment)
      if (create) await mkdir(path, { mode: 0o700 }).catch(err => { if (err.code !== 'EEXIST') throw err })
      try {
        const info = await lstat(path)
        if (info.isSymbolicLink()) throw new Error('Personal memory cannot traverse symbolic links.')
        if (!info.isDirectory()) throw new Error('Personal memory path is not a directory.')
      } catch (err) { if (!create && missing(err)) return null; throw err }
    }
    return path
  }

  private async load(dir: string, target: MemoryTarget, topic: string): Promise<Note | null> {
    const path = join(dir, `${topic}.md`)
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Personal memory cannot read symbolic links.')
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      let raw: string
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Invalid personal memory file or storage limit exceeded.')
        raw = await file.readFile('utf8')
      } finally { await file.close() }
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw)
      if (!match) throw new Error('Missing Markdown metadata')
      const meta = parse(match[1]!, { maxAliasCount: 0 }) as NoteMetadata
      if (!meta || meta.version !== 1 || typeof meta.archived !== 'boolean' || typeof meta.updatedAt !== 'string' || !Number.isFinite(Date.parse(meta.updatedAt))) throw new Error('Invalid Markdown metadata')
      textField(meta.summary, 'summary', 500)
      if (meta.source !== undefined) textField(meta.source, 'source', 1000)
      if (meta.verifiedAt !== undefined && (typeof meta.verifiedAt !== 'string' || !Number.isFinite(Date.parse(meta.verifiedAt)))) throw new Error('Invalid verifiedAt metadata')
      return { version: 1, summary: meta.summary, updatedAt: meta.updatedAt, archived: meta.archived,
        ...(meta.source !== undefined ? { source: meta.source } : {}),
        ...(meta.verifiedAt !== undefined ? { verifiedAt: meta.verifiedAt } : {}),
        topic, content: match[2]!, revision: createHash('sha256').update(raw).digest('hex') }
    } catch (err) {
      if (missing(err)) return null
      throw new Error(`Cannot read personal memory ${target.label}/${topic}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async read(family: MemoryFamily, args: MemoryReadArgs) {
    const target = resolveMemoryTarget(family, args)
    if (args.topic !== undefined) validTopic(args.topic)
    const offset = args.offset ?? 0
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid index offset.')
    const dir = await this.directory(target, false)
    if (args.topic !== undefined) {
      const note = dir ? await this.load(dir, target, args.topic) : null
      if (!note) throw new Error(`Topic not found. ${target.indexHint.replace('and one topic for its Markdown and revision', 'without topic to list the index')}`)
      return { ...target.identity, ...note }
    }
    const topics: ReturnType<typeof indexEntry>[] = []
    if (dir) {
      const entries = (await readdir(dir)).filter(name => name.endsWith('.md') && TOPIC.test(name.slice(0, -3))).sort()
      for (const name of entries) {
        const note = await this.load(dir, target, name.slice(0, -3))
        if (note && (!note.archived || args.includeArchived)) topics.push(indexEntry(note))
      }
    }
    return { ...target.identity, count: topics.length, topics: topics.slice(offset, offset + PAGE_SIZE),
      ...(offset + PAGE_SIZE < topics.length ? { nextOffset: offset + PAGE_SIZE } : {}),
      next: target.indexHint }
  }

  async write(family: MemoryFamily, args: MemoryWriteArgs, signal?: AbortSignal) {
    const target = resolveMemoryTarget(family, args)
    validTopic(args.topic)
    if (args.summary !== undefined) textField(args.summary, 'summary', 500)
    if (args.content !== undefined) textField(args.content, 'content', MAX_BYTES)
    if (args.source !== undefined) textField(args.source, 'source', 1000)
    if (args.verifiedAt !== undefined && (typeof args.verifiedAt !== 'string' || !Number.isFinite(Date.parse(args.verifiedAt)))) throw new Error('Invalid verifiedAt date-time.')
    if (args.archived !== undefined && typeof args.archived !== 'boolean') throw new Error('Invalid archived flag.')
    signal?.throwIfAborted()
    const dir = (await this.directory(target, true))!
    const lock = join(dir, `.${args.topic}.lock`)
    const deadline = Date.now() + 2000
    for (;;) {
      signal?.throwIfAborted()
      try { await mkdir(lock, { mode: 0o700 }); break } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        if (Date.now() >= deadline) throw new Error(`Personal memory is locked. Retry after the active writer finishes. If a writer crashed, remove the stale lock directory: ${lock}`)
        await delay(20, undefined, { signal })
      }
    }
    const temp = join(dir, `.${args.topic}.${randomUUID()}.tmp`)
    try {
      const existing = await this.load(dir, target, args.topic)
      if ((existing?.revision ?? undefined) !== args.expectedRevision) throw new Error(`Revision conflict. Read this topic with ${target.readTool} and merge your changes before retrying.`)
      const note: NoteMetadata = {
        version: 1, summary: args.summary ?? existing?.summary ?? '', updatedAt: new Date().toISOString(),
        archived: args.archived ?? existing?.archived ?? false,
        ...((args.source ?? existing?.source) ? { source: args.source ?? existing?.source } : {}),
        // Editing the procedure invalidates its old verification unless re-verified.
        ...((args.verifiedAt ?? (args.content === undefined ? existing?.verifiedAt : undefined))
          ? { verifiedAt: args.verifiedAt ?? existing?.verifiedAt } : {}),
      }
      const content = args.content ?? existing?.content ?? ''
      textField(note.summary, 'summary', 500)
      textField(content, 'content', MAX_BYTES)
      const raw = `---\n${stringify(note)}---\n${content}`
      if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) throw new Error('Personal memory exceeds the 64 KiB per-topic storage limit. Split it into smaller topics.')
      const file = await open(temp, 'wx', 0o600)
      try { await file.writeFile(raw, 'utf8'); await file.sync() } finally { await file.close() }
      signal?.throwIfAborted()
      await rename(temp, join(dir, `${args.topic}.md`))
      return { status: note.archived ? 'archived' : 'saved', created: !existing,
        ...target.identity, ...summary({ ...note, topic: args.topic, content, revision: createHash('sha256').update(raw).digest('hex') }) }
    } finally {
      await rm(temp, { force: true })
      await rm(lock, { recursive: true, force: true })
    }
  }
}

export async function executeInteractionMemoryTool(name: string, args: Record<string, unknown>, store = new InteractionMemoryStore(), signal?: AbortSignal) {
  try {
    if (!INTERACTION_MEMORY_TOOL_DEFS.some(def => def.name === name)) throw new Error(`Unknown memory tool: ${name}`)
    const family = name.split('_')[0] as MemoryFamily
    const value = name.endsWith('_read')
      ? await store.read(family, args as unknown as MemoryReadArgs)
      : await store.write(family, args as unknown as MemoryWriteArgs, signal)
    return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
  } catch (err) {
    return { isError: true as const, content: [{ type: 'text' as const, text: `[Error] ${err instanceof Error ? err.message : String(err)}` }] }
  }
}
