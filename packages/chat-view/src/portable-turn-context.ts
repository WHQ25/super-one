import { createContext } from 'react'

export type PendingPermission = {
  toolUseId?: string
  toolName: string
} | null

export interface PortableTurnContextValue {
  scheme: 'light' | 'dark'
  pendingPermission: PendingPermission
  /**
   * Host project root, or null when the host has not reported one. Only file
   * links use it — markdown media stays untouched because the WebView has no
   * transport that could fetch a host file.
   */
  projectPath: string | null
}

/**
 * Turn-wide state the tool rows read. It lives in its own module so the shared row can
 * consume it without importing the adapter file that renders the row.
 */
export const PortableTurnContext = createContext<PortableTurnContextValue>({
  scheme: 'dark',
  pendingPermission: null,
  projectPath: null,
})
