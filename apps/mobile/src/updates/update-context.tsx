import { createContext, useContext, type ReactNode } from 'react'
import type { UpdateFlowActions, UpdateFlowState } from './use-update-check'

export type UpdateStatus = { state: UpdateFlowState; actions: UpdateFlowActions }

const UpdateStatusContext = createContext<UpdateStatus | null>(null)

/**
 * Publishes the gate's update state to the rest of the shell.
 *
 * Only the About row in app settings reads it, but that row sits eleven levels
 * below `App.tsx` inside an 1800-line shell, and threading two values through
 * `MobileApp` to reach it would be worse than a context with one consumer.
 *
 * Returns `null` outside the provider -- the offline preview and the component
 * tests mount the settings screen on its own and pass their own values.
 */
export function UpdateStatusProvider({
  value,
  children,
}: {
  value: UpdateStatus
  children: ReactNode
}) {
  return <UpdateStatusContext.Provider value={value}>{children}</UpdateStatusContext.Provider>
}

export function useUpdateStatus(): UpdateStatus | null {
  return useContext(UpdateStatusContext)
}
