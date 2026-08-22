import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'

/**
 * Forwards a MiniApp Host action to the renderer and waits for its result.
 *
 * The renderer — not main — executes these: it owns the toast surface, the chat
 * store, and the consent prompts for clipboard reads and external links.
 * Routing through main only adds addressing, never bypasses a prompt.
 */
export interface MiniAppHostActionRequest {
  appId: string
  projectDir: string
  action: string
  args: Record<string, unknown>
}

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
}

const pending = new Map<string, Pending>()

let getMainWindow: (() => BrowserWindow | null) | null = null

export function initMiniAppHostActionBridge(mainWindowGetter: () => BrowserWindow | null): void {
  getMainWindow = mainWindowGetter
}

export function runMiniAppHostAction(request: MiniAppHostActionRequest): Promise<unknown> {
  const win = getMainWindow?.()
  if (!win || win.isDestroyed()) {
    return Promise.reject(new Error(`Cannot run "${request.action}": no window available`))
  }
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    win.webContents.send(AgentIpcChannels.MINIAPP_HOST_ACTION, { requestId, ...request })
  })
}

export function settleMiniAppHostAction(requestId: string, result: unknown, error?: string): void {
  const entry = pending.get(requestId)
  if (!entry) return
  pending.delete(requestId)
  if (error) entry.reject(new Error(error))
  else entry.resolve(result)
}

/** The renderer that owed us these answers is gone; fail them instead of hanging. */
export function rejectAllMiniAppHostActions(reason: string): void {
  for (const entry of pending.values()) entry.reject(new Error(reason))
  pending.clear()
}
