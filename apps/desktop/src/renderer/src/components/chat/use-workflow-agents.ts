import { useState, useEffect } from 'react'
import type { WorkflowAgentRow } from '@superone/shared/agent-types'

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

/**
 * Overlay live rows (Grok `workflow_updated`) on the agents read from disk: live
 * state wins, disk keeps the transcript-derived counts. Without disk rows the live
 * rows stand alone.
 */
export function mergeLiveWorkflowAgents(
  diskAgents: WorkflowAgentInfo[],
  liveRows: WorkflowAgentRow[] | undefined,
): WorkflowAgentInfo[] {
  if (!liveRows?.length) return diskAgents
  if (diskAgents.length === 0) {
    return liveRows.map((a, i) => ({
      agentId: a.agentId ?? `live-${a.label}-${i}`,
      jsonlPath: '',
      label: a.label,
      toolCount: a.toolCount,
      tokens: a.tokens,
      phase: a.phase,
      state: a.state,
    }))
  }
  return diskAgents.map((a) => {
    const live = liveRows.find((r) => (r.agentId && r.agentId === a.agentId) || r.label === a.label)
    if (!live) return a
    return {
      ...a,
      phase: a.phase ?? live.phase,
      state: live.state ?? a.state,
      tokens: a.tokens ?? live.tokens,
      toolCount: a.toolCount || live.toolCount,
    }
  })
}
