/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any
declare const ResizeObserver: any
declare const requestAnimationFrame: (cb: () => void) => number

import { contextBridge, ipcRenderer } from 'electron'
import { createSuperoneApi, startSuperoneResize, type MiniAppTransport } from '@superone/shared/miniapp-api-runtime'
import { ProcessTitle } from '../main/process-titles'

try { process.title = ProcessTitle.MiniAppDev } catch { /* process.title not writable in some sandboxed contexts */ }

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

ipcRenderer.on('miniapp-fs-response', (_e, data) => dispatchResponse(data))
ipcRenderer.on('miniapp-fs-watch-ack', (_e, data) => dispatchResponse(data))
ipcRenderer.on('miniapp-git-response', (_e, data) => dispatchResponse(data))
ipcRenderer.on('miniapp-db-response', (_e, data) => dispatchResponse(data))
ipcRenderer.on('miniapp-clipboard-response', (_e, data) => dispatchResponse(data))
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
  'miniapp-tool-call',
  'miniapp-fs-watch-event',
  'miniapp-git-head-change',
  'miniapp-theme',
  'miniapp-locale',
] as const

for (const ch of eventChannels) {
  ipcRenderer.on(ch, (_e, data) => {
    const handler = eventHandlers.get(ch)
    if (handler) handler(data)
  })
}

declare const __APP_VERSION__: string
declare const location: { search: string }
const initialLocale = (new URLSearchParams(location.search).get('_locale') as 'en' | 'zh' | null) || 'en'
const api = createSuperoneApi(transport, __APP_VERSION__, { initialLocale })

const popoverParam = new URLSearchParams(location.search).get('_popover')
if (popoverParam) {
  delete (api.ui as Record<string, unknown>).showPopover
  const popoverDataRaw = new URLSearchParams(location.search).get('_popoverData')
  const popoverData = popoverDataRaw ? JSON.parse(popoverDataRaw) : null
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
ipcRenderer.sendToHost('miniapp-ready', {})
