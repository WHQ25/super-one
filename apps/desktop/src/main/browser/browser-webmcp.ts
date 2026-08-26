import { randomUUID } from 'crypto'
import { join } from 'path'
import { ipcMain, session, webContents, type WebContents } from 'electron'
import { readAppSettings } from '../app-settings-service'

const BROWSER_PARTITION = 'persist:browser'
const MAX_TOOLS = 64
const MAX_NAME_CHARS = 128
const MAX_DESCRIPTION_CHARS = 1024
const MAX_SCHEMA_BYTES = 8 * 1024

export interface WebMcpTool {
  name: string
  description: string
  inputSchema: string
  truncated?: true
}

interface WebMcpRegistryEntry {
  origin: string
  tools: WebMcpTool[]
}

interface PendingInvocation {
  webContentsId: number
  resolve: (value: { outputJson: string }) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const registry = new Map<number, WebMcpRegistryEntry>()
const listening = new Set<number>()
const pending = new Map<string, PendingInvocation>()
let initialized = false

function browserSession(): Electron.Session {
  return session.fromPartition(BROWSER_PARTITION)
}

function isBrowserSender(sender: WebContents): boolean {
  return sender.session === browserSession()
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function sanitizeTool(value: unknown): WebMcpTool | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (typeof input.name !== 'string') return null
  const name = input.name.trim()
  if (!name || name.length > MAX_NAME_CHARS) return null
  if (typeof input.description !== 'string' || input.description.length > MAX_DESCRIPTION_CHARS) return null
  if (typeof input.inputSchema !== 'string' || byteLength(input.inputSchema) > MAX_SCHEMA_BYTES) return null
  return {
    name,
    description: input.description,
    inputSchema: input.inputSchema,
    ...(input.truncated === true ? { truncated: true } : {}),
  }
}

function rejectPendingForWebContents(webContentsId: number, reason: string): void {
  for (const [invocationId, entry] of pending) {
    if (entry.webContentsId !== webContentsId) continue
    pending.delete(invocationId)
    clearTimeout(entry.timer)
    entry.reject(new Error(reason))
  }
}

function attachLifecycleListeners(wc: WebContents): void {
  if (listening.has(wc.id)) return
  listening.add(wc.id)
  wc.on('did-navigate', () => {
    registry.delete(wc.id)
  })
  wc.once('destroyed', () => {
    registry.delete(wc.id)
    listening.delete(wc.id)
    rejectPendingForWebContents(wc.id, 'Browser view was destroyed')
  })
}

export function isWebMcpEnabled(): boolean {
  try {
    return readAppSettings().webmcpEnabled === true
  } catch {
    return false
  }
}

export function initBrowserWebmcp(): void {
  if (initialized) return
  initialized = true
  browserSession().registerPreloadScript({
    id: 'webmcp',
    type: 'frame',
    filePath: join(__dirname, '../preload/webmcp-preload.js'),
  })

  ipcMain.on('webmcp:sync', (event, payload: unknown) => {
    const wc = event.sender
    if (!isBrowserSender(wc)) return
    let origin: string
    try {
      origin = new URL(wc.getURL()).origin
    } catch {
      return
    }
    const input = payload as { tools?: unknown }
    const rawTools = Array.isArray(input?.tools) ? input.tools : []
    const tools: WebMcpTool[] = []
    for (const rawTool of rawTools.slice(0, MAX_TOOLS)) {
      const tool = sanitizeTool(rawTool)
      if (tool) tools.push(tool)
    }
    attachLifecycleListeners(wc)
    registry.set(wc.id, { origin, tools })
  })

  ipcMain.on('webmcp:result', (event, payload: unknown) => {
    const wc = event.sender
    if (!isBrowserSender(wc)) return
    const result = payload as {
      invocationId?: unknown
      ok?: unknown
      outputJson?: unknown
      error?: unknown
    }
    if (typeof result?.invocationId !== 'string') return
    const entry = pending.get(result.invocationId)
    if (!entry || entry.webContentsId !== wc.id) return
    if (result.ok === true && typeof result.outputJson === 'string') {
      pending.delete(result.invocationId)
      clearTimeout(entry.timer)
      entry.resolve({ outputJson: result.outputJson })
    } else if (result.ok === false) {
      pending.delete(result.invocationId)
      clearTimeout(entry.timer)
      entry.reject(new Error(typeof result.error === 'string' ? result.error : 'WebMCP tool failed'))
    }
  })
}

export function getWebMcpTools(webContentsId: number): WebMcpRegistryEntry | null {
  const entry = registry.get(webContentsId)
  if (!entry) return null
  return { origin: entry.origin, tools: entry.tools.map((tool) => ({ ...tool })) }
}

export async function invokeWebMcpTool(
  webContentsId: number,
  toolName: string,
  input: Record<string, unknown>,
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<{ outputJson: string }> {
  const wc = webContents.fromId(webContentsId)
  if (!wc || wc.isDestroyed() || !isBrowserSender(wc)) {
    throw new Error(`Browser view ${webContentsId} is not available`)
  }
  attachLifecycleListeners(wc)
  const invocationId = randomUUID()
  const inputJson = JSON.stringify(input)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(invocationId)
      reject(new Error(`WebMCP invocation timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    pending.set(invocationId, { webContentsId, resolve, reject, timer })
    try {
      wc.send('webmcp:invoke', { invocationId, toolName, inputJson })
    } catch (error) {
      pending.delete(invocationId)
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
