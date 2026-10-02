import { create } from 'zustand'
import type { McpAppApprovalPrompt } from '@superone/shared/mcp-apps'

export type McpAppConsentValue = Record<string, never> | null
export interface PendingMcpConsent { id: string; sessionId: string; prompt: McpAppApprovalPrompt; finish(value: McpAppConsentValue): void }

/**
 * App message approvals belong to the session the View lives in, not to the View:
 * whichever composer slot shows that session asks, oldest first.
 */
export const useMcpAppConsents = create<{ pending: PendingMcpConsent[] }>(() => ({ pending: [] }))

export function requestMcpAppConsent(sessionId: string, prompt: McpAppApprovalPrompt, signal: AbortSignal): Promise<McpAppConsentValue> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(null); return }
    const id = crypto.randomUUID()
    const finish = (value: McpAppConsentValue) => {
      signal.removeEventListener('abort', abort)
      useMcpAppConsents.setState(state => ({ pending: state.pending.filter(item => item.id !== id) }))
      resolve(value)
    }
    const abort = () => finish(null)
    signal.addEventListener('abort', abort, { once: true })
    useMcpAppConsents.setState(state => ({ pending: [...state.pending, { id, sessionId, prompt, finish }] }))
  })
}

export function useHasMcpAppConsent(sessionId: string | null | undefined): boolean {
  return useMcpAppConsents(state => !!sessionId && state.pending.some(item => item.sessionId === sessionId))
}
