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
}
