import { createHash, randomUUID } from 'node:crypto'
import { isUtf8 } from 'node:buffer'
import { watch, type FSWatcher } from 'node:fs'
import { chmod, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import type { SessionRef } from '@superone/shared/environment/refs'
import { McpAppsError, type McpAppAttachmentUpdate, type McpAppHostUpdate, type McpAppReadResult, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { applyMcpAppHostUpdate } from '@superone/shared/mcp-apps-state'
import { MCP_APP_RESOURCE_READ_MAX_BYTES, MCP_APP_RESOURCE_WRITE_MAX_BYTES, type McpAppResourceWriteParams, type McpAppResourceWriteResult } from '@superone/shared/mcp-app-files'
import type { McpAppEntrypointKind } from '@superone/shared/mcp-app-entrypoints'

export interface HostEntrypointApp {
  ref: SessionRef
  projectPath: string
  entrypoint: McpAppEntrypointKind
  app: ToolAppAttachment
  pairedSession?: { sessionId: string; projectPath: string }
}

export type HostOpenedApp = HostFileApp | HostEntrypointApp

/**
 * A View the host opened through a file entrypoint. It lives only in memory: it is
 * not a transcript row, so it has no model context and is gone after a restart.
 * The absolute path stays here; the View only ever sees `app.file.resourceUri`.
 */
export interface HostFileApp {
  ref: SessionRef
  projectPath: string
  app: ToolAppAttachment & { file: NonNullable<ToolAppAttachment['file']> }
  path: string
  /** Writes are allowed only inside the session's workspace. */
  writable: boolean
  /** Set by a read that reported `writable`; writes require one. */
  readEtag?: string
  /** Our own last write, so its watcher echo is not reported as an outside change. */
  writtenEtag?: string
  watcher?: FSWatcher
  debounce?: ReturnType<typeof setTimeout>
}

const apps = new Map<string, HostFileApp>()
const entrypointApps = new Map<string, HostEntrypointApp>()
const MAX_OPEN = 64

function etagOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32)
}

async function inside(file: string, roots: readonly string[]): Promise<boolean> {
  const real = await realpath(file).catch(() => null)
  if (!real) return false
  for (const root of roots) {
    const base = await realpath(root).catch(() => null)
    if (base && (real === base || real.startsWith(base + path.sep))) return true
  }
  return false
}

export async function openHostFileApp(input: {
  ref: SessionRef; projectPath: string; workspace: readonly string[]; path: string
  app: Omit<ToolAppAttachment, 'appInstanceId' | 'file' | 'status'>
}): Promise<HostFileApp> {
  if (!path.isAbsolute(input.path)) throw new McpAppsError('invalid', 'File path must be absolute')
  const info = await stat(input.path).catch(() => null)
  if (!info?.isFile()) throw new McpAppsError('invalid', 'File not found')
  if (apps.size + entrypointApps.size >= MAX_OPEN) throw new McpAppsError('denied', 'Too many files are open in Apps')
  const id = randomUUID()
  const entry: HostFileApp = {
    ref: input.ref, projectPath: input.projectPath, path: input.path,
    writable: await inside(input.path, input.workspace),
    app: { ...input.app, appInstanceId: `host-file:${id}`, file: { name: path.basename(input.path), resourceUri: `host-resource://${id}` }, status: 'pending' },
  }
  apps.set(entry.app.appInstanceId, entry)
  return entry
}

export function openHostEntrypointApp(input: {
  ref: SessionRef
  projectPath: string
  entrypoint: McpAppEntrypointKind
  app: Omit<ToolAppAttachment, 'appInstanceId' | 'file' | 'status'>
}): { entry: HostEntrypointApp; reused: boolean } {
  for (const existing of entrypointApps.values()) {
    if (
      existing.ref.environmentId === input.ref.environmentId
      && existing.ref.sessionId === input.ref.sessionId
      && existing.app.binding.server === input.app.binding.server
      && existing.app.toolName === input.app.toolName
      && (existing.app.status === 'result' || existing.app.status === 'pending')
    ) {
      return { entry: existing, reused: true }
    }
  }
  if (apps.size + entrypointApps.size >= MAX_OPEN) throw new McpAppsError('denied', 'Too many Apps are open')
  const entry: HostEntrypointApp = {
    ref: input.ref,
    projectPath: input.projectPath,
    entrypoint: input.entrypoint,
    app: { ...input.app, appInstanceId: `host-app:${randomUUID()}`, status: 'pending' },
  }
  entrypointApps.set(entry.app.appInstanceId, entry)
  return { entry, reused: false }
}

export function hostFileApp(ref: SessionRef, appInstanceId: string): HostFileApp | undefined {
  const entry = apps.get(appInstanceId)
  return entry && entry.ref.environmentId === ref.environmentId && entry.ref.sessionId === ref.sessionId ? entry : undefined
}

export function hostOpenedApp(ref: SessionRef, appInstanceId: string): HostOpenedApp | undefined {
  return hostFileApp(ref, appInstanceId) ?? (() => {
    const entry = entrypointApps.get(appInstanceId)
    return entry && entry.ref.environmentId === ref.environmentId && entry.ref.sessionId === ref.sessionId ? entry : undefined
  })()
}

export function hostEntrypointAppsForSession(ref: SessionRef): ToolAppAttachment[] {
  const result: ToolAppAttachment[] = []
  for (const entry of entrypointApps.values()) {
    const matchesDirect = entry.ref.environmentId === ref.environmentId && entry.ref.sessionId === ref.sessionId
    const matchesPaired = ref.environmentId === 'local' && entry.pairedSession?.sessionId === ref.sessionId
    if (matchesDirect || matchesPaired) result.push(entry.app)
  }
  return result
}

export function updateHostFileApp(entry: HostFileApp, update: McpAppAttachmentUpdate | Partial<Pick<ToolAppAttachment, 'toolInput' | 'toolResult' | 'status' | 'error'>>): void {
  if ('modelContext' in update) throw new McpAppsError('denied', 'File Apps have no model context')
  entry.app = { ...entry.app, ...update }
}

export function updateHostOpenedApp(entry: HostOpenedApp, update: McpAppHostUpdate): void {
  if ('path' in entry) {
    updateHostFileApp(entry, update)
    return
  }
  entry.app = applyMcpAppHostUpdate(entry.app, update)
  const boundedUpdate: McpAppHostUpdate = entry.app.toolResultOmitted
    ? { ...update, toolResult: undefined, toolResultOmitted: entry.app.toolResultOmitted }
    : update
  const payload = { sessionId: entry.ref.sessionId, projectPath: entry.projectPath, appInstanceId: entry.app.appInstanceId, update: boundedUpdate }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('mcpApp:hostUpdated', payload)
  }
}

export function releaseHostFileApp(entry: HostFileApp): void {
  unsubscribeHostFile(entry)
  apps.delete(entry.app.appInstanceId)
}

export function releaseHostOpenedApp(ref: SessionRef, appInstanceId: string): void {
  const file = hostFileApp(ref, appInstanceId)
  if (file) {
    releaseHostFileApp(file)
    return
  }
  const entry = entrypointApps.get(appInstanceId)
  if (entry && entry.ref.environmentId === ref.environmentId && entry.ref.sessionId === ref.sessionId) {
    entrypointApps.delete(appInstanceId)
  }
}

export function releaseHostFileApps(ref: SessionRef): void {
  for (const entry of [...apps.values()]) if (entry.ref.environmentId === ref.environmentId && entry.ref.sessionId === ref.sessionId) releaseHostFileApp(entry)
  for (const entry of [...entrypointApps.values()]) {
    if (entry.ref.environmentId === ref.environmentId && entry.ref.sessionId === ref.sessionId) {
      entrypointApps.delete(entry.app.appInstanceId)
    } else if (ref.environmentId === 'local' && entry.pairedSession?.sessionId === ref.sessionId) {
      entry.pairedSession = undefined
    }
  }
}

function assertOwnUri(entry: HostFileApp, uri: string): void {
  if (uri !== entry.app.file.resourceUri) throw new McpAppsError('denied', 'Apps can only use the file they opened')
}

export async function readHostFile(entry: HostFileApp, uri: string, representation?: 'text' | 'blob'): Promise<McpAppReadResult> {
  assertOwnUri(entry, uri)
  const info = await stat(entry.path).catch(() => null)
  if (!info?.isFile()) throw new McpAppsError('invalid', 'The file no longer exists')
  if (info.size > MCP_APP_RESOURCE_READ_MAX_BYTES) throw new McpAppsError('invalid', 'The file is too large for this App')
  const bytes = await readFile(entry.path)
  const etag = etagOf(bytes)
  if (entry.writable) entry.readEtag = etag
  const asText = representation ? representation === 'text' : isUtf8(bytes)
  return { contents: [{
    uri,
    ...(asText ? { mimeType: 'text/plain', text: bytes.toString('utf8') } : { mimeType: 'application/octet-stream', blob: bytes.toString('base64') }),
    _meta: { 'openai/resource': { etag, writable: entry.writable } },
  }] }
}

export async function writeHostFile(entry: HostFileApp, params: McpAppResourceWriteParams): Promise<McpAppResourceWriteResult> {
  assertOwnUri(entry, params.uri)
  if (!entry.writable || !entry.readEtag) throw new McpAppsError('denied', 'This file is not writable')
  const data = typeof params.text === 'string' ? Buffer.from(params.text, 'utf8') : Buffer.from(params.blob!, 'base64')
  if (data.byteLength > MCP_APP_RESOURCE_WRITE_MAX_BYTES) return { outcome: 'too-large', maxBytes: MCP_APP_RESOURCE_WRITE_MAX_BYTES }
  const info = await stat(entry.path).catch(() => null)
  if (!info?.isFile()) throw new McpAppsError('invalid', 'The file no longer exists')
  const current = etagOf(await readFile(entry.path))
  if (params.ifMatch !== undefined && params.ifMatch !== current) return { outcome: 'conflict', etag: current }
  // Write beside the file and rename, so a reader never sees a partial file.
  const temp = path.join(path.dirname(entry.path), `.${path.basename(entry.path)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, data, { flag: 'wx' })
    await chmod(temp, info.mode & 0o7777)
    await rename(temp, entry.path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw new McpAppsError('invalid', error instanceof Error ? error.message : 'Could not save the file')
  }
  const etag = etagOf(data)
  entry.readEtag = etag
  entry.writtenEtag = etag
  return { outcome: 'saved', etag }
}

/** Watches the directory, not the file: a save by rename replaces the file's inode. */
export function subscribeHostFile(entry: HostFileApp, uri: string): void {
  assertOwnUri(entry, uri)
  if (entry.watcher) return
  const name = path.basename(entry.path)
  entry.watcher = watch(path.dirname(entry.path), { persistent: false }, (_event, changed) => {
    if (changed && changed.toString() !== name) return
    clearTimeout(entry.debounce)
    entry.debounce = setTimeout(() => void notifyChange(entry), 150)
  })
  entry.watcher.on('error', () => unsubscribeHostFile(entry))
}

export function unsubscribeHostFile(entry: HostFileApp): void {
  clearTimeout(entry.debounce)
  entry.watcher?.close()
  entry.watcher = undefined
}

async function notifyChange(entry: HostFileApp): Promise<void> {
  if (!entry.watcher) return
  const bytes = await readFile(entry.path).catch(() => null)
  if (bytes && etagOf(bytes) === entry.writtenEtag) return
  entry.writtenEtag = undefined
  const payload = { appInstanceId: entry.app.appInstanceId, uri: entry.app.file.resourceUri }
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('mcpApp:resourceUpdated', payload)
}
