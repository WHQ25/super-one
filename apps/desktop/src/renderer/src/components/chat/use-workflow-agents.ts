import { useState, useEffect } from 'react'

export interface WorkflowAgentInfo {
  agentId: string
  jsonlPath: string
  label: string
  prompt?: string
  toolCount: number
  tokens?: number
  resultText?: string
  result?: unknown
  /** Live / state.json phase title when known (Grok workflow_updated). */
  phase?: string
  /** Live agent state: running | completed | failed | … */
  state?: string
}

export function useWorkflowAgents(transcriptDir: string | undefined, enabled: boolean, refreshKey?: unknown): WorkflowAgentInfo[] {
  const [agents, setAgents] = useState<WorkflowAgentInfo[]>([])

  useEffect(() => {
    if (!enabled || !transcriptDir) {
      setAgents([])
      return
    }
    let cancelled = false
    Promise.resolve(window.app.listWorkflowAgents?.(transcriptDir)).then((list) => {
      if (!cancelled) setAgents(Array.isArray(list) ? list : [])
    }).catch(() => {
      if (!cancelled) setAgents([])
    })
    return () => { cancelled = true }
  }, [transcriptDir, enabled, refreshKey])

  return agents
}
