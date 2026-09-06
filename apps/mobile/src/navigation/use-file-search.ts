import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { FileSearchResult, RemoteCommand } from '@superone/shared/agent-types'
import { randomId } from '../ids'

const DEBOUNCE_MS = 200

/**
 * Fuzzy file search under one root, matching the desktop file-tree search.
 *
 * Debounced because every keystroke is a round trip to the desktop; on a relay
 * connection that is the difference between a search box and a stutter.
 */
export function useFileSearch(clientRef: RefObject<RelayClient | null>, root: string) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FileSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const generation = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed || !root) {
      generation.current++
      setResults([])
      setSearched(false)
      setSearching(false)
      return
    }
    const request = ++generation.current
    setSearching(true)
    const timer = setTimeout(() => {
      const client = clientRef.current
      if (!client) return
      void client.request({
        type: 'search_files', requestId: randomId(), root, query: trimmed, limit: 40,
      } as RemoteCommand).then((response) => {
        if (request !== generation.current) return
        setResults((response as { results?: FileSearchResult[] }).results ?? [])
        setSearched(true)
        setSearching(false)
      }).catch(() => {
        if (request !== generation.current) return
        setResults([])
        setSearched(true)
        setSearching(false)
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [clientRef, query, root])

  const reset = useCallback(() => {
    generation.current++
    setQuery('')
    setResults([])
    setSearched(false)
    setSearching(false)
  }, [])

  return { query, setQuery, results, searching, searched, reset }
}
