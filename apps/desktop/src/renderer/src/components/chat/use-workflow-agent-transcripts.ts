import { useEffect, useMemo, useState } from 'react'
import type { WorkflowAgentInfo } from './use-workflow-agents'

export interface ResolvedWorkflowAgentTranscript {
  agentId: string
  jsonlPath: string
  prompt?: string
  toolCount: number
  tokens?: number
  resultText?: string
  transcriptAvailable: true
}

export function useWorkflowAgentTranscripts(
  agents: WorkflowAgentInfo[],
  logPath: string | undefined,
  enabled: boolean,
  refreshKey?: unknown,
): WorkflowAgentInfo[] {
  const [resolved, setResolved] = useState<Record<string, ResolvedWorkflowAgentTranscript>>({})
  const missingIds = useMemo(
    () => agents.filter((a) => !a.jsonlPath && a.agentId).map((a) => a.agentId),
    [agents],
  )
  const missingKey = missingIds.join('\0')

  useEffect(() => {
    const resolver = window.app?.resolveWorkflowAgentTranscripts
    if (!enabled || missingIds.length === 0 || !resolver) {
      setResolved((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      return
    }
    let cancelled = false
    Promise.resolve(resolver({ agentIds: missingIds, logPath }))
      .then((map) => {
        if (!cancelled && map && typeof map === 'object') {
          setResolved(map)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolved((prev) => (Object.keys(prev).length === 0 ? prev : {}))
        }
      })
    return () => {
      cancelled = true
    }
  }, [enabled, logPath, missingKey, refreshKey])

  return useMemo(() => {
    if (Object.keys(resolved).length === 0) return agents
    return agents.map((agent) => {
      const hit = resolved[agent.agentId]
      if (!hit) return agent
      return {
        ...agent,
        jsonlPath: agent.jsonlPath || hit.jsonlPath,
        transcriptAvailable: true,
        prompt: agent.prompt ?? hit.prompt,
        toolCount: agent.toolCount || hit.toolCount,
        tokens: agent.tokens ?? hit.tokens,
        resultText: agent.resultText ?? hit.resultText,
      }
    })
  }, [agents, resolved])
}
