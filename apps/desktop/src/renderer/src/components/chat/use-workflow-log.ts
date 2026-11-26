import { useEffect, useState } from 'react'

const WORKFLOW_LOG_TAIL_LINES = 5000

export function useWorkflowLog(
  logPath: string | undefined,
  enabled: boolean,
  refreshKey?: unknown,
): string | null {
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !logPath) {
      setContent(null)
      return
    }
    let cancelled = false
    Promise.resolve(window.app?.readBashOutputFile?.(logPath, WORKFLOW_LOG_TAIL_LINES))
      .then((raw) => {
        if (!cancelled) setContent(typeof raw === 'string' && raw.length > 0 ? raw : null)
      })
      .catch(() => {
        if (!cancelled) setContent(null)
      })
    return () => {
      cancelled = true
    }
  }, [logPath, enabled, refreshKey])

  return content
}
