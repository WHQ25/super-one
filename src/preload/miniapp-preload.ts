/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any

import { contextBridge, ipcRenderer } from 'electron'

type ToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>
const handlers = new Map<string, ToolHandler>()

let fsReqId = 0
const pendingFs = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

const darkModeListeners: Array<(isDark: boolean) => void> = []

function bridgeFsCall(op: string, args: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++fsReqId
    pendingFs.set(id, { resolve, reject })
    ipcRenderer.sendToHost('miniapp-fs-request', { id, op, args })
  })
}

contextBridge.exposeInMainWorld('superone', {
  tools: {
    handle(name: string, callback: ToolHandler) {
      handlers.set(name, callback)
    },
  },
  fs: {
    readFile: (path: string) => bridgeFsCall('readFile', { path }),
    readDir: (path: string) => bridgeFsCall('readDir', { path: path || '.' }),
    writeFile: (path: string, content: string) => bridgeFsCall('writeFile', { path, content }),
    exists: (path: string) => bridgeFsCall('exists', { path }),
    glob: (pattern: string) => bridgeFsCall('glob', { pattern }),
  },
  agent: {
    sendPrompt(text: string) {
      ipcRenderer.sendToHost('miniapp-sendPrompt', { text })
    },
  },
  isDarkMode() {
    return document.documentElement.classList.contains('dark')
  },
  onDarkModeChange(cb: (isDark: boolean) => void) {
    darkModeListeners.push(cb)
    return () => {
      const idx = darkModeListeners.indexOf(cb)
      if (idx >= 0) darkModeListeners.splice(idx, 1)
    }
  },
})

ipcRenderer.on('miniapp-tool-call', async (_e, data) => {
  const handler = handlers.get(data.toolName)
  if (handler) {
    try {
      const result = await handler(data.arguments)
      ipcRenderer.sendToHost('miniapp-tool-result', { callId: data.callId, result })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      ipcRenderer.sendToHost('miniapp-tool-result', { callId: data.callId, error: message })
    }
  } else {
    ipcRenderer.sendToHost('miniapp-tool-result', {
      callId: data.callId,
      error: `No handler for tool: ${data.toolName}`,
    })
  }
})

ipcRenderer.on('miniapp-fs-response', (_e, data) => {
  const pending = pendingFs.get(data.id)
  if (pending) {
    pendingFs.delete(data.id)
    if (data.error) {
      pending.reject(new Error(data.error))
    } else {
      pending.resolve(data.result)
    }
  }
})

ipcRenderer.on('miniapp-dark-mode', (_e, data) => {
  if (data.isDark) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
  darkModeListeners.forEach((cb) => cb(data.isDark))
})

ipcRenderer.sendToHost('miniapp-ready', {})
