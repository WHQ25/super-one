import { useEffect } from 'react'
import { useChatStore } from '@/stores/chat'
import type { AgentEvent } from '../../../shared/agent-types'

export function useAgentEvents(): void {
  const handleAgentEvent = useChatStore((s) => s.handleAgentEvent)

  useEffect(() => {
    const cleanup = window.agent.onAgentEvent((event) => {
      handleAgentEvent(event as AgentEvent)
    })
    return cleanup
  }, [handleAgentEvent])

  useEffect(() => {
    const cleanup = window.app.onBashOutputEvent((event) => {
      useChatStore.setState((s) => ({
        _bashOutputs: { ...s._bashOutputs, [event.toolUseId]: { content: event.content, finished: event.finished, outputPath: s._bashOutputs[event.toolUseId]?.outputPath } },
      }))
    })
    return cleanup
  }, [])
}
