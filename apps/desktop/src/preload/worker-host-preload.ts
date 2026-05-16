import { contextBridge, ipcRenderer } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'

try { process.title = 'SuperOne Worker Host' } catch { /* not writable in some sandboxed contexts */ }

const workerMsgListeners: Array<(payload: unknown) => void> = []
ipcRenderer.on(AgentIpcChannels.MINIAPP_WORKER_EVENT, (_e, data: { payload: unknown }) => {
  workerMsgListeners.forEach((cb) => cb(data?.payload))
})

const api = {
  toolResult: (callId: string, result: unknown, error?: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_TOOL_RESULT, callId, result, error),
  fsRequest: (projectDir: string, appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_FS_REQUEST, projectDir, appId, op, args),
  gitRequest: (projectDir: string, appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_GIT_REQUEST, projectDir, appId, op, args),
  dbRequest: (appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_DB_REQUEST, appId, op, args),
  kvRequest: (appId: string, op: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_KV_REQUEST, appId, op, args),
  fsWatch: (projectDir: string, appId: string, path: string) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_FS_WATCH, projectDir, appId, path) as Promise<number>,
  fsUnwatch: (watchId: number) =>
    ipcRenderer.invoke(AgentIpcChannels.MINIAPP_FS_UNWATCH, watchId),
  peerEmit: (appId: string, event: string, payload: unknown) =>
    ipcRenderer.send(AgentIpcChannels.MINIAPP_PEER_EMIT, appId, event, payload),
  toMain: (appId: string, projectDir: string, type: string, data: Record<string, unknown>) =>
    ipcRenderer.send(AgentIpcChannels.MINIAPP_WORKER_SEND, { appId, projectDir, type, data }),
  onWorkerMsg: (cb: (payload: unknown) => void) => {
    workerMsgListeners.push(cb)
    return () => {
      const i = workerMsgListeners.indexOf(cb)
      if (i >= 0) workerMsgListeners.splice(i, 1)
    }
  },
}

contextBridge.exposeInMainWorld('workerHost', api)
