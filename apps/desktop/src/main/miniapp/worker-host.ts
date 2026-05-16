import { BrowserWindow, session } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { MiniAppWorkerInfo } from '@superone/shared/miniapp-types'
import { WindowRole, roleArg } from '../process-titles'
import { registerMiniAppProtocolHandlers } from './miniapp-protocol'
import log from '../logger'

const WORKER_PARTITION = 'miniapp-worker'
const IDLE_MS = 30_000
const RUNAWAY_MS = 6 * 60 * 60 * 1000
const BUFFER_MAX_MSGS = 100
const BUFFER_MAX_BYTES = 256 * 1024
const BUFFER_TTL_MS = 60_000

interface BufferEntry { payload: unknown; bytes: number; at: number }

interface WorkerInstance {
  win: BrowserWindow
  appId: string
  projectDir: string
  name: string
  statusText: string
  since: number
  ready: boolean
  leases: Set<number>
  idleTimer: ReturnType<typeof setTimeout> | null
  runawayTimer: ReturnType<typeof setTimeout> | null
  toWorker: BufferEntry[]
}

export interface WorkerStartArgs {
  appId: string
  projectDir: string
  name: string
  host: string
  entry: string
  storage: boolean
  media: string[]
}

export interface WorkerStatus { running: boolean; since?: number; statusText?: string }

const STATUS_MAX_LEN = 120

let getMainWindow: (() => BrowserWindow | null) | null = null
let partitionReady = false

const instances = new Map<string, WorkerInstance>()

function key(projectDir: string, appId: string): string { return `${projectDir}::${appId}` }

export function initWorkerHost(mainWindowGetter: () => BrowserWindow | null): void {
  getMainWindow = mainWindowGetter
}

export function listWorkers(): MiniAppWorkerInfo[] {
  const out: MiniAppWorkerInfo[] = []
  for (const inst of instances.values()) {
    if (inst.win.isDestroyed()) continue
    out.push({
      appId: inst.appId,
      projectDir: inst.projectDir,
      name: inst.name,
      since: inst.since,
      statusText: inst.statusText || undefined,
    })
  }
  return out
}

function emitWorkerState(): void {
  const mw = getMainWindow?.()
  if (mw && !mw.isDestroyed()) {
    mw.webContents.send(AgentIpcChannels.MINIAPP_WORKER_STATE, { workers: listWorkers() })
  }
}

function ensurePartition(): Electron.Session {
  const ses = session.fromPartition(WORKER_PARTITION)
  if (!partitionReady) {
    registerMiniAppProtocolHandlers(ses.protocol)
    ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
    ses.setPermissionCheckHandler(() => false)
    partitionReady = true
  }
  return ses
}

function clearTimers(inst: WorkerInstance): void {
  if (inst.idleTimer) { clearTimeout(inst.idleTimer); inst.idleTimer = null }
  if (inst.runawayTimer) { clearTimeout(inst.runawayTimer); inst.runawayTimer = null }
}

function scheduleIdle(inst: WorkerInstance): void {
  if (inst.idleTimer) clearTimeout(inst.idleTimer)
  if (inst.leases.size > 0) return
  inst.idleTimer = setTimeout(() => {
    log.info('[worker-host] idle reclaim %s', key(inst.projectDir, inst.appId))
    stopWorker(inst.projectDir, inst.appId)
  }, IDLE_MS)
}

export function startWorker(args: WorkerStartArgs): WorkerStatus {
  const k = key(args.projectDir, args.appId)
  const existing = instances.get(k)
  if (existing && !existing.win.isDestroyed()) {
    return { running: true, since: existing.since }
  }

  const ses = ensurePartition()
  const win = new BrowserWindow({
    show: false,
    width: 480,
    height: 360,
    webPreferences: {
      session: ses,
      preload: join(__dirname, '../preload/worker-host-preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: [roleArg(WindowRole.WorkerHost)],
    },
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const entryUrl = `worker-host.html`
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.includes(entryUrl)) e.preventDefault()
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log.error('[worker-host] shell did-fail-load %s code=%d %s url=%s', k, code, desc, url)
  })

  const inst: WorkerInstance = {
    win,
    appId: args.appId,
    projectDir: args.projectDir,
    name: args.name,
    statusText: '',
    since: Date.now(),
    ready: false,
    leases: new Set(),
    idleTimer: null,
    runawayTimer: null,
    toWorker: [],
  }
  instances.set(k, inst)

  const qs = new URLSearchParams({
    appId: args.appId,
    projectDir: args.projectDir,
    host: args.host,
    entry: args.entry,
    storage: args.storage ? '1' : '0',
    media: args.media.join(','),
  }).toString()

  log.info('[worker-host] start %s', k)
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/worker-host.html?${qs}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/worker-host.html'), { search: qs })
  }

  win.on('closed', () => {
    const cur = instances.get(k)
    if (cur === inst) {
      clearTimers(inst)
      instances.delete(k)
      emitWorkerState()
    }
  })

  inst.runawayTimer = setTimeout(() => {
    log.warn('[worker-host] runaway guard reclaim %s', k)
    stopWorker(args.projectDir, args.appId)
  }, RUNAWAY_MS)
  scheduleIdle(inst)

  emitWorkerState()
  return { running: true, since: inst.since }
}

export function stopWorker(projectDir: string, appId: string): void {
  const k = key(projectDir, appId)
  const inst = instances.get(k)
  if (!inst) return
  clearTimers(inst)
  instances.delete(k)
  if (!inst.win.isDestroyed()) inst.win.destroy()
  emitWorkerState()
}

export function workerStatus(projectDir: string, appId: string): WorkerStatus {
  const inst = instances.get(key(projectDir, appId))
  if (inst && !inst.win.isDestroyed()) return { running: true, since: inst.since, statusText: inst.statusText || undefined }
  return { running: false }
}

export function hasActiveWorkers(): boolean {
  for (const inst of instances.values()) {
    if (!inst.win.isDestroyed()) return true
  }
  return false
}

export function stopAllWorkers(): void {
  for (const k of [...instances.keys()]) {
    const [projectDir, appId] = k.split('::')
    stopWorker(projectDir, appId)
  }
}

function flushToWorker(inst: WorkerInstance): void {
  if (!inst.ready || inst.win.isDestroyed()) return
  const now = Date.now()
  for (const e of inst.toWorker) {
    if (now - e.at > BUFFER_TTL_MS) continue
    inst.win.webContents.send(AgentIpcChannels.MINIAPP_WORKER_EVENT, { payload: e.payload })
  }
  inst.toWorker = []
}

function pushBuffer(buf: BufferEntry[], payload: unknown): boolean {
  const bytes = (() => { try { return JSON.stringify(payload).length } catch { return 0 } })()
  buf.push({ payload, bytes, at: Date.now() })
  let dropped = false
  let total = buf.reduce((s, e) => s + e.bytes, 0)
  while (buf.length > BUFFER_MAX_MSGS || total > BUFFER_MAX_BYTES) {
    const removed = buf.shift()
    if (!removed) break
    total -= removed.bytes
    dropped = true
  }
  return dropped
}

// Foreground panel -> worker.
export function sendToWorker(projectDir: string, appId: string, payload: unknown): void {
  const inst = instances.get(key(projectDir, appId))
  if (!inst || inst.win.isDestroyed()) return
  if (inst.ready) {
    inst.win.webContents.send(AgentIpcChannels.MINIAPP_WORKER_EVENT, { payload })
  } else {
    pushBuffer(inst.toWorker, payload)
  }
}

// Worker shell -> main (worker->fg event, lease ops, ready).
export function handleWorkerSend(
  projectDir: string,
  appId: string,
  type: string,
  data: Record<string, unknown>,
): void {
  const inst = instances.get(key(projectDir, appId))
  if (!inst) return
  switch (type) {
    case 'miniapp-ready':
      inst.ready = true
      flushToWorker(inst)
      return
    case 'miniapp-worker-lease':
      inst.leases.add(data.leaseId as number)
      if (inst.idleTimer) { clearTimeout(inst.idleTimer); inst.idleTimer = null }
      return
    case 'miniapp-worker-lease-release':
      inst.leases.delete(data.leaseId as number)
      scheduleIdle(inst)
      return
    case 'miniapp-worker-status-set': {
      const next = String((data as { text?: unknown }).text ?? '').slice(0, STATUS_MAX_LEN)
      if (next === inst.statusText) return
      inst.statusText = next
      emitWorkerState()
      return
    }
    case 'miniapp-worker-event': {
      const mw = getMainWindow?.()
      if (mw && !mw.isDestroyed()) {
        mw.webContents.send(AgentIpcChannels.MINIAPP_WORKER_EVENT, {
          appId, projectDir, payload: (data as { payload?: unknown }).payload,
        })
      }
      return
    }
  }
}
