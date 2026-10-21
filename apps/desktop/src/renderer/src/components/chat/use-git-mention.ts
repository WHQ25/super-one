import { useEffect, useMemo, useRef, useState } from 'react'
import { MENTION_SEARCH_DEBOUNCE_MS } from '@superone/shared/mention-search-debounce'
import {
  enabledGitMentionPortals,
  gitMentionSearchKinds,
  PLAIN_GIT_MENTION_KINDS,
  type GitMentionPortal,
} from '@superone/shared/git-mention-query'
import { PLAIN_MENTION_GROUP_LIMIT, shouldDirectSearch } from '@superone/shared/mention-direct-search'
import {
  loadGitMentionRefsForKinds,
  parseGitMentionQuery,
  type GitMentionRef,
  type GitMentionRefsUnavailable,
  type ParsedGitMentionQuery,
} from './git-mention-query'
import { useGitMentionCapabilities } from './use-git-mention-capabilities'

/** Whether the "Git" built-in row can be entered at all for this root. */
export type GitMentionAvailability = 'unknown' | 'ready' | 'not-repo' | 'unsupported'

export interface GitMentionState {
  parsed: ParsedGitMentionQuery | null
  isGitMode: boolean
  availability: GitMentionAvailability
  /** Whether the "GitHub" built-in row can be entered: `gh` signed in, GitHub remote present. */
  githubAvailable: boolean
  /** Portals whose grammar is on for this root. Unknown keeps every portal on. */
  portals: readonly GitMentionPortal[]
  /**
   * Portal refs, or the plain-`@` branch / tag / worktree rows. The two never
   * apply to the same query.
   */
  refs: GitMentionRef[]
  loading: boolean
  /** The ref list belongs to the current query. False while a probe or fetch is still out. */
  settled: boolean
  /** Set when a list request came back unusable; cleared on the next good page. */
  unavailable: GitMentionRefsUnavailable | null
}

/**
 * State for `@git` / `@gh`, and for the git rows a plain `@foo` mixes in.
 * A generation counter drops responses from a superseded keystroke.
 */
export function useGitMention(query: string, fileRoot: string | null): GitMentionState {
  const caps = useGitMentionCapabilities(fileRoot)
  const portals = useMemo(() => enabledGitMentionPortals(caps), [caps])
  const parsed = useMemo(() => parseGitMentionQuery(query, portals), [query, portals])
  const [availability, setAvailability] = useState<GitMentionAvailability>(caps?.repo ?? 'unknown')
  const [githubAvailable, setGithubAvailable] = useState(caps?.github ?? false)
  const [refs, setRefs] = useState<GitMentionRef[]>([])
  const [loading, setLoading] = useState(false)
  const [settledFor, setSettledFor] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState<GitMentionRefsUnavailable | null>(null)
  const genRef = useRef(0)

  useEffect(() => {
    setAvailability(caps?.repo ?? 'unknown')
    setGithubAvailable(caps?.github ?? false)
  }, [caps])

  useEffect(() => {
    const gen = ++genRef.current
    const parsedNow = parseGitMentionQuery(query, portals)
    const direct = parsedNow == null && shouldDirectSearch(query, portals)

    const finishEmpty = (settled: boolean) => {
      if (gen !== genRef.current) return
      setRefs([])
      setLoading(false)
      setUnavailable(null)
      setSettledFor(settled ? query : null)
    }

    let kinds = parsedNow ? gitMentionSearchKinds(parsedNow) : []
    let refQuery = parsedNow?.refQuery ?? ''
    let perKindLimit: number | undefined
    if (parsedNow) {
      if (!fileRoot || kinds.length === 0) {
        finishEmpty(true)
        return
      }
    } else if (direct) {
      // Caps still loading: an empty ref list is not an answer yet.
      if (caps == null) {
        finishEmpty(false)
        return
      }
      if (caps.repo !== 'ready' || !fileRoot) {
        finishEmpty(true)
        return
      }
      kinds = [...PLAIN_GIT_MENTION_KINDS]
      refQuery = query.trim()
      perKindLimit = PLAIN_MENTION_GROUP_LIMIT
    } else {
      finishEmpty(true)
      return
    }

    // Keep the previous refs until this request answers. Clearing them
    // emptied the git groups on every keystroke.
    setLoading(true)
    setSettledFor(null)
    const timer = setTimeout(() => {
      void loadGitMentionRefsForKinds(fileRoot, kinds, refQuery, { perKindLimit })
        .then((result) => {
          if (gen !== genRef.current) return
          if (result.ok) {
            setRefs(result.refs)
            setUnavailable(null)
          } else {
            setRefs([])
            setUnavailable(result.reason)
            if (result.reason === 'not-repo' || result.reason === 'unsupported') setAvailability(result.reason)
            if (result.reason === 'gh-unavailable') setGithubAvailable(false)
          }
          setLoading(false)
          setSettledFor(query)
        })
        .catch(() => {
          if (gen !== genRef.current) return
          setRefs([])
          setUnavailable('error')
          setLoading(false)
          setSettledFor(query)
        })
    }, refQuery ? MENTION_SEARCH_DEBOUNCE_MS : 0)
    return () => clearTimeout(timer)
  }, [query, fileRoot, caps, portals])

  return {
    parsed,
    isGitMode: parsed !== null,
    availability,
    githubAvailable,
    portals,
    refs,
    loading,
    settled: settledFor === query,
    unavailable,
  }
}
