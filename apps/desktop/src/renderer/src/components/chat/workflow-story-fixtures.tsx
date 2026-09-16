import { useEffect } from 'react'
import { useChatStore } from '@/stores/chat'

export interface SeedTaskProgressValue {
  completed: boolean
  description: string
  lastToolName?: string
  toolUses: number
  totalTokens: number
  durationMs?: number
  workflowAgents?: Array<{ agentId?: string; label: string; toolCount: number; state?: string }>
}

/** Seed `taskProgress[toolUseId]` on the active story session so workflow blocks see live progress. */
export function SeedTaskProgress({
  toolUseId,
  progress,
}: {
  toolUseId: string
  progress: SeedTaskProgressValue | null
}) {
  useEffect(() => {
    const apply = (): void => {
      useChatStore.setState((s) => {
        const projectId = s.activeProject
        if (!projectId) return s
        const project = s.projectSessions[projectId]
        if (!project) return s
        const sid = project._activeSessionId
        if (!sid) return s
        const session = project._sessions[sid]
        if (!session) return s
        const taskProgress = { ...session.taskProgress }
        if (progress) taskProgress[toolUseId] = progress as never
        else delete taskProgress[toolUseId]
        return {
          projectSessions: {
            ...s.projectSessions,
            [projectId]: {
              ...project,
              _sessions: { ...project._sessions, [sid]: { ...session, taskProgress } },
            },
          },
        }
      })
    }
    apply()
    const t = setTimeout(apply, 0)
    return () => clearTimeout(t)
  }, [toolUseId, progress])
  return null
}
