/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any
declare const ResizeObserver: any
declare const requestAnimationFrame: (cb: () => void) => number

import { contextBridge, ipcRenderer } from 'electron'

type ToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>
const handlers = new Map<string, ToolHandler>()

let fsReqId = 0
const pendingFs = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

type WatchCallback = (event: { type: string; path: string }) => void
const pendingWatch = new Map<number, { resolve: (v: number) => void; reject: (e: Error) => void; callback: WatchCallback }>()
const watchCallbacks = new Map<number, WatchCallback>()
let watchReqId = 0

let gitReqId = 0
const pendingGit = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const gitHeadListeners: Array<() => void> = []

const darkModeListeners: Array<(isDark: boolean) => void> = []
const themeListeners: Array<(vars: Record<string, string>) => void> = []

function bridgeFsCall(op: string, args: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++fsReqId
    pendingFs.set(id, { resolve, reject })
    ipcRenderer.sendToHost('miniapp-fs-request', { id, op, args })
  })
}

function bridgeGitCall(op: string, args: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++gitReqId
    pendingGit.set(id, { resolve, reject })
    ipcRenderer.sendToHost('miniapp-git-request', { id, op, args })
  })
}

type InitCallback = (data: Record<string, unknown>) => void
const initCallbacks: InitCallback[] = []
let initData: Record<string, unknown> | null = null

contextBridge.exposeInMainWorld('superone', {
  tools: {
    handle(name: string, callback: ToolHandler) {
      handlers.set(name, callback)
    },
  },
  onInit(callback: InitCallback) {
    if (initData !== null) { callback(initData) }
    else { initCallbacks.push(callback) }
  },
  fs: {
    readFile: (path: string) => bridgeFsCall('readFile', { path }),
    readDir: (path: string) => bridgeFsCall('readDir', { path: path || '.' }),
    writeFile: (path: string, content: string) => bridgeFsCall('writeFile', { path, content }),
    exists: (path: string) => bridgeFsCall('exists', { path }),
    glob: (pattern: string) => bridgeFsCall('glob', { pattern }),
    watch(path: string, callback: WatchCallback): Promise<number> {
      return new Promise((resolve, reject) => {
        const id = ++watchReqId
        pendingWatch.set(id, { resolve, reject, callback })
        ipcRenderer.sendToHost('miniapp-fs-watch', { id, path })
      })
    },
    unwatch(watchId: number) {
      watchCallbacks.delete(watchId)
      ipcRenderer.sendToHost('miniapp-fs-unwatch', { watchId })
    },
  },
  agent: {
    sendPrompt(text: string) {
      ipcRenderer.sendToHost('miniapp-sendPrompt', { text })
    },
  },
  git: {
    info: () => bridgeGitCall('info', {}),
    branches: () => bridgeGitCall('branches', {}),
    log: (opts?: { limit?: number }) => bridgeGitCall('log', opts ?? {}),
    status: () => bridgeGitCall('status', {}),
    diff: (path: string, staged?: boolean) => bridgeGitCall('diff', { path, staged: !!staged }),
    show: (ref: string, path: string) => bridgeGitCall('show', { ref, path }),
    onHeadChange(cb: () => void) {
      gitHeadListeners.push(cb)
      return () => {
        const idx = gitHeadListeners.indexOf(cb)
        if (idx >= 0) gitHeadListeners.splice(idx, 1)
      }
    },
  },
  theme: {
    getVars(): Record<string, string> {
      const style = document.documentElement.style
      const vars: Record<string, string> = {}
      for (let i = 0; i < style.length; i++) {
        const prop = style[i]
        if (prop.startsWith('--')) {
          vars[prop.slice(2)] = style.getPropertyValue(prop).trim()
        }
      }
      return vars
    },
    onChange(cb: (vars: Record<string, string>) => void) {
      themeListeners.push(cb)
      return () => {
        const idx = themeListeners.indexOf(cb)
        if (idx >= 0) themeListeners.splice(idx, 1)
      }
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

ipcRenderer.on('miniapp-fs-watch-ack', (_e, data) => {
  const pw = pendingWatch.get(data.id)
  if (pw) {
    pendingWatch.delete(data.id)
    if (data.error) {
      pw.reject(new Error(data.error))
    } else {
      watchCallbacks.set(data.watchId, pw.callback)
      pw.resolve(data.watchId)
    }
  }
})

ipcRenderer.on('miniapp-fs-watch-event', (_e, data) => {
  const cb = watchCallbacks.get(data.watchId)
  if (cb) cb({ type: data.eventType, path: data.path })
})

ipcRenderer.on('miniapp-git-response', (_e, data) => {
  const pg = pendingGit.get(data.id)
  if (pg) {
    pendingGit.delete(data.id)
    if (data.error) pg.reject(new Error(data.error))
    else pg.resolve(data.result)
  }
})

ipcRenderer.on('miniapp-git-head-change', () => {
  gitHeadListeners.forEach((cb) => cb())
})

ipcRenderer.on('miniapp-theme', (_e, data) => {
  const root = document.documentElement
  if (data.isDark) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  if (data.vars) {
    for (const [key, value] of Object.entries(data.vars)) {
      root.style.setProperty(`--${key}`, value as string)
    }
  }
  darkModeListeners.forEach((cb) => cb(data.isDark))
  themeListeners.forEach((cb) => cb(data.vars ?? {}))
})


ipcRenderer.on('miniapp-inchat-init', (_e, data) => {
  initData = data.data
  initCallbacks.forEach((cb) => cb(initData!))
  initCallbacks.length = 0
})

function startResizeObserver() {
  if (!document.body) return
  let lastH = 0
  let pending = false
  new ResizeObserver(() => {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      const h = document.body.offsetHeight
      if (h > 0 && h !== lastH) {
        lastH = h
        ipcRenderer.sendToHost('miniapp-resize', { height: h })
      }
    })
  }).observe(document.body)
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  startResizeObserver()
} else {
  document.addEventListener('DOMContentLoaded', startResizeObserver)
}

ipcRenderer.sendToHost('miniapp-ready', {})
