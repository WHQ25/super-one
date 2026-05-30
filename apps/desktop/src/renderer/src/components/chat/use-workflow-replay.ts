import { useState, useEffect } from 'react'
import { replayWorkflowDag, type ReplayResult, type ReplayAgentRecord, type ChildWorkflow } from './workflow-replay'

export function useWorkflowReplay(
  script: string | undefined,
  records: ReplayAgentRecord[],
  childScripts: Map<string, ChildWorkflow>,
): ReplayResult | null {
  const [result, setResult] = useState<ReplayResult | null>(null)

  useEffect(() => {
    if (!script || records.length === 0) {
      setResult(null)
      return
    }
    let cancelled = false
    replayWorkflowDag(script, records, childScripts)
      .then((r) => {
        if (!cancelled) setResult(r)
      })
      .catch(() => {
        if (!cancelled) setResult(null)
      })
    return () => {
      cancelled = true
    }
  }, [script, records, childScripts])

  return result
}
