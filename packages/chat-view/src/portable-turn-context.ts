import { createContext } from 'react'

export type PendingPermission = {
  toolUseId?: string
  toolName: string
} | null

export interface PortableTurnContextValue {
  scheme: 'light' | 'dark'
  pendingPermission: PendingPermission
}

/**
 * Turn-wide state the tool rows read. It lives in its own module so the shared row can
 * consume it without importing the adapter file that renders the row.
 */
export const PortableTurnContext = createContext<PortableTurnContextValue>({
  scheme: 'dark',
  pendingPermission: null,
})
