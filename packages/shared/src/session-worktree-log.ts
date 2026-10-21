/**
 * One line for a worktree or cwd write, so a stale path on a new unsent session
 * can be traced in production `main.log`.
 *
 * Renderer call sites send it on the existing TRACE IPC with source
 * `session.worktree`. Main forwards only that source to `log.debug`. Every
 * other trace source stays on the dev-only event database.
 *
 * Hot store paths repeat the same value. A null that did not change is
 * dropped. Any other write is logged once per site, session, and project
 * until the path or unsent flag changes.
 */

export const SESSION_WORKTREE_TRACE_SOURCE = 'session.worktree'

export interface WorktreeWrite {
  projectPath?: string | null
  sessionId?: string | null
  before?: string | null
  after?: string | null
  unsent: boolean
}

const lastSignature = new Map<string, string>()
const MAX_SIGNATURES = 2000

let emitter: ((line: string) => void) | null = null

export function setSessionWorktreeLogEmitter(fn: ((line: string) => void) | null): void {
  emitter = fn
}

/** Test seam. Production callers do not reset the repeat filter. */
export function resetSessionWorktreeWriteLog(): void {
  lastSignature.clear()
}

/**
 * The chat store publishes its snapshot here after it exists. The app store
 * reads it when a worktree path changes. A direct import would cycle, and an
 * export on the app store breaks tests that mock that module.
 */
const WORKTREE_SESSION_READER = '__superoneWorktreeSessionReader'

export function registerWorktreeSessionReader(reader: () => unknown): void {
  ;(globalThis as Record<string, unknown>)[WORKTREE_SESSION_READER] = reader
}

export function readWorktreeSessionReader<T>(): T | null {
  const read = (globalThis as Record<string, unknown>)[WORKTREE_SESSION_READER]
  if (typeof read !== 'function') return null
  try {
    return read() as T
  } catch {
    return null
  }
}

export function resetWorktreeSessionReader(): void {
  delete (globalThis as Record<string, unknown>)[WORKTREE_SESSION_READER]
}

function pathToken(value: string | null | undefined): string {
  if (value == null || value === '') return 'null'
  return value.replace(/[\r\n\t]/g, '')
}

function sidToken(sessionId: string | null | undefined): string {
  if (!sessionId) return 'null'
  return sessionId.slice(0, 8)
}

export function formatSessionWorktreeLine(site: string, fields: WorktreeWrite): string {
  return `[session-worktree] site=${site} sid=${sidToken(fields.sessionId)} project=${pathToken(fields.projectPath)} before=${pathToken(fields.before)} after=${pathToken(fields.after)} unsent=${fields.unsent ? 'true' : 'false'}`
}

function normalized(value: string | null | undefined): string | null {
  if (value == null || value === '') return null
  return value
}

function takeLine(site: string, fields: WorktreeWrite): string | null {
  const before = normalized(fields.before)
  const after = normalized(fields.after)
  if (before === after && after === null) return null
  const key = `${site}\0${fields.sessionId ?? ''}\0${normalized(fields.projectPath) ?? ''}`
  const signature = `${before ?? ''}\0${after ?? ''}\0${fields.unsent ? '1' : '0'}`
  if (lastSignature.get(key) === signature) return null
  if (lastSignature.size >= MAX_SIGNATURES) {
    const oldest = lastSignature.keys().next().value
    if (oldest !== undefined) lastSignature.delete(oldest)
  }
  lastSignature.set(key, signature)
  return formatSessionWorktreeLine(site, { ...fields, before, after, projectPath: normalized(fields.projectPath) })
}

function rendererTrace():
  | ((source: string, type: string, data: unknown, tag?: string) => void)
  | null {
  const host = globalThis as {
    window?: { app?: { trace?: (source: string, type: string, data: unknown, tag?: string) => void } }
  }
  const trace = host.window?.app?.trace
  return typeof trace === 'function' ? trace : null
}

export function logWorktreeWrite(site: string, fields: WorktreeWrite): void {
  try {
    const line = takeLine(site, fields)
    if (!line) return
    const trace = rendererTrace()
    if (trace) {
      trace(SESSION_WORKTREE_TRACE_SOURCE, site, line)
      return
    }
    emitter?.(line)
  } catch {
    // A diagnostic must not change the write it observes.
  }
}

/** The `main.log` line for a TRACE payload, or null for every other source. */
export function forwardSessionWorktreeTrace(source: string, data: unknown): string | null {
  if (source !== SESSION_WORKTREE_TRACE_SOURCE || typeof data !== 'string') return null
  if (!data.startsWith('[session-worktree] ')) return null
  return data.length > 4000 ? data.slice(0, 4000) : data
}
