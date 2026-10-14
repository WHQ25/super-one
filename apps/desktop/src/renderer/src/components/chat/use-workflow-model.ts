import { useEffect, useMemo, useState } from 'react'
import { useResolvedWorkflowGraph } from './use-workflow-graph'
import { useWorkflowReplay } from './use-workflow-replay'
import type { ReplayAgentRecord } from './workflow-replay'
import { bindAgentsToDag, buildDag, runtimeStatusFromAgentState, type DagRuntimeAgent } from './workflow-dag'
import { looksLikeRhaiWorkflow } from './workflow-graph-rhai'
import { workflowArtifactPath } from './workflow-utils'
import type { WorkflowAgentInfo } from './use-workflow-agents'

/**
 * Workflow script source: the inline script, else the first readable file among
 * the launch's script path and the run directory's script.rhai / script.js.
 */
export function useWorkflowScriptSource({
  script,
  scriptPath,
  transcriptDir,
  enabled = true,
}: {
  script?: string
  scriptPath?: string
  transcriptDir?: string
  enabled?: boolean
}): { source?: string; path?: string } {
  const [loaded, setLoaded] = useState<{ source?: string; path?: string }>({})

  useEffect(() => {
    if (script || !enabled) {
      setLoaded({})
      return
    }
    let cancelled = false
    const candidates = [...new Set([
      scriptPath,
      workflowArtifactPath(transcriptDir, 'script.rhai'),
      workflowArtifactPath(transcriptDir, 'script.js'),
    ].filter((p): p is string => !!p))]

    void (async () => {
      for (const path of candidates) {
        const src = await Promise.resolve(window.app?.readWorkflowScript?.(path)).catch(() => null)
        if (cancelled) return
        if (typeof src === 'string' && src.length > 0) {
          setLoaded({ source: src, path })
          return
        }
      }
      if (!cancelled) setLoaded({})
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, script, scriptPath, transcriptDir])

  return script ? { source: script } : loaded
}

/**
 * Script graph plus run agents bound to its nodes. JS scripts are replayed against
 * the recorded agents (which also resolves child workflows); Rhai cannot execute,
 * so it falls back to the static graph with label/prompt binding.
 */
export function useWorkflowModel(script: string | undefined, agents: WorkflowAgentInfo[]) {
  const { graph, childScripts } = useResolvedWorkflowGraph(script)
  const records = useMemo<ReplayAgentRecord[]>(
    () => agents.map((a) => ({ agentId: a.agentId, prompt: a.prompt, label: a.label, result: a.result, toolCount: a.toolCount })),
    [agents],
  )
  const childWorkflowMap = useMemo(
    () => new Map(childScripts.map((cs) => [cs.scriptPath, { source: cs.source, name: cs.name }])),
    [childScripts],
  )
  // Runtime rows for graph expansion (Grok labels / Claude fan-out without full JS replay).
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
    script && !looksLikeRhaiWorkflow(script) ? script : undefined,
    records,
    childWorkflowMap,
  )
  const dag = useMemo(() => {
    if (replay) return replay.dag
    if (!graph || graph.blocks.length === 0) return null
    // Pass runtime so parallel(catalog:*) expands to one node per live agent.
    return buildDag(graph, runtimeAgents.length > 0 ? runtimeAgents : undefined)
  }, [replay, graph, runtimeAgents])
  const nodeToAgent = useMemo(() => {
    if (replay) return replay.nodeAgentIds
    if (!dag) return new Map<string, string>()
    return bindAgentsToDag(dag, agents, dag.nodeAgentIds)
  }, [replay, dag, agents])

  return { graph, childScripts, replay, dag, nodeToAgent }
}
