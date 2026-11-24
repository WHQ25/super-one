import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolveSuperoneHome } from './superone-home'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { INTERACTION_MEMORY_TOOL_DEFS, type MemoryFamily, type MemoryReadArgs, type MemorySummaryTopic, type MemoryWriteArgs } from '@superone/shared/interaction-memory'
import { MEMORY_READ_SCOPES, MEMORY_SCOPES, type MemoryReadScope, type MemoryScope } from '@superone/shared/browser-memory'
import { deriveProjectMemoryKey, resolveMemoryTarget, type MemoryTarget } from './memory-target'
import { LEGACY_ACTOR, RESERVED_NAMES, isDateTime, latestVerifiedAt, parseNote, renderIndex, serializeNote, text, validateSources, validateStatus, type IndexItem, type NoteMeta } from './okf-note'

const MAX_BYTES = 64 * 1024
const PAGE_SIZE = 50
const TOPIC = /^[a-z][a-z0-9_-]{0,63}$/

interface Note extends NoteMeta {
  topic: string
  content: string
  revision: string
}

function missing(err: unknown): boolean { return (err as NodeJS.ErrnoException)?.code === 'ENOENT' }
function validTopic(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !TOPIC.test(value) || RESERVED_NAMES.has(value)) throw new Error('Invalid topic: use a lowercase name with letters, digits, underscores or hyphens; index and log are reserved.')
}
function topicFiles(names: string[]): string[] {
  return names.filter(name => name.endsWith('.md') && TOPIC.test(name.slice(0, -3)) && !RESERVED_NAMES.has(name.slice(0, -3))).sort()
}
/** Tool-facing shape: OKF fields with the body omitted. */
function summary(note: Note) {
  const { content: _content, extra: _extra, ...rest } = note
  return rest
}
function indexEntry(note: Note, scope: MemoryScope) {
  return { topic: note.topic, title: note.title, description: note.description, scope, status: note.status, generatedAt: note.generated.at,
    ...(latestVerifiedAt(note.verified) ? { verifiedAt: latestVerifiedAt(note.verified) } : {}),
    ...(note.staleAfter ? { staleAfter: note.staleAfter } : {}) }
}
async function writeAtomic(dir: string, name: string, raw: string): Promise<void> {
  const temp = join(dir, `.${name}.${randomUUID()}.tmp`)
  try {
    const file = await open(temp, 'wx', 0o600)
    try { await file.writeFile(raw, 'utf8'); await file.sync() } finally { await file.close() }
    await rename(temp, join(dir, name))
  } finally { await rm(temp, { force: true }) }
}

/**
 * Personal files belong to the executing node, independently of UI hosting.
 * `actor` is recorded as OKF `generated.by` / `verified[].by` (`<producer>/<version>`).
 */
export class InteractionMemoryStore {
  constructor(
    private readonly root: string = resolveSuperoneHome(),
    private readonly actor: string = LEGACY_ACTOR,
    private readonly projectKey?: string,
  ) {}

  /** Same files, different provenance — for hosts that resolve the actor per call. */
  withActor(actor: string): InteractionMemoryStore {
    return actor === this.actor ? this : new InteractionMemoryStore(this.root, actor, this.projectKey)
  }

  withContext(opts: { actor?: string; projectPath?: string; projectKey?: string }): InteractionMemoryStore {
    const actor = opts.actor ?? this.actor
    const projectKey = opts.projectKey ?? (opts.projectPath !== undefined ? deriveProjectMemoryKey(opts.projectPath) : this.projectKey)
    if (actor === this.actor && projectKey === this.projectKey) return this
    return new InteractionMemoryStore(this.root, actor, projectKey)
  }

  private resolveReadScopes(requested?: MemoryReadScope): MemoryScope[] {
    if (requested !== undefined && !MEMORY_READ_SCOPES.includes(requested)) {
      throw new Error(`Invalid memory scope: ${requested}. Use all, project, or global.`)
    }
    if (requested === 'project') {
      if (!this.projectKey) throw new Error('Project memory scope requires an active project context.')
      return ['project']
    }
    if (requested === 'global') return ['global']
    return this.projectKey ? ['project', 'global'] : ['global']
  }

  private resolveWriteScope(requested?: MemoryScope): MemoryScope {
    if (requested !== undefined && !MEMORY_SCOPES.includes(requested)) {
      throw new Error(`Invalid memory scope: ${requested}. Use project or global.`)
    }
    if (requested === 'project' && !this.projectKey) {
      throw new Error('Project memory scope requires an active project context.')
    }
    return requested ?? (this.projectKey ? 'project' : 'global')
  }

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
      const { meta, content } = parseNote(raw, { title: topic, resource: target.resource })
      return { ...meta, topic, content, revision: createHash('sha256').update(raw).digest('hex') }
    } catch (err) {
      if (missing(err)) return null
      throw new Error(`Cannot read personal memory ${target.label}/${topic}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** `tolerant` skips unreadable siblings so one corrupt file cannot block index maintenance. */
  private async loadAll(dir: string, target: MemoryTarget, tolerant = false): Promise<Note[]> {
    const notes: Note[] = []
    for (const name of topicFiles(await readdir(dir))) {
      const note = await this.load(dir, target, name.slice(0, -3)).catch(err => { if (tolerant) return null; throw err })
      if (note) notes.push(note)
    }
    return notes
  }

  async read(family: MemoryFamily, args: MemoryReadArgs) {
    const scopes = this.resolveReadScopes(args.scope)
    if (args.topic !== undefined) validTopic(args.topic)
    const offset = args.offset ?? 0
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid index offset.')
    if (args.topic !== undefined) {
      let fallbackTarget: MemoryTarget | undefined
      for (const scope of scopes) {
        const target = resolveMemoryTarget(family, args, scope, this.projectKey)
        fallbackTarget ??= target
        const dir = await this.directory(target, false)
        const note = dir ? await this.load(dir, target, args.topic) : null
        if (note) return { ...target.identity, scope, ...summary(note), content: note.content }
      }
      const target = fallbackTarget ?? resolveMemoryTarget(family, args, scopes[0]!, this.projectKey)
      throw new Error(`Topic not found. ${target.indexHint.replace('and one topic for its Markdown and revision', 'without topic to list the index')}`)
    }
    const merged: ReturnType<typeof indexEntry>[] = []
    let primaryTarget: MemoryTarget | undefined
    for (const scope of scopes) {
      const target = resolveMemoryTarget(family, args, scope, this.projectKey)
      primaryTarget ??= target
      const dir = await this.directory(target, false)
      if (!dir) continue
      const entries = (await this.loadAll(dir, target))
        .filter(note => note.status !== 'deprecated' || args.includeDeprecated)
        .map(note => indexEntry(note, scope))
      merged.push(...entries)
    }
    const target = primaryTarget ?? resolveMemoryTarget(family, args, 'global', this.projectKey)
    return {
      ...target.identity,
      count: merged.length,
      topics: merged.slice(offset, offset + PAGE_SIZE),
      ...(offset + PAGE_SIZE < merged.length ? { nextOffset: offset + PAGE_SIZE } : {}),
      next: target.indexHint,
    }
  }

  async write(family: MemoryFamily, args: MemoryWriteArgs, signal?: AbortSignal) {
    const scope = this.resolveWriteScope(args.scope)
    const target = resolveMemoryTarget(family, args, scope, this.projectKey)
    validTopic(args.topic)
    if (args.title !== undefined) text(args.title, 'title', 200)
    if (args.description !== undefined) text(args.description, 'description', 500)
    if (args.content !== undefined) text(args.content, 'content', MAX_BYTES)
    const sources = args.sources !== undefined ? validateSources(args.sources) : undefined
    const status = args.status !== undefined ? validateStatus(args.status) : undefined
    if (args.verified !== undefined && typeof args.verified !== 'boolean') throw new Error('Invalid verified flag.')
    if (args.staleAfter !== undefined && !isDateTime(args.staleAfter)) throw new Error('Invalid staleAfter date-time.')
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
    try {
      const existing = await this.load(dir, target, args.topic)
      if ((existing?.revision ?? undefined) !== args.expectedRevision) throw new Error(`Revision conflict. Read this topic with ${target.readTool} and merge your changes before retrying.`)
      const now = new Date().toISOString()
      const content = args.content ?? existing?.content ?? ''
      const contentChanged = existing ? content !== existing.content : true
      const regenerated = !existing || contentChanged || [args.title, args.description, sources, args.staleAfter].some(v => v !== undefined)
      // Editing the procedure invalidates its old verification unless re-verified now.
      const verified = [...(contentChanged ? [] : existing?.verified ?? []), ...(args.verified ? [{ by: this.actor, at: now }] : [])]
      const meta: NoteMeta = {
        title: args.title ?? existing?.title ?? args.topic,
        description: args.description ?? existing?.description ?? '',
        resource: target.resource,
        status: status ?? existing?.status ?? 'stable',
        generated: regenerated ? { by: this.actor, at: now } : existing!.generated,
        verified, sources: sources ?? existing?.sources ?? [],
        ...((args.staleAfter ?? existing?.staleAfter) ? { staleAfter: args.staleAfter ?? existing?.staleAfter } : {}),
        extra: existing?.extra ?? {},
      }
      text(meta.description, 'description', 500)
      text(content, 'content', MAX_BYTES)
      const raw = serializeNote(meta, content)
      if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) throw new Error('Personal memory exceeds the 64 KiB per-topic storage limit. Split it into smaller topics.')
      signal?.throwIfAborted()
      await writeAtomic(dir, `${args.topic}.md`, raw)
      await this.refreshIndexes(dir, target)
      return { saved: true, created: !existing, ...target.identity, scope,
        ...summary({ ...meta, topic: args.topic, content, revision: createHash('sha256').update(raw).digest('hex') }) }
    } finally {
      await rm(lock, { recursive: true, force: true })
    }
  }

  /**
   * OKF `index.md` at the target directory and the family bundle root, so a
   * shared or `cat`-read bundle is self-describing. Derived data only: reads never
   * consult it, so a concurrent writer of another topic merely leaves it one
   * write behind until the next save.
   */
  private async refreshIndexes(dir: string, target: MemoryTarget): Promise<void> {
    const notes = await this.loadAll(dir, target, true)
    await writeAtomic(dir, 'index.md', renderIndex(target.label, notes.map(note => ({
      name: note.title, href: `${note.topic}.md`, description: note.description, deprecated: note.status === 'deprecated',
    }))))
    const bundle = join(this.root, ...target.segments.slice(0, target.bundleDepth))
    const restDepth = target.segments.length - target.bundleDepth
    const leaves = await this.leafDirectories(bundle, restDepth)
    const items: IndexItem[] = leaves.map(path => ({ name: path, href: `${path}/`, description: `${target.segments[target.bundleDepth - 2]} experience for ${path}` }))
    await writeAtomic(bundle, 'index.md', renderIndex(`SuperOne ${target.segments[target.bundleDepth - 2]} experience`, items, { root: true }))
  }

  /** Non-throwing compact summary for entry-point tools (project first, then global). */
  async summarizeForEntry(
    family: MemoryFamily,
    targetArgs: { domain?: string; platform?: string; appId?: string },
    limit = 15,
  ): Promise<MemorySummaryTopic[]> {
    try {
      const scopes = this.resolveReadScopes('all')
      const out: MemorySummaryTopic[] = []
      const appendTarget = async (scope: MemoryScope, args: MemoryReadArgs, includeAppId = false) => {
        if (out.length >= limit) return
        const target = resolveMemoryTarget(family, args, scope, this.projectKey)
        const dir = await this.directory(target, false)
        if (!dir) return
        const notes = await this.loadAll(dir, target, true)
        for (const note of notes) {
          if (note.status === 'deprecated') continue
          out.push({
            topic: note.topic,
            description: note.description,
            scope,
            ...(includeAppId && 'appId' in target.identity ? { appId: target.identity.appId } : {}),
          })
          if (out.length >= limit) break
        }
      }

      if (family === 'browser' && targetArgs.domain) {
        for (const scope of scopes) {
          await appendTarget(scope, { domain: targetArgs.domain })
        }
        return out
      }

      if ((family === 'computer' || family === 'device') && targetArgs.platform) {
        const platform = targetArgs.platform
        if (targetArgs.appId) {
          for (const scope of scopes) {
            await appendTarget(scope, { platform, appId: targetArgs.appId }, true)
            if (targetArgs.appId !== 'system') {
              await appendTarget(scope, { platform, appId: 'system' }, true)
            }
          }
          return out
        }
        // Device boot/request_control often only knows the guest platform: surface all
        // project-scoped app memories for that platform plus system notes.
        for (const scope of scopes) {
          const baseSegments = scope === 'project' && this.projectKey
            ? ['projects', this.projectKey, family, 'memory', platform]
            : [family, 'memory', platform]
          const baseDir = join(this.root, ...baseSegments)
          const appDirs = await readdir(baseDir, { withFileTypes: true }).catch(() => [])
          const appIds = appDirs
            .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
            .map(entry => entry.name)
            .sort((a, b) => (a === 'system' ? 1 : b === 'system' ? -1 : a.localeCompare(b)))
          for (const appId of appIds) {
            if (scope === 'global' && appId !== 'system') continue
            await appendTarget(scope, { platform, appId }, true)
            if (out.length >= limit) break
          }
        }
      }
      return out
    } catch {
      return []
    }
  }

  private async leafDirectories(base: string, depth: number, prefix = ''): Promise<string[]> {
    const entries = (await readdir(base, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name).sort()
    if (depth === 1) return entries.map(name => `${prefix}${name}`)
    const nested = await Promise.all(entries.map(name => this.leafDirectories(join(base, name), depth - 1, `${prefix}${name}/`)))
    return nested.flat()
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
