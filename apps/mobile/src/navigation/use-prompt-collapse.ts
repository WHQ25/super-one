import { useCallback, useState } from 'react'
import { collapsePrompt, expandPrompt } from '../pending-prompt-state'

/**
 * Which pending prompts the user has put away. Keyed by request id, so a new
 * request always arrives as a sheet even while an older one waits in a strip,
 * and a resolved request simply stops matching anything.
 */
export function usePromptCollapse() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const collapse = useCallback((requestId: string) => setCollapsed((current) => collapsePrompt(current, requestId)), [])
  const expand = useCallback((requestId: string) => setCollapsed((current) => expandPrompt(current, requestId)), [])
  const reset = useCallback(() => setCollapsed((current) => current.size ? new Set() : current), [])
  return { collapsed, collapse, expand, reset }
}
