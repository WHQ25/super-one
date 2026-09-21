import { useEffect, useMemo, useRef, useState } from 'react'
import { MENTION_SEARCH_DEBOUNCE_MS } from '@superone/shared/mention-search-debounce'
import { enabledGitMentionPortals } from '@superone/shared/git-mention-query'
import {
  loadGitMentionRefs,
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
  refs: GitMentionRef[]
  loading: boolean
  /** Set when a list request came back unusable; cleared on the next good page. */
  unavailable: GitMentionRefsUnavailable | null
}

/**
 * State for `@git` mode: parse the query, probe whether the root is a repo
 * (so the portal can be disabled up front), and load rows for the chosen kind.
 * A generation counter drops responses from a superseded keystroke.
 */
export function useGitMention(query: string, fileRoot: string | null): GitMentionState {
  const caps = useGitMentionCapabilities(fileRoot)
  // A portal that is off does not own the grammar: `@gh …` is then plain text.
  const parsed = useMemo(() => parseGitMentionQuery(query, enabledGitMentionPortals(caps)), [query, caps])
  const [availability, setAvailability] = useState<GitMentionAvailability>(caps?.repo ?? 'unknown')
  const [githubAvailable, setGithubAvailable] = useState(caps?.github ?? false)
  const [refs, setRefs] = useState<GitMentionRef[]>([])
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState<GitMentionRefsUnavailable | null>(null)
  const genRef = useRef(0)

  useEffect(() => {
    setAvailability(caps?.repo ?? 'unknown')
    setGithubAvailable(caps?.github ?? false)
  }, [caps])

  const refKind = parsed?.refKind ?? null
  const refQuery = parsed?.refQuery ?? ''
  useEffect(() => {
    const gen = ++genRef.current
    if (!refKind || !fileRoot) {
      setRefs([])
      setLoading(false)
      setUnavailable(null)
      return
    }
    setLoading(true)
    const timer = setTimeout(() => {
      loadGitMentionRefs(fileRoot, refKind, refQuery)
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
        })
        .catch(() => {
          if (gen !== genRef.current) return
          setRefs([])
          setUnavailable('error')
          setLoading(false)
        })
    }, refQuery ? MENTION_SEARCH_DEBOUNCE_MS : 0)
    return () => clearTimeout(timer)
  }, [refKind, refQuery, fileRoot])

  return { parsed, isGitMode: parsed !== null, availability, githubAvailable, refs, loading, unavailable }
}
