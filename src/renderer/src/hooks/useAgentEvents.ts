import { useEffect } from 'react'
import { useChatStore } from '@/stores/chat'
import type { AgentEvent } from '../../../shared/agent-types'
import { buildToolRendererUrl } from '../../../shared/miniapp-types'

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
    void useChatStore.getState().syncLiveSnapshots().finally(() => {
      hydrated = true
      if (disposed) return
      for (const ev of buffer) {
        try { handleAgentEvent(ev) } catch (err) { console.warn('[useAgentEvents] flush error:', err) }
      }
      buffer.length = 0
    })
    return () => {
      disposed = true
      cleanup()
    }
  }, [handleAgentEvent])

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
      const templateUrl = buildToolRendererUrl('intercept', req.appId, req.templatePath, req.callId, req.toolName, req.agentInput ?? {})
      const toolUseId = findToolUseIdForIntercept(req.toolSlug, req.toolName)
      useChatStore.getState().openToolIntercept({
        callId: req.callId,
        appId: req.appId,
        toolSlug: req.toolSlug,
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
    const cleanup = window.app.onToolInterceptClearAll?.(() => {
      useChatStore.getState().clearAllToolIntercepts()
    })
    return cleanup
  }, [])
}

function findToolUseIdForIntercept(toolSlug: string, toolName: string): string | null {
  const state = useChatStore.getState()
  const activeProject = state.activeProject
  if (!activeProject) return null
  const project = state.projectSessions[activeProject]
  const sessionId = project?._activeSessionId
  if (!project || !sessionId) return null
  const session = project._sessions[sessionId]
  if (!session) return null

  const fullName = `mcp__superone__${toolSlug}__${toolName}`
  const resultedIds = new Set<string>()
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const content = session.messages[i].content
    if (!content) continue
    for (const block of content) {
      if (block.type === 'tool_result') resultedIds.add(block.toolUseId)
    }
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j]
      if (block.type === 'tool_use' && block.toolName === fullName && !resultedIds.has(block.toolUseId)) {
        return block.toolUseId
      }
    }
  }
  return null
}
