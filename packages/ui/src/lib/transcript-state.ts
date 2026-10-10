import { createContext, createElement, useCallback, useContext, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

interface TranscriptState { values: Map<string, unknown>; scope: string }
const Context = createContext<TranscriptState | null>(null)

/** A transcript owns disclosure state independently of the rows it mounts. */
export function TranscriptStateProvider({ values, scope, children }: TranscriptState & { children: ReactNode }) {
  const value = useMemo(() => ({ values, scope }), [values, scope])
  return createElement(Context.Provider, { value }, children)
}

export function TranscriptStateScope({ id, children }: { id: string; children: ReactNode }) {
  const parent = useContext(Context)
  const value = useMemo(() => parent ? { ...parent, scope: `${parent.scope}\0${id}` } : null, [parent, id])
  return createElement(Context.Provider, { value }, children)
}

/** Behaves like useState outside a virtual transcript. Keys name logical content, never DOM positions. */
export function useTranscriptState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>, boolean] {
  const context = useContext(Context)
  const key = context ? `${context.scope}\0${name}` : name
  const restored = useRef(context?.values.has(key) ?? false).current
  const [value, setValue] = useState<T>(() => restored ? context!.values.get(key) as T : typeof initial === 'function' ? (initial as () => T)() : initial)
  const set = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    setValue(previous => {
      const next = typeof update === 'function' ? (update as (value: T) => T)(previous) : update
      context?.values.set(key, next)
      return next
    })
  }, [context, key])
  return [value, set, restored]
}
