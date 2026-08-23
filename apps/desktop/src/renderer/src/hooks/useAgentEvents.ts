import { useEffect } from 'react'
import { _loadDefaultSessionPrefs, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import type { AgentEvent } from '@superone/shared/agent-types'
import { buildToolRendererUrl } from '@superone/shared/miniapp-types'
import { buildMiniAppUrlHost } from '@superone/shared/miniapp-url'
import { coalesceAgentEventBatch } from '@/lib/agent-event-batcher'

export function useAgentEvents(): void {
  const handleAgentEvent = useChatStore((s) => s.handleAgentEvent)

  useEffect(() => {
    let hydrated = false
    let disposed = false
    const buffer: AgentEvent[] = []
    const cleanup = window.agent.onAgentEvent((event) => {
      if (disposed) return
      if (!hydrated) {
        buffer.push(event as AgentEvent)
        return
      }
      handleAgentEvent(event as AgentEvent)
    })
    void _loadDefaultSessionPrefs().then(() => useChatStore.getState().syncLiveSnapshots()).finally(() => {
      hydrated = true
      if (disposed) return
      for (const ev of coalesceAgentEventBatch(buffer)) handleAgentEvent(ev)
      buffer.length = 0
    })
    return () => {
      disposed = true
      cleanup()
    }
  }, [handleAgentEvent])

  // Remote reconnect: re-sync from the node, then re-own event drains.
  // Resuming alone is not enough — drains restart at the current log head, so
  // anything the node appended while offline would never reach the store.
  useEffect(() => {
    const unsub = window.environment?.onStatusEvent?.((snapshot: {
      connectionId?: string
      state?: string
    }) => {
      if (snapshot?.state !== 'connected' || !snapshot.connectionId) return
      const connectionId = snapshot.connectionId
      void (async () => {
        const { rehydrateRemoteSessionsForConnection } = await import(
          '@/stores/chat-store/helpers/remote-reconnect'
        )
        await rehydrateRemoteSessionsForConnection(
          connectionId,
          useChatStore.setState,
          useChatStore.getState,
        )
      })()
    })
    return () => {
      unsub?.()
    }
  }, [])

  useEffect(() => {
    const cleanup = window.app.onBashOutputEvent((event) => {
      useChatStore.setState((s) => ({
        _bashOutputs: { ...s._bashOutputs, [event.toolUseId]: { content: event.content, finished: event.finished, outputPath: s._bashOutputs[event.toolUseId]?.outputPath } },
      }))
    })
    return cleanup
  }, [])

  useEffect(() => {
    const cleanup = window.app.onToolInterceptOpen?.((req) => {
      const openApps = useMiniAppStore.getState().openApps
      const instance = Object.values(openApps).find(
        (v) => v.entry.id === req.appId && v.projectDir === req.projectDir,
      )
      const projectId = instance?.projectId ?? useAppStore.getState().currentProjectId
      const host = buildMiniAppUrlHost(req.appId, projectId)
      const templateUrl = buildToolRendererUrl('intercept', host, req.templatePath, req.callId, req.toolName, req.agentInput ?? {})
      const toolUseId = findToolUseIdForIntercept(req.appId, req.toolName)
      useChatStore.getState().openToolIntercept({
        callId: req.callId,
        appId: req.appId,
        toolName: req.toolName,
        toolUseId,
        templateUrl,
        agentInput: req.agentInput,
        status: 'awaiting',
      })
    })
    return cleanup
  }, [])

  useEffect(() => {
    const cleanup = window.app.onToolInterceptClear?.((_projectDir, callIds) => {
      useChatStore.getState().clearToolIntercepts(callIds)
    })
    return cleanup
  }, [])
}

function findToolUseIdForIntercept(appId: string, toolName: string): string | null {
  const state = useChatStore.getState()
  const activeProject = state.activeProject
  if (!activeProject) return null
  const project = state.projectSessions[activeProject]
  const sessionId = project?._activeSessionId
  if (!project || !sessionId) return null
  const session = project._sessions[sessionId]
  if (!session) return null

  const legacyName = `mcp__superone__${appId}__${toolName}`
  const fixedName = 'mcp__superone__miniapp_call'
  const resultedIds = new Set<string>()
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const content = session.messages[i].content
    if (!content) continue
    for (const block of content) {
      if (block.type === 'tool_result') resultedIds.add(block.toolUseId)
    }
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j]
      if (block.type !== 'tool_use' || resultedIds.has(block.toolUseId)) continue
      if (block.toolName === legacyName) return block.toolUseId
      if (block.toolName === fixedName) {
        try {
          const input = JSON.parse(block.input) as Record<string, unknown>
          if (input.appId === appId && input.tool === toolName) return block.toolUseId
        } catch { /* ignore partial JSON */ }
      }
    }
  }
  return null
}
