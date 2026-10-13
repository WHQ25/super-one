import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode, type SetStateAction } from 'react'
import { useTranscriptState } from '@superone/ui/lib/transcript-state'

function createStore() {
  const values = new Map<string, boolean>()
  const listeners = new Map<string, Set<() => void>>()
  return {
    get: (id: string) => values.get(id) ?? false,
    subscribe(id: string, listener: () => void) {
      const group = listeners.get(id) ?? new Set()
      listeners.set(id, group)
      group.add(listener)
      return () => { group.delete(listener); if (!group.size) listeners.delete(id) }
    },
    set(id: string, update: SetStateAction<boolean>) {
      const previous = values.get(id) ?? false
      const value = typeof update === 'function' ? update(previous) : update
      if (value === previous) return
      values.set(id, value)
      listeners.get(id)?.forEach(listener => listener())
    },
  }
}

const Context = createContext<ReturnType<typeof createStore> | null>(null)

/** One disclosure per provider turn, including rows separated by compaction. */
export function TurnDetailStateProvider({ scope, children }: { scope: string | number; children: ReactNode }) {
  const store = useMemo(createStore, [scope])
  return <Context.Provider value={store}>{children}</Context.Provider>
}

export function useTurnDetailState(turnId?: string) {
  const store = useContext(Context)
  const [local, setLocal] = useTranscriptState('turn-detail', false)
  const subscribe = useCallback((listener: () => void) => store && turnId ? store.subscribe(turnId, listener) : () => {}, [store, turnId])
  const snapshot = useCallback(() => store && turnId ? store.get(turnId) : local, [store, turnId, local])
  const expanded = useSyncExternalStore(subscribe, snapshot, snapshot)
  const setExpanded = useCallback((value: SetStateAction<boolean>) => {
    if (store && turnId) store.set(turnId, value)
    else setLocal(value)
  }, [store, turnId, setLocal])
  return [expanded, setExpanded] as const
}
