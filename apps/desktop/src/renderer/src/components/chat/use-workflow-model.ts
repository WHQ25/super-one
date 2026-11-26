import { useEffect, useMemo, useState } from 'react'
import { useResolvedWorkflowGraph } from './use-workflow-graph'
import { useWorkflowReplay } from './use-workflow-replay'
import type { ReplayAgentRecord } from './workflow-replay'
import { bindAgentsToDag, buildDag, runtimeStatusFromAgentState, type DagRuntimeAgent } from './workflow-dag'
import {
  detectWorkflowScriptLanguage,
  genericWorkflowAdapter,
} from './workflow-utils'
import type { WorkflowAgentInfo } from './use-workflow-agents'

export function useWorkflowScriptSource({
  script,
  scriptPath,
  transcriptDir,
  scriptCandidates,
  enabled = true,
}: {
  script?: string
  scriptPath?: string
  transcriptDir?: string
  scriptCandidates?: string[]
  enabled?: boolean
}): { source?: string; path?: string } {
  const [loaded, setLoaded] = useState<{ source?: string; path?: string }>({})
  const candidateKey = scriptCandidates?.join('\0') ?? ''

  useEffect(() => {
    if (script || !enabled) {
      setLoaded({})
      return
    }
    let cancelled = false
    const candidates = scriptCandidates?.length
      ? [...new Set(scriptCandidates.filter((p): p is string => Boolean(p)))]
      : genericWorkflowAdapter.resolveScriptCandidates({ scriptPath, transcriptDir })

    const reader = window.app?.readWorkflowScript
    if (candidates.length === 0 || !reader) {
      setLoaded((prev) => (prev.source === undefined && prev.path === undefined ? prev : {}))
      return
    }

    void (async () => {
      for (const path of candidates) {
        const src = await Promise.resolve(reader(path)).catch(() => null)
        if (cancelled) return
        if (typeof src === 'string' && src.length > 0) {
          setLoaded({ source: src, path })
          return
        }
      }
      if (!cancelled) {
        setLoaded((prev) => (prev.source === undefined && prev.path === undefined ? prev : {}))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [candidateKey, enabled, script, scriptPath, transcriptDir])

  return script ? { source: script } : loaded
}

export function useWorkflowModel(
  script: string | undefined,
  agents: WorkflowAgentInfo[],
  options?: {
    supportsJsReplay?: boolean
    supportsStaticGraph?: boolean
  },
) {
  const detectedLanguage = useMemo(
    () => (script ? detectWorkflowScriptLanguage(script) : undefined),
    [script],
  )
  const allowStaticGraph = options?.supportsStaticGraph ?? true
  const allowJsReplay = options?.supportsJsReplay ?? (detectedLanguage === 'javascript')
  const { graph, childScripts } = useResolvedWorkflowGraph(allowStaticGraph ? script : undefined)
  const records = useMemo<ReplayAgentRecord[]>(
    () => agents.map((a) => ({ agentId: a.agentId, prompt: a.prompt, label: a.label, result: a.result, toolCount: a.toolCount })),
    [agents],
  )
  const childWorkflowMap = useMemo(
    () => new Map(childScripts.map((cs) => [cs.scriptPath, { source: cs.source, name: cs.name }])),
    [childScripts],
  )
  const runtimeAgents = useMemo<DagRuntimeAgent[]>(
    () => agents.map((a) => ({
      label: a.label,
      prompt: a.prompt,
      agentId: a.agentId,
      status: runtimeStatusFromAgentState(a.state),
      toolCount: a.toolCount,
    })),
    [agents],
  )
  const replay = useWorkflowReplay(
    script && allowJsReplay ? script : undefined,
    records,
    childWorkflowMap,
  )
  const dag = useMemo(() => {
    if (replay) return replay.dag
    if (!graph || graph.blocks.length === 0) return null
    return buildDag(graph, runtimeAgents.length > 0 ? runtimeAgents : undefined)
  }, [replay, graph, runtimeAgents])
  const nodeToAgent = useMemo(() => {
    if (replay) return replay.nodeAgentIds
    if (!dag) return new Map<string, string>()
    return bindAgentsToDag(dag, agents, dag.nodeAgentIds)
  }, [replay, dag, agents])

  return { graph, childScripts, replay, dag, nodeToAgent }
}
