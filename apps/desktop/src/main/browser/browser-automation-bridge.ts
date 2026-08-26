import type { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import log from '../logger'

export type BrowserAutomationOp =
  | 'snapshot'
  | 'query'
  | 'inspect'
  | 'screenshot'
  | 'click'
  | 'hover'
  | 'type'
  | 'navigate'
  | 'wait_for'
  | 'press'
  | 'scroll'
  | 'drag'
  | 'select'
  | 'open'
  | 'evaluate'
  | 'tabs'
  | 'resolveWebContentsId'
  | 'ownedWebContentsIds'
  | 'resolvePoint'
  | 'emulateViewport'
  | 'focusView'
  | 'focusGuardBegin'
  | 'focusGuardEnd'
  | 'recordStart'
  | 'recordStop'

interface PendingCall {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const BROWSER_CALL_TIMEOUT_MS = 30_000

const pendingCalls = new Map<string, PendingCall>()

let getMainWindow: (() => BrowserWindow | null) | null = null

export function initBrowserAutomation(windowGetter: () => BrowserWindow | null): void {
  getMainWindow = windowGetter
}

export function browserAutomationCall(sessionId: string, op: BrowserAutomationOp, input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const win = getMainWindow?.()
    if (!win || win.isDestroyed()) {
      reject(new Error('No renderer window available for browser automation'))
      return
    }
    const callId = randomUUID()
    const timer = setTimeout(() => {
      pendingCalls.delete(callId)
      reject(new Error(`Browser automation '${op}' timed out after ${BROWSER_CALL_TIMEOUT_MS}ms`))
    }, BROWSER_CALL_TIMEOUT_MS)
    pendingCalls.set(callId, { resolve, reject, timer })
    win.webContents.send(AgentIpcChannels.BROWSER_AUTOMATION_CALL, { callId, sessionId, op, input })
  })
}

export async function resolveBrowserWebContentsId(sessionId: string, tab?: string): Promise<number> {
  const result = await browserAutomationCall(sessionId, 'resolveWebContentsId', { tab }) as {
    webContentsId?: number
  }
  if (typeof result.webContentsId !== 'number' || result.webContentsId < 0) {
    throw new Error('Could not resolve the target browser view')
  }
  return result.webContentsId
}

/**
 * Hold (or release) the renderer's host-focus guard around agent-driven input.
 *
 * CDP input is dispatched from THIS process straight to the guest webContents,
 * so the renderer never sees the op and its own isolation window (which only
 * wraps renderer-side ops) is already closed by then. Without this the guest
 * keeps keyboard focus after a click and the user's typing lands in the page.
 *
 * Best-effort: a guard failure must never fail the tool call.
 */
export async function browserFocusGuard(sessionId: string, active: boolean): Promise<void> {
  try {
    await browserAutomationCall(sessionId, active ? 'focusGuardBegin' : 'focusGuardEnd', {})
  } catch (err) {
    log.warn('[browser-automation] focus guard %s failed: %s', active ? 'begin' : 'end', err instanceof Error ? err.message : String(err))
  }
}

export function resolveBrowserAutomation(callId: string, result: unknown): void {
  const pending = pendingCalls.get(callId)
  if (!pending) {
    log.warn('[browser-automation] resolve miss callId=%s', callId)
    return
  }
  clearTimeout(pending.timer)
  pendingCalls.delete(callId)
  pending.resolve(result)
}

export function rejectBrowserAutomation(callId: string, error: string): void {
  const pending = pendingCalls.get(callId)
  if (!pending) {
    log.warn('[browser-automation] reject miss callId=%s', callId)
    return
  }
  clearTimeout(pending.timer)
  pendingCalls.delete(callId)
  pending.reject(new Error(error))
}
