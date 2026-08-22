/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any
declare const ResizeObserver: any
declare const requestAnimationFrame: (cb: () => void) => number

import { contextBridge, ipcRenderer } from 'electron'
import { createSuperoneApi, startSuperoneResize, startSuperoneReady, type MiniAppTransport } from '@superone/shared/miniapp-api-runtime'

// No `process.title` here: renderer processes cannot be renamed. See main/process-titles.ts.

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; resultKey?: string }>()
let reqId = 0
const eventHandlers = new Map<string, (data: Record<string, unknown>) => void>()

const transport: MiniAppTransport = {
  send(type, data) {
    ipcRenderer.sendToHost(type, data)
  },
  request(reqType, resType, data, resultKey) {
    return new Promise((resolve, reject) => {
      const id = ++reqId
      pending.set(`${resType}:${id}`, { resolve, reject, resultKey })
      ipcRenderer.sendToHost(reqType, { id, ...data })
    })
  },
  on(type, handler) {
    eventHandlers.set(type, handler)
  },
}

ipcRenderer.on('miniapp-ui-contextmenu-result', (_e, data) => dispatchResponse(data))

function dispatchResponse(data: Record<string, unknown>) {
  const key = `${data.type}:${data.id}`
  const p = pending.get(key)
  if (p) {
    pending.delete(key)
    if (data.error) p.reject(new Error(data.error as string))
    else p.resolve(p.resultKey ? data[p.resultKey] : data.result)
  }
}

const eventChannels = [
  'miniapp-theme',
  'miniapp-locale',
  'miniapp-node-message',
  'miniapp-standalone-data',
] as const

for (const ch of eventChannels) {
  ipcRenderer.on(ch, (_e, data) => {
    const handler = eventHandlers.get(ch)
    if (handler) handler(data)
  })
}

declare const __APP_VERSION__: string
declare const location: { search: string; host: string }

const initialLocale = (new URLSearchParams(location.search).get('_locale') as 'en' | 'zh' | null) || 'en'
const api = createSuperoneApi(transport, __APP_VERSION__, { initialLocale })
const params = new URLSearchParams(location.search)

function parseJsonParam(name: string): unknown {
  const raw = params.get(name)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

const callId = params.get('_toolCallId') || ''
const toolName = params.get('_toolName') || ''
if (params.has('_toolIntercept')) {
  let settled = false
  ;(api as unknown as Record<string, unknown>).tool = {
    phase: 'intercept',
    callId,
    toolName,
    data: parseJsonParam('_toolData'),
    submit(userInput: Record<string, unknown>) {
      if (settled) return
      settled = true
      transport.send('miniapp-tool-submit', { callId, userInput: userInput ?? {} })
    },
    cancel(reason?: string | null) {
      if (settled) return
      settled = true
      transport.send('miniapp-tool-cancel', { callId, reason: reason ?? null })
    },
  }
} else if (params.has('_toolResult')) {
  ;(api as unknown as Record<string, unknown>).tool = {
    phase: 'result',
    callId,
    toolName,
    data: parseJsonParam('_toolData'),
    close() { transport.send('miniapp-tool-result-close', { callId }) },
  }
} else if (params.has('_standalone')) {
  type StandaloneState = { args: Record<string, unknown> | null; result: unknown; error: string | null }
  let state: StandaloneState = { args: null, result: null, error: null }
  const listeners = new Set<(value: StandaloneState) => void>()
  ;(api as unknown as Record<string, unknown>).tool = {
    phase: 'standalone',
    callId,
    toolName,
    getState: () => state,
    onDidChange(callback: (value: StandaloneState) => void) {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
  }
  transport.on('miniapp-standalone-data', (data) => {
    state = {
      args: (data.arguments as Record<string, unknown> | null) ?? null,
      result: data.result,
      error: typeof data.error === 'string' ? data.error : null,
    }
    listeners.forEach((listener) => listener(state))
  })
}

const popoverParam = params.get('_popover')
if (popoverParam) {
  delete (api.ui as Record<string, unknown>).showPopover
  const popoverData = parseJsonParam('_popoverData')
  const popoverMsgListeners: Array<(data: unknown) => void> = []
  ;(api as unknown as Record<string, unknown>).popover = {
    data: popoverData,
    postMessage(data: unknown) { transport.send('miniapp-popover-msg', { data }) },
    onMessage(cb: (data: unknown) => void) { popoverMsgListeners.push(cb) },
    close() { transport.send('miniapp-popover-close', {}) },
  }
  ipcRenderer.on('miniapp-popover-msg', (_e, d) => {
    popoverMsgListeners.forEach((cb) => cb((d as Record<string, unknown>).data))
  })
} else {
  ipcRenderer.on('miniapp-popover-closed', (_e, data) => {
    const handler = eventHandlers.get('miniapp-popover-closed')
    if (handler) handler(data as Record<string, unknown>)
  })
}

contextBridge.exposeInMainWorld('superone', api)
contextBridge.exposeInMainWorld('__superoneIpcToHost', (type: string, data: Record<string, unknown>) => {
  ipcRenderer.sendToHost(type, data)
})
startSuperoneResize(transport)
startSuperoneReady(transport)
