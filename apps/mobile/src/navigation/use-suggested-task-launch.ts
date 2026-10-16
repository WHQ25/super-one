import { useEffect, useState } from 'react'
import { createSuggestedTaskActions, type SuggestedTaskLaunchRequest } from '../suggested-task-actions'

/** A native config surface captures its source session while the user edits. */
export function useSuggestedTaskLaunch(context: Parameters<typeof createSuggestedTaskActions>[0], ownerKey: string) {
  const [request, setRequest] = useState<SuggestedTaskLaunchRequest | null>(null)
  useEffect(() => { setRequest(null) }, [ownerKey])
  return {
    actions: createSuggestedTaskActions(context, setRequest),
    sheet: request ? { request, onDismiss: () => setRequest(current => current === request ? null : current) } : null,
  }
}
