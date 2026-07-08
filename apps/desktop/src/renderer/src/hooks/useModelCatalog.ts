import { useCallback, useEffect, useState } from 'react'
import type { ModelCatalog } from '@superone/shared/model-catalog-types'

let cache: ModelCatalog | null = null
let inflight: Promise<ModelCatalog> | null = null
const listeners = new Set<(c: ModelCatalog) => void>()

function publish(c: ModelCatalog): ModelCatalog {
  cache = c
  listeners.forEach((l) => l(c))
  return c
}

function load(): Promise<ModelCatalog> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = window.app.getModelCatalog().then((c) => {
      inflight = null
      return publish(c)
    })
  }
  return inflight
}

/** Load the models.dev catalog once per app session (main-process三层缓存 backs this). */
export function useModelCatalog(): {
  catalog: ModelCatalog | null
  loading: boolean
  refreshing: boolean
  refresh: () => Promise<void>
} {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(cache)
  const [loading, setLoading] = useState(!cache)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    listeners.add(setCatalog)
    let alive = true
    if (cache) {
      setCatalog(cache)
      setLoading(false)
    } else {
      setLoading(true)
      load()
        .then((c) => { if (alive) { setCatalog(c); setLoading(false) } })
        .catch(() => { if (alive) setLoading(false) })
    }
    return () => { alive = false; listeners.delete(setCatalog) }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      publish(await window.app.refreshModelCatalog())
    } finally {
      setRefreshing(false)
    }
  }, [])

  return { catalog, loading, refreshing, refresh }
}
