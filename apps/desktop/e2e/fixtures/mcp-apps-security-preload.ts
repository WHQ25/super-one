import { contextBridge, ipcRenderer } from 'electron'
import { MCP_APP_DOCUMENT_REVOKED } from '@superone/shared/mcp-apps-host/document'

contextBridge.exposeInMainWorld('securityNative', {
  onEscape(callback: (url: string) => void) { ipcRenderer.on('mcpApp:escape', (_event, payload: { url: string }) => callback(payload.url)) },
  onRevoke(callback: (url: string) => void) { ipcRenderer.on(MCP_APP_DOCUMENT_REVOKED, (_event, payload: { url: string }) => callback(payload.url)) },
  canExecute(url: string): boolean { return ipcRenderer.sendSync('test:mcp-app-execute', url) },
})
