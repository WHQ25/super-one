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

interface StreamingToolInputState {
  rawByTool: Map<string, string>
  lastUpdateByTool: Map<string, number>
  ownerByTool: Map<string, { projectPath: string; sessionId: string }>
}

function createStreamingToolInputState(): StreamingToolInputState {
  return {
    rawByTool: new Map(),
    lastUpdateByTool: new Map(),
    ownerByTool: new Map(),
  }
}

export function createStreamingToolInputStore(
  state: StreamingToolInputState = createStreamingToolInputState(),
): StreamingToolInputStore {
  const { rawByTool, lastUpdateByTool, ownerByTool } = state

  const clear = (toolUseId: string): void => {
    rawByTool.delete(toolUseId)
    lastUpdateByTool.delete(toolUseId)
    ownerByTool.delete(toolUseId)
  }

  return {
    getRaw: (id) => rawByTool.get(id),
    setRaw: (id, raw) => { rawByTool.set(id, raw) },
    getLastUpdate: (id) => lastUpdateByTool.get(id),
    setLastUpdate: (id, at) => { lastUpdateByTool.set(id, at) },
    noteOwner: (id, projectPath, sessionId) => {
      if (projectPath && sessionId) ownerByTool.set(id, { projectPath, sessionId })
    },
    clear,
    clearForSession: (projectPath, sessionId) => {
      for (const [id, owner] of ownerByTool) {
        if (owner.projectPath === projectPath && owner.sessionId === sessionId) clear(id)
      }
    },
  }
}

const moduleStreamingState = createStreamingToolInputState()

/** Stable test/compatibility handles for the default port-owned store. */
export const streamingToolInputRaw = moduleStreamingState.rawByTool
export const streamingPreviewLastUpdate = moduleStreamingState.lastUpdateByTool
export const streamingToolInputOwners = moduleStreamingState.ownerByTool

export const moduleStreamingStore = createStreamingToolInputStore(moduleStreamingState)

export function clearStreamingToolInput(toolUseId: string): void {
  moduleStreamingStore.clear(toolUseId)
}

export function clearStreamingToolInputsForSession(projectPath: string, sessionId: string): void {
  moduleStreamingStore.clearForSession(projectPath, sessionId)
}

export const defaultChatCorePorts: ChatCorePorts = {
  now: () => Date.now(),
  id: (prefix) => `${prefix}${Date.now().toString(36)}`,
  streaming: moduleStreamingStore,
}
