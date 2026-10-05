import { create } from 'zustand'
import type { SessionWriteTarget } from '../types'

type Entry = { owner: SessionWriteTarget; requestId: string; message: string }
export const useInputRequestErrors = create<{ entries: Record<string, Entry> }>(() => ({ entries: {} }))
export function inputRequestErrorKey(owner: SessionWriteTarget, requestId: string) { return JSON.stringify([owner.projectPath, owner.sessionId, requestId]) }
export function setInputRequestError(owner: SessionWriteTarget, requestId: string, message?: string) {
  const key = inputRequestErrorKey(owner, requestId)
  useInputRequestErrors.setState(state => {
    const entries = { ...state.entries }
    if (message) entries[key] = { owner, requestId, message }
    else delete entries[key]
    return { entries }
  })
}
