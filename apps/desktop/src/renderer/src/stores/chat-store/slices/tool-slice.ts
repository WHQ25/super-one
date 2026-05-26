import type { StateCreator } from 'zustand'
import type { ChatStore, ToolRendererState } from '../types'

/**
 * Subset of ChatStore concerned with the global tool-intercept renderer
 * machinery: `toolRenderers` (MCP callId → renderer state), the standalone
 * tool-call routing table (`_pendingStandaloneCalls`), and the live bash
 * output buffer (`_bashOutputs`). All three are global rather than
 * per-session.
 *
 * Self-contained: actions only touch state owned by this slice, so it
 * composes cleanly with the rest of useChatStore via spread.
 */
export interface ToolSlice {
  toolRenderers: Record<string, ToolRendererState>
  _pendingStandaloneCalls: Record<string, { callId: string; appId: string; projectDir: string; toolName: string; arguments: Record<string, unknown> }>
  _bashOutputs: Record<string, { content: string; finished: boolean; outputPath?: string }>

  openToolIntercept: (state: ToolRendererState) => void
  submitToolIntercept: (callId: string, userInput: Record<string, unknown>) => void
  cancelToolIntercept: (callId: string, reason?: string) => void
  clearToolIntercepts: (callIds: string[]) => void

  mapStandaloneCall: (
    toolUseId: string,
    payload: { callId: string; appId: string; projectDir: string; toolName: string; arguments: Record<string, unknown> },
  ) => void
}

export const createToolSlice: StateCreator<ChatStore, [], [], ToolSlice> = (set, get) => ({
  toolRenderers: {},
  _pendingStandaloneCalls: {},
  _bashOutputs: {},

  openToolIntercept: (state) =>
    set((s) => ({ toolRenderers: { ...s.toolRenderers, [state.callId]: state } })),

  submitToolIntercept: (callId, userInput) => {
    const current = get().toolRenderers[callId]
    if (!current || current.status !== 'awaiting') return
    set((s) => {
      const next = { ...s.toolRenderers }
      delete next[callId]
      return { toolRenderers: next }
    })
    window.app.submitToolIntercept?.(callId, userInput)
  },

  cancelToolIntercept: (callId, reason) => {
    const current = get().toolRenderers[callId]
    if (!current || current.status !== 'awaiting') return
    set((s) => {
      const next = { ...s.toolRenderers }
      delete next[callId]
      return { toolRenderers: next }
    })
    window.app.cancelToolIntercept?.(callId, reason)
  },

  clearToolIntercepts: (callIds: string[]) => set((s) => {
    if (callIds.length === 0) return s
    const next = { ...s.toolRenderers }
    for (const id of callIds) delete next[id]
    return { toolRenderers: next }
  }),

  mapStandaloneCall: (toolUseId, payload) => set((s) => ({
    _pendingStandaloneCalls: { ...s._pendingStandaloneCalls, [toolUseId]: payload },
  })),
})
