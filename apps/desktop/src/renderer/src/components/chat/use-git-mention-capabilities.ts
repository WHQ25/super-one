import { useEffect, useState } from 'react'
import {
  enabledGitMentionPortals,
  type GitMentionCapabilities,
  type GitMentionPortal,
} from '@superone/shared/git-mention-query'
import { loadGitMentionCapabilities } from './git-mention-query'

/**
 * Last capability answer per root. The popup mounts fresh on every `@`, and
 * starting from "unknown" each time made the GitHub row flash from disabled
 * to enabled while the (cached, but still async) IPC came back. The composer
 * reads the same map so its grammar gate agrees with the popup.
 */
const capabilitiesByRoot = new Map<string, GitMentionCapabilities>()

/** `null` until the host has answered for this root (or there is no root). */
export function useGitMentionCapabilities(fileRoot: string | null): GitMentionCapabilities | null {
  const [answer, setAnswer] = useState<{ root: string | null; caps: GitMentionCapabilities | null }>(() => ({
    root: fileRoot, caps: fileRoot ? capabilitiesByRoot.get(fileRoot) ?? null : null,
  }))
  useEffect(() => {
    let cancelled = false
    setAnswer({ root: fileRoot, caps: fileRoot ? capabilitiesByRoot.get(fileRoot) ?? null : null })
    if (!fileRoot) return
    loadGitMentionCapabilities(fileRoot)
      .then((next) => {
        capabilitiesByRoot.set(fileRoot, next)
        if (!cancelled) setAnswer({ root: fileRoot, caps: next })
      })
      .catch(() => {
        if (!cancelled) setAnswer({ root: fileRoot, caps: { repo: 'unsupported', github: false } })
      })
    return () => { cancelled = true }
  }, [fileRoot])
  return answer.root === fileRoot ? answer.caps : fileRoot ? capabilitiesByRoot.get(fileRoot) ?? null : null
}

/** Portals whose grammar the composer should honour for this root. */
export function useEnabledGitMentionPortals(fileRoot: string | null): readonly GitMentionPortal[] {
  return enabledGitMentionPortals(useGitMentionCapabilities(fileRoot))
}
