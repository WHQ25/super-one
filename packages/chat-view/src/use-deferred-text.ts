import { useEffect, useState } from 'react'
import { useDetailScope } from './detail-scope'

/** The joined detail text of `references` once `expanded`, through the surrounding detail scope. */
export function useDeferredText(references: string[] | undefined, expanded: boolean, complete = false) {
  const scope = useDetailScope()
  const [attempt, setAttempt] = useState(0)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const key = JSON.stringify(references ?? [])
  useEffect(() => {
    if (!expanded || !references?.length || !scope) return
    setLoading(true)
    setError('')
    return scope.client.open(
      references.map((detailRef) => ({ environmentId: scope.environmentId, sessionId: scope.sessionId, detailRef })),
      { complete, onText: setText, onError: setError, onSettled: () => setLoading(false) },
    )
  }, [expanded, key, complete, attempt, scope?.client, scope?.environmentId, scope?.sessionId])
  return { text, error, loading, retry: () => setAttempt(value => value + 1) }
}
