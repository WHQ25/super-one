import { useEffect } from 'react'
import {
  useAgentViewfinderStore,
  viewfinderKindForToolName,
} from '@/stores/agent-viewfinder'
import { useBrowserStore } from '@/stores/browser'
import { useComputerViewfinderStore } from '@/stores/computer-viewfinder'

function targetIdFromInput(kind: 'device' | 'browser' | 'computer', input: string): string | null {
  try {
    const parsed = JSON.parse(input) as { tab?: unknown; device?: unknown }
    if (kind === 'browser' && typeof parsed.tab === 'string') return parsed.tab
    if (kind === 'device' && typeof parsed.device === 'string') return parsed.device
  } catch {
    // Streaming tool blocks may briefly carry incomplete JSON. The runtime/claim will
    // refine the target id once it resolves the operation.
  }
  return null
}

/**
 * Bridges the native Computer Use capture stream into renderer state.
 *
 * ScreenCaptureKit stays in the signed helper that already owns macOS recording
 * permission. The visible preview does not: it is rendered by React inside the
 * target session, alongside the browser and device previews.
 */
export function useAgentViewfinder(): void {
  useEffect(() => window.agent.onAgentEvent((event) => {
    const sessionId = event.sessionId
    if (!sessionId) return
    if (event.type === 'status_change' && event.status !== 'streaming') {
      useAgentViewfinderStore.getState().clear(sessionId)
      useBrowserStore.getState().clearAutomationPreview(sessionId)
      void window.app.hideComputerUseViewfinder(sessionId)
      return
    }
    if (event.type !== 'content_delta' || event.delta.type !== 'tool_use') return
    const kind = viewfinderKindForToolName(event.delta.toolName)
    if (!kind) return
    useAgentViewfinderStore.getState().activate(
      sessionId,
      kind,
      targetIdFromInput(kind, event.delta.input),
    )
    // Computer Use's native stream has no visible consumer after another target wins.
    // Stop it immediately instead of continuing JPEG/base64 work until turn cleanup.
    if (kind !== 'computer') void window.app.hideComputerUseViewfinder(sessionId)
  }), [])

  useEffect(() => window.environment.onDeviceViewfinderClaim((claim) => {
    useAgentViewfinderStore.getState().activate(
      claim.sessionId,
      'device',
      claim.deviceId,
    )
    void window.app.hideComputerUseViewfinder(claim.sessionId)
  }), [])

  useEffect(() => window.app.onComputerUseViewfinderClaim((claim) => {
    useComputerViewfinderStore.getState().applyClaim(claim)
    if (claim.active && claim.sessionId && claim.windowId != null) {
      if (useComputerViewfinderStore.getState().hiddenSessions[claim.sessionId]) {
        void window.app.hideComputerUseViewfinder(claim.sessionId)
        return
      }
      useAgentViewfinderStore.getState().activate(
        claim.sessionId,
        'computer',
        String(claim.windowId),
      )
    } else if (claim.sessionId) {
      useAgentViewfinderStore.getState().clear(claim.sessionId, { kind: 'computer' })
    }
  }), [])

  useEffect(() => window.app.onComputerUseViewfinderFrame((frame) => {
    useComputerViewfinderStore.getState().applyFrame(frame)
  }), [])
}
