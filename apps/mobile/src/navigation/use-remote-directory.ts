import { useRef, useState, type RefObject } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { RemoteCommand } from '@superone/shared/agent-types'
import type { RemoteDirectoryEntry } from '../shell-state'
import { randomId } from '../ids'

export function useRemoteDirectory(clientRef: RefObject<RelayClient | null>) {
  const [path, setPath] = useState('')
  const [items, setItems] = useState<RemoteDirectoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const pending = useRef<{ client: RelayClient; path: string; promise: Promise<boolean> } | null>(null)
  const load = (nextPath: string): Promise<boolean> => {
    const client = clientRef.current
    if (!client) return Promise.resolve(false)
    if (pending.current?.client === client && pending.current.path === nextPath) return pending.current.promise
    const request = ++generation.current
    setPath(nextPath)
    setItems([])
    setLoading(true)
    setError('')
    const promise = Promise.resolve().then(async () => {
      try {
        const result = await client.request({ type: 'list_directory', requestId: randomId(), path: nextPath } as RemoteCommand) as { items?: RemoteDirectoryEntry[]; error?: string }
        if (result.error) throw new Error(result.error)
        if (request !== generation.current || client !== clientRef.current) return false
        setItems(result.items ?? [])
        return true
      } catch (cause) {
        if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Could not load folder')
        return false
      } finally {
        if (request === generation.current) { setLoading(false); pending.current = null }
      }
    })
    pending.current = { client, path: nextPath, promise }
    return promise
  }
  return { path, items, loading, error, load }
}
