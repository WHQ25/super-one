import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { AgentIpcChannels } from '../shared/agent-types'

const agentAPI = {
  sendMessage: (request: { content: string; model?: string; images?: { mimeType: string; base64: string; name: string }[] }) =>
    ipcRenderer.invoke(AgentIpcChannels.SEND_MESSAGE, request),

  interrupt: () =>
    ipcRenderer.invoke(AgentIpcChannels.INTERRUPT),

  getAvailableModels: () =>
    ipcRenderer.invoke(AgentIpcChannels.AVAILABLE_MODELS),

  respondToPermission: (requestId: string, allow: boolean, alwaysAllow?: boolean) =>
    ipcRenderer.invoke(AgentIpcChannels.PERMISSION_RESPONSE, requestId, allow, alwaysAllow),

  setPermissionMode: (mode: string) =>
    ipcRenderer.invoke(AgentIpcChannels.SET_PERMISSION_MODE, mode),

  answerQuestion: (requestId: string, answers: Record<string, string>) =>
    ipcRenderer.invoke(AgentIpcChannels.ANSWER_QUESTION, requestId, answers),

  resetSession: () =>
    ipcRenderer.invoke(AgentIpcChannels.RESET_SESSION),

  rewindFiles: (userMessageId: string) =>
    ipcRenderer.invoke(AgentIpcChannels.REWIND_FILES, userMessageId),

  getSessionId: () =>
    ipcRenderer.invoke(AgentIpcChannels.GET_SESSION_ID),

  getMcpServerStatus: () =>
    ipcRenderer.invoke(AgentIpcChannels.MCP_SERVER_STATUS),

  getAccountInfo: () =>
    ipcRenderer.invoke(AgentIpcChannels.ACCOUNT_INFO),

  getSlashCommands: () =>
    ipcRenderer.invoke(AgentIpcChannels.SLASH_COMMANDS),

  listDirectory: (relativePath: string) =>
    ipcRenderer.invoke(AgentIpcChannels.LIST_DIRECTORY, relativePath),

  listAgents: () =>
    ipcRenderer.invoke(AgentIpcChannels.LIST_AGENTS),

  onAgentEvent: (callback: (event: unknown) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, event: unknown): void => {
      callback(event)
    }
    ipcRenderer.on(AgentIpcChannels.EVENT, handler)
    return () => {
      ipcRenderer.removeListener(AgentIpcChannels.EVENT, handler)
    }
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('agent', agentAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.agent = agentAPI
}
