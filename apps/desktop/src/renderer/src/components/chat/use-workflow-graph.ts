import { useState, useEffect, useMemo } from 'react'
import { parseWorkflowGraph, attachWorkflowChildren, type WorkflowGraph } from './workflow-graph'

export interface ChildWorkflowScript {
  name?: string
  scriptPath: string
  source: string
}

export interface ResolvedWorkflow {
  graph: WorkflowGraph | null
  childScripts: ChildWorkflowScript[]
}

function childScriptPaths(graph: WorkflowGraph): string[] {
  return graph.blocks.flatMap((b) => (b.kind === 'workflow' && b.scriptPath ? [b.scriptPath] : []))
}

function collectChildScripts(
  graph: WorkflowGraph,
  scripts: Map<string, string>,
  seen: Set<string>,
  out: ChildWorkflowScript[],
): void {
  for (const block of graph.blocks) {
    if (block.kind !== 'workflow' || !block.scriptPath || seen.has(block.scriptPath)) continue
    seen.add(block.scriptPath)
    const source = scripts.get(block.scriptPath)
    if (!source) continue
    out.push({ name: block.name, scriptPath: block.scriptPath, source })
    if (block.child) collectChildScripts(block.child, scripts, seen, out)
  }
}

export function useResolvedWorkflowGraph(script: string | undefined): ResolvedWorkflow {
  const root = useMemo(() => (script ? parseWorkflowGraph(script) : null), [script])
  const [scripts, setScripts] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (!root) {
      setScripts(new Map())
      return
    }
    let cancelled = false
    const resolve = async (): Promise<void> => {
      const map = new Map<string, string>()
      const visited = new Set<string>()
      let frontier = childScriptPaths(root)
      let depth = 0
      while (frontier.length > 0 && depth < 5) {
        const next: string[] = []
        for (const path of frontier) {
          if (visited.has(path)) continue
          visited.add(path)
          const src = await Promise.resolve(window.app.readWorkflowScript?.(path)).catch(() => null)
          if (typeof src === 'string') {
            map.set(path, src)
            next.push(...childScriptPaths(parseWorkflowGraph(src)))
          }
        }
        frontier = next
        depth++
      }
      if (!cancelled) setScripts(map)
    }
    void resolve()
    return () => {
      cancelled = true
    }
  }, [root])

  return useMemo(() => {
    if (!root) return { graph: null, childScripts: [] }
    const childScripts: ChildWorkflowScript[] = []
    collectChildScripts(root, scripts, new Set(), childScripts)
    return { graph: attachWorkflowChildren(root, scripts), childScripts }
  }, [root, scripts])
}
