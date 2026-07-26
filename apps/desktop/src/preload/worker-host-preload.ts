import { contextBridge, ipcRenderer } from 'electron'

// No `process.title` here: renderer processes cannot be renamed. See main/process-titles.ts.

const CH = {
  TOOL_RESULT: 'miniapp:tool-result',
  FS_REQUEST: 'miniapp:fs-request',
  GIT_REQUEST: 'miniapp:git-request',
  DB_REQUEST: 'miniapp:db-request',
  KV_REQUEST: 'miniapp:kv-request',
  FS_WATCH: 'miniapp:fs-watch',
  FS_UNWATCH: 'miniapp:fs-unwatch',
  PEER_EMIT: 'miniapp:peer-emit',
  WORKER_SEND: 'miniapp:worker-send',
  WORKER_EVENT: 'miniapp:worker-event',
} as const

const workerMsgListeners: Array<(payload: unknown) => void> = []
ipcRenderer.on(CH.WORKER_EVENT, (_e, data: { payload: unknown }) => {
  workerMsgListeners.forEach((cb) => cb(data?.payload))
})

const api = {
  toolResult: (callId: string, result: unknown, error?: string) =>
    ipcRenderer.invoke(CH.TOOL_RESULT, callId, result, error),
  fsRequest: (projectDir: string, appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(CH.FS_REQUEST, projectDir, appId, op, args),
  gitRequest: (projectDir: string, appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(CH.GIT_REQUEST, projectDir, appId, op, args),
  dbRequest: (projectDir: string | null, scope: string, appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(CH.DB_REQUEST, projectDir, scope, appId, op, args),
  kvRequest: (projectDir: string | null, scope: string, appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(CH.KV_REQUEST, projectDir, scope, appId, op, args),
  fsWatch: (projectDir: string, appId: string, path: string) =>
    ipcRenderer.invoke(CH.FS_WATCH, projectDir, appId, path) as Promise<number>,
  fsUnwatch: (watchId: number) =>
    ipcRenderer.invoke(CH.FS_UNWATCH, watchId),
  peerEmit: (appId: string, event: string, payload: unknown) =>
    ipcRenderer.send(CH.PEER_EMIT, appId, event, payload),
  toMain: (appId: string, projectDir: string, type: string, data: Record<string, unknown>) =>
    ipcRenderer.send(CH.WORKER_SEND, { appId, projectDir, type, data }),
  onWorkerMsg: (cb: (payload: unknown) => void) => {
    workerMsgListeners.push(cb)
    return () => {
      const i = workerMsgListeners.indexOf(cb)
      if (i >= 0) workerMsgListeners.splice(i, 1)
    }
  },
}

contextBridge.exposeInMainWorld('workerHost', api)
