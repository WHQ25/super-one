import { create } from 'zustand'

interface SessionSettlePendingState {
  /** Sessions whose settle or unsettle call has not finished. */
  pending: ReadonlySet<string>
}

export const useSessionSettlePendingStore = create<SessionSettlePendingState>(() => ({
  pending: new Set(),
}))

export function sessionSettleKey(folderPath: string, sessionId: string): string {
  return `${folderPath}\0${sessionId}`
}

export function isSessionSettlePending(folderPath: string, sessionId: string): boolean {
  return useSessionSettlePendingStore.getState().pending.has(sessionSettleKey(folderPath, sessionId))
}

export function useSessionSettlePending(folderPath: string, sessionId: string): boolean {
  const key = sessionSettleKey(folderPath, sessionId)
  return useSessionSettlePendingStore((state) => state.pending.has(key))
}

/** Story and test hook. A real settle goes through {@link withSessionSettlePending}. */
export function setSessionSettlePending(folderPath: string, sessionId: string, pending: boolean): void {
  const key = sessionSettleKey(folderPath, sessionId)
  useSessionSettlePendingStore.setState((state) => {
    if (state.pending.has(key) === pending) return state
    const next = new Set(state.pending)
    if (pending) next.add(key)
    else next.delete(key)
    return { pending: next }
  })
}

export function clearSessionSettlePending(): void {
  if (useSessionSettlePendingStore.getState().pending.size === 0) return
  useSessionSettlePendingStore.setState({ pending: new Set() })
}

/**
 * Remote settle waits on the node before the row can leave the list. Hold the
 * spinner across that wait. A second call for the same session does nothing
 * until the first one finishes, so a double click cannot start two RPCs.
 */
export async function withSessionSettlePending<T>(
  folderPath: string,
  sessionId: string,
  work: () => Promise<T>,
): Promise<T | undefined> {
  const key = sessionSettleKey(folderPath, sessionId)
  let started = false
  useSessionSettlePendingStore.setState((state) => {
    if (state.pending.has(key)) return state
    started = true
    const pending = new Set(state.pending)
    pending.add(key)
    return { pending }
  })
  if (!started) return undefined
  try {
    return await work()
  } finally {
    useSessionSettlePendingStore.setState((state) => {
      if (!state.pending.has(key)) return state
      const pending = new Set(state.pending)
      pending.delete(key)
      return { pending }
    })
  }
}
