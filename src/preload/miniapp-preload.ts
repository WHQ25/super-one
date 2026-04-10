/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any
declare const ResizeObserver: any
declare const requestAnimationFrame: (cb: () => void) => number

import { contextBridge, ipcRenderer } from 'electron'
import { createSuperoneApi, startSuperoneResize, type MiniAppTransport } from '../shared/miniapp-api-runtime'

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
  'miniapp-inchat-init',
] as const

for (const ch of eventChannels) {
  ipcRenderer.on(ch, (_e, data) => {
    const handler = eventHandlers.get(ch)
    if (handler) handler(data)
  })
}

declare const __APP_VERSION__: string
contextBridge.exposeInMainWorld('superone', createSuperoneApi(transport, __APP_VERSION__))
startSuperoneResize(transport)
ipcRenderer.sendToHost('miniapp-ready', {})
