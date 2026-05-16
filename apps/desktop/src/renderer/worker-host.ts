import { buildMiniAppFrameAttrs } from '@superone/shared/miniapp-frame-attrs'
import { MINIAPP_HEADLESS_SAFE_TYPES, MINIAPP_WORKER_REJECT_RESPONSE, MINIAPP_WORKER_UNAVAILABLE_ERROR } from '@superone/shared/miniapp-types'
import type { MiniAppMediaKind } from '@superone/shared/miniapp-types'

interface WorkerHostBridge {
  toolResult: (callId: string, result: unknown, error?: string) => Promise<unknown>
  fsRequest: (projectDir: string, appId: string, op: string, args: Record<string, unknown>) => Promise<unknown>
  gitRequest: (projectDir: string, appId: string, op: string, args: Record<string, unknown>) => Promise<unknown>
  dbRequest: (appId: string, op: string, args: Record<string, unknown>) => Promise<unknown>
  kvRequest: (appId: string, op: string, args: Record<string, unknown>) => Promise<unknown>
  fsWatch: (projectDir: string, appId: string, path: string) => Promise<number>
  fsUnwatch: (watchId: number) => Promise<unknown>
  peerEmit: (appId: string, event: string, payload: unknown) => void
  toMain: (appId: string, projectDir: string, type: string, data: Record<string, unknown>) => void
  onWorkerMsg: (cb: (payload: unknown) => void) => () => void
}

declare global {
  interface Window { workerHost: WorkerHostBridge }
}

const params = new URLSearchParams(location.search)
const appId = params.get('appId') ?? ''
const projectDir = params.get('projectDir') ?? ''
const host = params.get('host') ?? ''
const entry = params.get('entry') ?? 'background.html'
const storage = params.get('storage') === '1'
const media = (params.get('media') ?? '').split(',').filter(Boolean) as MiniAppMediaKind[]

const wh = window.workerHost
const { sandbox } = buildMiniAppFrameAttrs({ grantedMedia: media, storage })

const iframe = document.createElement('iframe')
iframe.setAttribute('sandbox', sandbox)
iframe.style.cssText = 'position:fixed;inset:0;border:none;width:100%;height:100%'
iframe.src = `superone-app://${host}/${entry}?_worker=1`
document.body.appendChild(iframe)

function reply(type: string, id: unknown, payload: { result?: unknown; error?: string }) {
  iframe.contentWindow?.postMessage({ type, id, ...payload }, '*')
}

const WORKER_PLUMBING = new Set([
  'miniapp-worker-event',
  'miniapp-worker-lease',
  'miniapp-worker-lease-release',
  'miniapp-worker-status-set',
])

window.addEventListener('message', (e) => {
  const data = e.data as Record<string, unknown> | undefined
  if (!data || typeof data.type !== 'string' || e.source !== iframe.contentWindow) return
  const type = data.type
  const id = data.id

  if (WORKER_PLUMBING.has(type)) {
    wh.toMain(appId, projectDir, type, data)
    return
  }
  if (type === 'miniapp-ready') {
    wh.toMain(appId, projectDir, 'miniapp-ready', {})
    return
  }
  if (!MINIAPP_HEADLESS_SAFE_TYPES.has(type)) {
    const rejectType = MINIAPP_WORKER_REJECT_RESPONSE[type]
    if (rejectType) reply(rejectType, id, { error: MINIAPP_WORKER_UNAVAILABLE_ERROR })
    return
  }

  const args = data.args as Record<string, unknown>
  switch (type) {
    case 'miniapp-tool-result':
      wh.toolResult(data.callId as string, data.result, data.error as string | undefined)
      return
    case 'miniapp-fs-request':
      wh.fsRequest(projectDir, (data.appId as string) ?? appId, data.op as string, args)
        .then((result) => reply('miniapp-fs-response', id, { result }))
        .catch((err: Error) => reply('miniapp-fs-response', id, { error: err.message }))
      return
    case 'miniapp-git-request':
      wh.gitRequest(projectDir, appId, data.op as string, args)
        .then((result) => reply('miniapp-git-response', id, { result }))
        .catch((err: Error) => reply('miniapp-git-response', id, { error: err.message }))
      return
    case 'miniapp-db-request':
      wh.dbRequest(appId, data.op as string, args)
        .then((result) => reply('miniapp-db-response', id, { result }))
        .catch((err: Error) => reply('miniapp-db-response', id, { error: err.message }))
      return
    case 'miniapp-kv-request':
      wh.kvRequest(appId, data.op as string, args)
        .then((result) => reply('miniapp-kv-response', id, { result }))
        .catch((err: Error) => reply('miniapp-kv-response', id, { error: err.message }))
      return
    case 'miniapp-fs-watch':
      wh.fsWatch(projectDir, appId, data.path as string)
        .then((watchId) => iframe.contentWindow?.postMessage({ type: 'miniapp-fs-watch-ack', id, watchId }, '*'))
        .catch((err: Error) => reply('miniapp-fs-watch-ack', id, { error: err.message }))
      return
    case 'miniapp-fs-unwatch':
      wh.fsUnwatch(data.watchId as number)
      return
    case 'miniapp-peer-emit':
      if (typeof data.event === 'string') wh.peerEmit(appId, data.event, data.payload)
      return
  }
})

wh.onWorkerMsg((payload) => {
  iframe.contentWindow?.postMessage({ type: 'miniapp-worker-msg', payload }, '*')
})
