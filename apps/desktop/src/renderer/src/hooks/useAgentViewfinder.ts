import { useCallback, useEffect, useRef } from 'react'
import type { ComputerUseViewfinderClaim } from '@superone/shared/agent-types'
import {
  useAgentViewfinderStore,
  selectViewfinderTarget,
  viewfinderKindForToolName,
  type ViewfinderKind,
} from '@/stores/agent-viewfinder'
import { useBrowserStore } from '@/stores/browser'
import { useComputerViewfinderStore } from '@/stores/computer-viewfinder'
import { isMiniAppTargetId } from '@superone/shared/miniapp-automation-target'
import { useMiniAppPipStore } from '@/stores/miniapp-pip'
import { useChatStore } from '@/stores/chat'
import { selectActiveChatSessionId } from '@/stores/chat-store/selectors'

function targetIdFromInput(kind: ViewfinderKind, input: string): string | null {
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
  const sessionId = useChatStore(selectActiveChatSessionId)
  const activeTarget = useAgentViewfinderStore((state) => selectViewfinderTarget(state, sessionId))
  const versions = useRef(new Map<string, number>())
  const resetVersion = useRef(0)
  const endedSessions = useRef(new Set<string>())
  const changed = useCallback((sessionId: string) => {
    versions.current.set(sessionId, (versions.current.get(sessionId) ?? 0) + 1)
  }, [])
  const applyComputerClaim = useCallback((claim: ComputerUseViewfinderClaim) => {
    useComputerViewfinderStore.getState().applyClaim(claim)
    if (claim.active && claim.sessionId && claim.windowId != null) {
      if (useComputerViewfinderStore.getState().hiddenSessions[claim.sessionId]) {
        void window.app.hideComputerUseViewfinder(claim.sessionId)
        return
      }
      useAgentViewfinderStore.getState().activate(claim.sessionId, 'computer', String(claim.windowId))
    } else if (claim.sessionId) {
      useAgentViewfinderStore.getState().clear(claim.sessionId, { kind: 'computer' })
    }
  }, [])

  useEffect(() => window.agent.onAgentEvent((event) => {
    const sessionId = event.sessionId
    if (!sessionId) return
    if (event.type === 'status_change' && event.status !== 'streaming') {
      endedSessions.current.add(sessionId)
      changed(sessionId)
      useAgentViewfinderStore.getState().clear(sessionId)
      useBrowserStore.getState().clearAutomationPreview(sessionId)
      useMiniAppPipStore.getState().clearHidden(sessionId)
      void window.app.hideComputerUseViewfinder(sessionId)
      return
    }
    if (event.type !== 'content_delta' || event.delta.type !== 'tool_use') return
    const kind = viewfinderKindForToolName(event.delta.toolName)
    if (!kind) return
    const targetId = targetIdFromInput(kind, event.delta.input)
    // A mini-app view has no browser tab to preview; the runtime claims the
    // viewfinder for it once it knows whether the view lives in chat or the dock.
    if (isMiniAppTargetId(targetId)) return
    // Browser tools drive mini-app views too: a target not parsed yet must not
    // blank the mini-app preview between two calls on it.
    const current = useAgentViewfinderStore.getState().activeBySession[sessionId]
    if (kind === 'browser' && targetId == null && current?.kind === 'miniapp') return
    endedSessions.current.delete(sessionId)
    changed(sessionId)
    useAgentViewfinderStore.getState().activate(sessionId, kind, targetId)
    // Computer Use's native stream has no visible consumer after another target wins.
    // Stop it immediately instead of continuing JPEG/base64 work until turn cleanup.
    if (kind !== 'computer') void window.app.hideComputerUseViewfinder(sessionId)
  }), [changed])

  useEffect(() => window.environment.onDeviceViewfinderClaim((claim) => {
    endedSessions.current.delete(claim.sessionId)
    changed(claim.sessionId)
    useAgentViewfinderStore.getState().activate(
      claim.sessionId,
      'device',
      claim.deviceId,
    )
    void window.app.hideComputerUseViewfinder(claim.sessionId)
  }), [changed])

  useEffect(() => window.app.onComputerUseViewfinderClaim((claim) => {
    if (claim.active) endedSessions.current.delete(claim.sessionId)
    if (claim.sessionId) changed(claim.sessionId)
    else resetVersion.current += 1
    applyComputerClaim(claim)
  }), [applyComputerClaim, changed])

  useEffect(() => window.app.onComputerUseViewfinderFrame((frame) => {
    useComputerViewfinderStore.getState().applyFrame(frame)
  }), [])

  useEffect(() => {
    if (!sessionId || endedSessions.current.has(sessionId) || (activeTarget && activeTarget.kind !== 'computer')
      || useComputerViewfinderStore.getState().targets[sessionId]) return
    let cancelled = false
    const version = versions.current.get(sessionId)
    const reset = resetVersion.current
    // Subscribe first, then read. A live claim/release or a turn ending always
    // outranks the snapshot, including a release that leaves both stores empty.
    void window.app.getComputerUseViewfinderTarget(sessionId).then((claim) => {
      if (cancelled || !claim?.active || claim.sessionId !== sessionId
        || versions.current.get(sessionId) !== version || resetVersion.current !== reset
        || selectActiveChatSessionId(useChatStore.getState()) !== sessionId
        || selectViewfinderTarget(useAgentViewfinderStore.getState(), sessionId) !== activeTarget) return
      applyComputerClaim(claim)
    }).catch((error: unknown) => {
      if (!cancelled) console.warn('[computer-pip] Could not restore current target', error)
    })
    return () => { cancelled = true }
  }, [sessionId, activeTarget, applyComputerClaim])
}
