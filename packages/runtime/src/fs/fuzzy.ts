/**
 * Fuzzy path matching over a pre-collected inventory (local crawl or remote listFiles).
 * Shared by desktop @-mention IPC and remote mention helpers.
 */

import { Fzf, byLengthAsc, type FzfResultItem } from 'fzf'
import type { FileSearchResult, MentionSearchItem } from '@superone/shared/agent-types'
import { LIST_FILES_EXCLUDED } from './list-files'

/** Alias of LIST_FILES_EXCLUDED for desktop fuzzy-file-search compatibility. */
export const EXCLUDED_DIRS = LIST_FILES_EXCLUDED

export interface AgentEntry {
  name: string
  model: string
}

export interface FuzzyMatchResult {
  match: boolean
  score: number
  indices: number[]
}

export function fuzzyMatch(query: string, filePath: string): FuzzyMatchResult {
  if (!query) return { match: true, score: 0, indices: [] }
  const fzf = new Fzf([filePath], { casing: 'case-insensitive' })
  const r = fzf.find(query)
  if (r.length === 0) return { match: false, score: 0, indices: [] }
  const indices = [...r[0]!.positions].sort((a, b) => a - b)
  const baseStart = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1
  let bonus = 0
  if (indices.length > 0 && indices.every((i) => i >= baseStart)) bonus += 6
  for (let k = 0; k < indices.length; k++) {
    if (filePath[indices[k]!] === query[k]) bonus += 1
  }
  return { match: true, score: r[0]!.score + bonus, indices }
}

function indicesFromPositions(positions: Set<number>): number[] {
  return [...positions].sort((a, b) => a - b)
}

/**
 * Fuzzy @-mention over a pre-collected path list.
 */
export function searchMentionsInEntries(
  entries: Array<{ path: string; isDirectory: boolean; root?: string }>,
  query: string,
  agents: AgentEntry[],
  limit = 20,
  scopeDir?: string,
  multiRoot = false,
): MentionSearchItem[] {
  const scoped = scopeDir
    ? entries.filter((f) => {
        const p = f.path.replace(/\\/g, '/')
        const prefix = scopeDir.replace(/\\/g, '/').replace(/\/?$/, '/')
        return p === scopeDir.replace(/\/$/, '') || p.startsWith(prefix)
      })
    : entries
  const hasMultipleRoots =
    multiRoot || new Set(entries.map((e) => e.root).filter(Boolean)).size > 1

  if (!query) {
    const items: MentionSearchItem[] = []
    for (const f of scoped.slice(0, limit)) {
      items.push({
        kind: 'file',
        path: f.path,
        isDirectory: f.isDirectory,
        matchIndices: [],
        score: 0,
        rootPath: hasMultipleRoots ? f.root : undefined,
      })
    }
    if (!scopeDir) {
      for (const a of agents) {
        items.push({ kind: 'agent', name: a.name, model: a.model, matchIndices: [], score: 0 })
      }
    }
    return items
  }

  const prefixLen = scopeDir?.length ?? 0
  const fileFzf = new Fzf(scoped, {
    selector: (f) => (scopeDir ? f.path.slice(prefixLen) : f.path),
    casing: 'case-insensitive',
    tiebreakers: [byLengthAsc],
    limit,
  })
  const fileMatches = fileFzf.find(query) as FzfResultItem<(typeof scoped)[number]>[]

  const fileItems: MentionSearchItem[] = fileMatches.map((m) => {
    const local = indicesFromPositions(m.positions)
    const indices = scopeDir ? local.map((i) => i + prefixLen) : local
    return {
      kind: 'file' as const,
      path: m.item.path,
      isDirectory: m.item.isDirectory,
      matchIndices: indices,
      score: m.score,
      rootPath: hasMultipleRoots ? m.item.root : undefined,
    }
  })

  let agentItems: MentionSearchItem[] = []
  if (!scopeDir && agents.length > 0) {
    const agentFzf = new Fzf(agents, {
      selector: (a) => a.name,
      casing: 'case-insensitive',
    })
    const matches = agentFzf.find(query) as FzfResultItem<AgentEntry>[]
    agentItems = matches.map((m) => ({
      kind: 'agent' as const,
      name: m.item.name,
      model: m.item.model,
      matchIndices: indicesFromPositions(m.positions),
      score: m.score,
    }))
  }

  const all = [...fileItems, ...agentItems]
  all.sort((a, b) => b.score - a.score)
  return all.slice(0, limit)
}

export function searchFilesInEntries(
  entries: Array<{ path: string; isDirectory: boolean; root?: string }>,
  query: string,
  limit = 20,
): FileSearchResult[] {
  if (!query) {
    return entries.slice(0, limit).map((f) => ({
      path: f.path,
      isDirectory: f.isDirectory,
      matchIndices: [],
      score: 0,
      rootPath: f.root,
    }))
  }
  const fzf = new Fzf(entries, {
    selector: (f) => f.path,
    casing: 'case-insensitive',
    tiebreakers: [byLengthAsc],
    limit,
  })
  const matches = fzf.find(query) as FzfResultItem<(typeof entries)[number]>[]
  return matches.map((m) => ({
    path: m.item.path,
    isDirectory: m.item.isDirectory,
    matchIndices: indicesFromPositions(m.positions),
    score: m.score,
    rootPath: m.item.root,
  }))
}
