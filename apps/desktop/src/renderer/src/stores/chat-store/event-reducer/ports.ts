import {
  clearStreamingToolInput,
  clearStreamingToolInputsForSession,
  noteStreamingToolInputOwner,
  streamingPreviewLastUpdate,
  streamingToolInputRaw,
} from './shared'

export interface StreamingToolInputStore {
  getRaw(toolUseId: string): string | undefined
  setRaw(toolUseId: string, raw: string): void
  getLastUpdate(toolUseId: string): number | undefined
  setLastUpdate(toolUseId: string, at: number): void
  noteOwner(toolUseId: string, projectPath: string | undefined, sessionId: string | undefined): void
  clear(toolUseId: string): void
  clearForSession(projectPath: string, sessionId: string): void
}

export interface ChatCorePorts {
  now(): number
  id(prefix: string): string
  trace?(channel: string, name: string, payload: unknown): void
  streaming: StreamingToolInputStore
}

export const moduleStreamingStore: StreamingToolInputStore = {
  getRaw: (id) => streamingToolInputRaw.get(id),
  setRaw: (id, raw) => { streamingToolInputRaw.set(id, raw) },
  getLastUpdate: (id) => streamingPreviewLastUpdate.get(id),
  setLastUpdate: (id, at) => { streamingPreviewLastUpdate.set(id, at) },
  noteOwner: noteStreamingToolInputOwner,
  clear: clearStreamingToolInput,
  clearForSession: clearStreamingToolInputsForSession,
}

export const defaultChatCorePorts: ChatCorePorts = {
  now: () => Date.now(),
  id: (prefix) => `${prefix}${Date.now().toString(36)}`,
  trace: (channel, name, payload) => {
    const w = globalThis as { window?: { app?: { trace?: (c: string, n: string, p: unknown) => void } } }
    w.window?.app?.trace?.(channel, name, payload)
  },
  streaming: moduleStreamingStore,
}
