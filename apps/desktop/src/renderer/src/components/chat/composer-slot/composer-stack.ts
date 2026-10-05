import { create } from 'zustand'
import { useChatStore, type SessionWriteTarget } from '@/stores/chat'

export type ComposerValue = Readonly<Record<string, unknown>>
export type ComposerLifetime = 'once' | 'sticky'

export interface ComposerHandle {
  key: string
  id: string
  target: SessionWriteTarget
  lifetime: ComposerLifetime
}

export interface ComposerEntry extends ComposerHandle { value: ComposerValue }

interface SessionComposerStack {
  base: ComposerEntry | null
  stack: readonly ComposerEntry[]
}

export interface OpenComposerOptions {
  lifetime?: ComposerLifetime
  prefill?: ComposerValue
  signal?: AbortSignal
}

const EMPTY_STACK: SessionComposerStack = { base: null, stack: [] }
const sessionKey = ({ projectPath, sessionId }: SessionWriteTarget) => JSON.stringify([projectPath, sessionId])
export const useComposerStacks = create<{ sessions: Readonly<Record<string, SessionComposerStack>> }>(() => ({ sessions: {} }))
const pending = new Map<string, { resolve: (value: ComposerValue | null) => void; cleanup: () => void; settled: boolean }>()
let stopWatchingSessions: (() => void) | undefined

export function composerStackFor(target: SessionWriteTarget, state = useComposerStacks.getState()): SessionComposerStack {
  return state.sessions[sessionKey(target)] ?? EMPTY_STACK
}

export function topComposer(target: SessionWriteTarget, state = useComposerStacks.getState()): ComposerEntry | null {
  const { base, stack } = composerStackFor(target, state)
  return stack.at(-1) ?? base
}

function writeStack(target: SessionWriteTarget, stack: SessionComposerStack) {
  useComposerStacks.setState(state => {
    const sessions = { ...state.sessions }
    if (!stack.base && !stack.stack.length) delete sessions[sessionKey(target)]
    else sessions[sessionKey(target)] = stack
    return { sessions }
  })
  if (!Object.keys(useComposerStacks.getState().sessions).length) {
    stopWatchingSessions?.()
    stopWatchingSessions = undefined
  }
}

function settle(key: string, value: ComposerValue | null, close = true) {
  const request = pending.get(key)
  if (!request) return
  if (close) {
    pending.delete(key)
    request.cleanup()
  }
  if (!request.settled) {
    request.settled = true
    request.resolve(value)
  }
}

export function cancelComposer(entry: ComposerHandle) {
  finishComposer(entry, null)
}

export function submitComposer(entry: ComposerHandle, value: ComposerValue) {
  const current = composerStackFor(entry.target)
  if (current.base?.key !== entry.key && !current.stack.some(item => item.key === entry.key)) return
  // A sticky mode stays visible after its first result has returned to the caller.
  if (entry.lifetime === 'once') finishComposer(entry, value)
  else settle(entry.key, value, false)
}

function finishComposer(entry: ComposerHandle, value: ComposerValue | null) {
  const current = composerStackFor(entry.target)
  writeStack(entry.target, {
    base: current.base?.key === entry.key ? null : current.base,
    stack: current.stack.filter(item => item.key !== entry.key),
  })
  settle(entry.key, value)
}

export function updateComposerValue(entry: ComposerHandle, value: ComposerValue) {
  const current = composerStackFor(entry.target)
  if (current.base?.key !== entry.key && !current.stack.some(item => item.key === entry.key)) return
  const update = (item: ComposerEntry) => item.key === entry.key ? { ...item, value } : item
  writeStack(entry.target, { base: current.base && update(current.base), stack: current.stack.map(update) })
}

export function clearSessionComposers(target: SessionWriteTarget) {
  const { base, stack } = composerStackFor(target)
  writeStack(target, EMPTY_STACK)
  for (const entry of [...stack, ...(base ? [base] : [])]) settle(entry.key, null)
}

export function removeRegisteredComposer(id: string) {
  for (const { base, stack } of Object.values(useComposerStacks.getState().sessions)) {
    for (const entry of [...stack, ...(base ? [base] : [])]) {
      if (entry.id === id) cancelComposer(entry)
    }
  }
}

/** Internal registry boundary: callers open registered composers through composerForSession. */
export function pushComposer(target: SessionWriteTarget, id: string, options: OpenComposerOptions = {}): Promise<ComposerValue | null> {
  const owner = { ...target }
  if (!useChatStore.getState().projectSessions[owner.projectPath]?._sessions[owner.sessionId]) {
    return Promise.reject(new Error('Cannot open a composer for a missing session'))
  }
  if (options.signal?.aborted) return Promise.resolve(null)
  if (options.lifetime === 'sticky') {
    const previous = composerStackFor(owner).base
    if (previous) cancelComposer(previous)
  }
  // Switching the visible session preserves its stack; deleting its owner cancels it.
  stopWatchingSessions ??= useChatStore.subscribe((state, previous) => {
    if (state.projectSessions === previous.projectSessions) return
    for (const { base, stack } of Object.values(useComposerStacks.getState().sessions)) {
      const entry = base ?? stack[0]
      if (entry && !state.projectSessions[entry.target.projectPath]?._sessions[entry.target.sessionId]) {
        clearSessionComposers(entry.target)
      }
    }
  })
  const entry: ComposerEntry = {
    key: crypto.randomUUID(), id, target: owner,
    lifetime: options.lifetime ?? 'once', value: { ...options.prefill },
  }
  return new Promise(resolve => {
    const abort = () => cancelComposer(entry)
    const signal = options.signal
    signal?.addEventListener('abort', abort, { once: true })
    pending.set(entry.key, { resolve, cleanup: () => signal?.removeEventListener('abort', abort), settled: false })
    const current = composerStackFor(owner)
    writeStack(owner, entry.lifetime === 'sticky'
      ? { ...current, base: entry }
      : { ...current, stack: [...current.stack, entry] })
  })
}
