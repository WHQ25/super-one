import { useCallback, useEffect, useSyncExternalStore } from 'react'
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
 * reads the same map so its grammar gate agrees with the popup. A manual
 * recheck publishes here too, so the row and the grammar update together.
 */
const capabilitiesByRoot = new Map<string, GitMentionCapabilities>()
const recheckingRoots = new Set<string>()
const loadGeneration = new Map<string, number>()
const listeners = new Set<() => void>()

/** A newer load or recheck for this root wins; an older response is dropped. */
function beginGitMentionLoad(fileRoot: string): number {
  const generation = (loadGeneration.get(fileRoot) ?? 0) + 1
  loadGeneration.set(fileRoot, generation)
  return generation
}

function isCurrentGitMentionLoad(fileRoot: string, generation: number): boolean {
  return (loadGeneration.get(fileRoot) ?? 0) === generation
}

interface GitMentionCapabilitySnapshot {
  caps: GitMentionCapabilities | null
  rechecking: boolean
}

const EMPTY_SNAPSHOT: GitMentionCapabilitySnapshot = { caps: null, rechecking: false }
const snapshots = new Map<string, GitMentionCapabilitySnapshot>()

function publishGitMentionCapabilities(): void {
  for (const listener of listeners) listener()
}

function subscribeGitMentionCapabilities(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshotFor(fileRoot: string | null): GitMentionCapabilitySnapshot {
  if (!fileRoot) return EMPTY_SNAPSHOT
  const caps = capabilitiesByRoot.get(fileRoot) ?? null
  const rechecking = recheckingRoots.has(fileRoot)
  const cached = snapshots.get(fileRoot)
  if (cached && cached.caps === caps && cached.rechecking === rechecking) return cached
  const next = { caps, rechecking }
  snapshots.set(fileRoot, next)
  return next
}

function storeGitMentionCapabilities(fileRoot: string, caps: GitMentionCapabilities): void {
  const prev = capabilitiesByRoot.get(fileRoot)
  if (prev && prev.repo === caps.repo && prev.github === caps.github) return
  capabilitiesByRoot.set(fileRoot, caps)
  publishGitMentionCapabilities()
}

/** Drop the remembered answer and probe this root again. */
export function recheckGitMentionCapabilities(fileRoot: string | null): void {
  if (!fileRoot || recheckingRoots.has(fileRoot)) return
  const generation = beginGitMentionLoad(fileRoot)
  recheckingRoots.add(fileRoot)
  publishGitMentionCapabilities()
  loadGitMentionCapabilities(fileRoot, true)
    .then((next) => {
      if (isCurrentGitMentionLoad(fileRoot, generation)) storeGitMentionCapabilities(fileRoot, next)
    })
    .catch(() => {
      if (isCurrentGitMentionLoad(fileRoot, generation)) {
        storeGitMentionCapabilities(fileRoot, { repo: 'unsupported', github: false })
      }
    })
    .finally(() => {
      if (!isCurrentGitMentionLoad(fileRoot, generation)) return
      recheckingRoots.delete(fileRoot)
      publishGitMentionCapabilities()
    })
}

/** `caps` is null until the host has answered for this root (or there is no root). */
export function useGitMentionCapabilities(fileRoot: string | null): GitMentionCapabilitySnapshot & { recheck: () => void } {
  const getSnapshot = useCallback(() => snapshotFor(fileRoot), [fileRoot])
  const snap = useSyncExternalStore(subscribeGitMentionCapabilities, getSnapshot, () => EMPTY_SNAPSHOT)
  useEffect(() => {
    if (!fileRoot) return
    // Don't bump: the composer and the popup both load, and closing the popup
    // must not drop the composer's answer. A recheck bumps so this result loses.
    const generation = loadGeneration.get(fileRoot) ?? 0
    let cancelled = false
    loadGitMentionCapabilities(fileRoot)
      .then((next) => {
        if (!cancelled && isCurrentGitMentionLoad(fileRoot, generation)) storeGitMentionCapabilities(fileRoot, next)
      })
      .catch(() => {
        if (!cancelled && isCurrentGitMentionLoad(fileRoot, generation)) {
          storeGitMentionCapabilities(fileRoot, { repo: 'unsupported', github: false })
        }
      })
    return () => { cancelled = true }
  }, [fileRoot])
  const recheck = useCallback(() => recheckGitMentionCapabilities(fileRoot), [fileRoot])
  return { caps: snap.caps, rechecking: snap.rechecking, recheck }
}

/** Portals whose grammar the composer should honour for this root. */
export function useEnabledGitMentionPortals(fileRoot: string | null): readonly GitMentionPortal[] {
  return enabledGitMentionPortals(useGitMentionCapabilities(fileRoot).caps)
}
