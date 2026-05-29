import { useState, useEffect } from 'react'

export interface WorkflowOutputEnvelope {
  summary?: string
  agentCount?: number
  logs: string[]
  result?: unknown
}

export function useWorkflowOutput(outputFile: string | undefined, enabled: boolean): WorkflowOutputEnvelope | null {
  const [output, setOutput] = useState<WorkflowOutputEnvelope | null>(null)

  useEffect(() => {
    if (!enabled || !outputFile) {
      setOutput(null)
      return
    }
    let cancelled = false
    Promise.resolve(window.app.readWorkflowOutput?.(outputFile)).then((o) => {
      if (!cancelled) setOutput(o ?? null)
    }).catch(() => {
      if (!cancelled) setOutput(null)
    })
    return () => { cancelled = true }
  }, [outputFile, enabled])

  return output
}
