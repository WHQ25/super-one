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
  const [caps, setCaps] = useState<GitMentionCapabilities | null>(
    () => (fileRoot ? capabilitiesByRoot.get(fileRoot) ?? null : null),
  )
  useEffect(() => {
    let cancelled = false
    setCaps(fileRoot ? capabilitiesByRoot.get(fileRoot) ?? null : null)
    if (!fileRoot) return
    loadGitMentionCapabilities(fileRoot)
      .then((next) => {
        capabilitiesByRoot.set(fileRoot, next)
        if (!cancelled) setCaps(next)
      })
      .catch(() => {
        if (!cancelled) setCaps({ repo: 'not-repo', github: false })
      })
    return () => { cancelled = true }
  }, [fileRoot])
  return caps
}

/** Portals whose grammar the composer should honour for this root. */
export function useEnabledGitMentionPortals(fileRoot: string | null): readonly GitMentionPortal[] {
  return enabledGitMentionPortals(useGitMentionCapabilities(fileRoot))
}
