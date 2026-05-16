import { readdirSync, statSync } from 'fs'
import { join, relative, basename } from 'path'
import type { FileSearchResult, MentionSearchItem } from '@superone/shared/agent-types'

export const EXCLUDED_DIRS = new Set([
  '.git', '.next', '.nuxt', '.turbo', '.cache', '.venv',
  '.gradle', '.cargo', '.tox', '.mypy_cache',
  'node_modules', 'dist', 'build', '__pycache__',
])

export interface FuzzyMatchResult {
  match: boolean
  score: number
  indices: number[]
}

function forwardMatchFrom(queryLower: string, pathLower: string, start: number): number[] {
  const indices: number[] = []
  let qi = 0
  for (let pi = start; pi < pathLower.length && qi < queryLower.length; pi++) {
    if (pathLower[pi] === queryLower[qi]) {
      indices.push(pi)
      qi++
    }
  }
  return indices
}

function scoreIndices(indices: number[], query: string, filePath: string, nameStart: number): number {
  let score = 0
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i]
    if (i > 0 && indices[i] === indices[i - 1] + 1) score += 5
    if (idx >= nameStart) score += 3
    if (idx === 0 || filePath[idx - 1] === '/' || filePath[idx - 1] === '\\') score += 4
    if (filePath[idx] === query[i]) score += 1
  }
  score -= filePath.length * 0.1
  return score
}

export function fuzzyMatch(query: string, filePath: string): FuzzyMatchResult {
  if (!query) return { match: true, score: 0, indices: [] }

  const queryLower = query.toLowerCase()
  const pathLower = filePath.toLowerCase()

  const fwd = forwardMatchFrom(queryLower, pathLower, 0)
  if (fwd.length < queryLower.length) return { match: false, score: 0, indices: [] }

  const name = basename(filePath)
  const nameStart = filePath.length - name.length

  let bestIndices = fwd
  let bestScore = scoreIndices(fwd, query, filePath, nameStart)

  const startPositions = new Set<number>()
  startPositions.add(0)
  for (let pi = 0; pi < pathLower.length; pi++) {
    if (pathLower[pi] === queryLower[0]) startPositions.add(pi)
  }
  for (const start of startPositions) {
    if (start === 0) continue
    const candidate = forwardMatchFrom(queryLower, pathLower, start)
    if (candidate.length < queryLower.length) continue
    const s = scoreIndices(candidate, query, filePath, nameStart)
    if (s > bestScore) {
      bestScore = s
      bestIndices = candidate
    }
  }

  return { match: true, score: bestScore, indices: bestIndices }
}

interface CollectedFile {
  path: string
  isDirectory: boolean
  root: string
}

export function collectFiles(
  roots: string[],
  maxDepth = 10,
  maxFiles = 50000
): CollectedFile[] {
  const result: CollectedFile[] = []
  const seen = new Set<string>()

  interface DirFrame {
    dir: string
    root: string
    depth: number
    entries: import('fs').Dirent[]
    idx: number
  }

  function openDir(dir: string, root: string, depth: number): DirFrame | null {
    if (depth > maxDepth) return null
    try {
      const entries = readdirSync(dir, { withFileTypes: true }) as import('fs').Dirent[]
      return { dir, root, depth, entries, idx: 0 }
    } catch {
      return null
    }
  }

  // Round-robin fair traversal: every still-open directory emits at most one
  // entry per round. A huge early-sorting subtree (e.g. a gitignored .dev-data
  // Electron userData dir) therefore can't drain the maxFiles cap before
  // shallower sibling subtrees — DFS/FIFO-BFS would starve src/ here.
  let active: DirFrame[] = []
  for (const root of roots) {
    try {
      statSync(root)
    } catch {
      continue
    }
    const frame = openDir(root, root, 0)
    if (frame) active.push(frame)
  }

  while (active.length > 0 && result.length < maxFiles) {
    const stillActive: DirFrame[] = []
    const discovered: DirFrame[] = []
    for (const frame of active) {
      if (result.length >= maxFiles) break
      // Advance past excluded/seen entries, emitting at most one this round.
      while (frame.idx < frame.entries.length) {
        const entry = frame.entries[frame.idx++]
        if (EXCLUDED_DIRS.has(entry.name)) continue
        const fullPath = join(frame.dir, entry.name)
        if (seen.has(fullPath)) continue
        seen.add(fullPath)
        const isDirectory = entry.isDirectory()
        result.push({ path: relative(frame.root, fullPath), isDirectory, root: frame.root })
        if (isDirectory) {
          const sub = openDir(fullPath, frame.root, frame.depth + 1)
          if (sub) discovered.push(sub)
        }
        break
      }
      if (frame.idx < frame.entries.length) stillActive.push(frame)
    }
    active = stillActive.concat(discovered)
  }

  return result
}

export function searchFiles(
  roots: string[],
  query: string,
  limit = 20
): FileSearchResult[] {
  const files = collectFiles(roots)

  const hasMultipleRoots = roots.length > 1

  if (!query) {
    return files.slice(0, limit).map((f) => ({
      path: f.path,
      isDirectory: f.isDirectory,
      matchIndices: [],
      score: 0,
      rootPath: hasMultipleRoots ? f.root : undefined,
    }))
  }

  const matches: FileSearchResult[] = []
  for (const file of files) {
    const result = fuzzyMatch(query, file.path)
    if (result.match) {
      matches.push({
        path: file.path,
        isDirectory: file.isDirectory,
        matchIndices: result.indices,
        score: result.score,
        rootPath: hasMultipleRoots ? file.root : undefined,
      })
    }
  }

  matches.sort((a, b) => b.score - a.score)

  return matches.slice(0, limit)
}

export interface AgentEntry {
  name: string
  model: string
}

export function searchMentions(
  roots: string[],
  query: string,
  agents: AgentEntry[],
  limit = 20,
  scopeDir?: string
): MentionSearchItem[] {
  const hasMultipleRoots = roots.length > 1

  if (!query) {
    const items: MentionSearchItem[] = []
    const files = collectFiles(roots)
    for (const f of files.slice(0, limit)) {
      if (scopeDir && !f.path.startsWith(scopeDir)) continue
      items.push({ kind: 'file', path: f.path, isDirectory: f.isDirectory, matchIndices: [], score: 0, rootPath: hasMultipleRoots ? f.root : undefined })
    }
    if (!scopeDir) {
      for (const a of agents) {
        items.push({ kind: 'agent', name: a.name, model: a.model, matchIndices: [], score: 0 })
      }
    }
    return items
  }

  const results: MentionSearchItem[] = []

  const files = collectFiles(roots)
  for (const file of files) {
    if (scopeDir && !file.path.startsWith(scopeDir)) continue
    const matchTarget = scopeDir ? file.path.slice(scopeDir.length) : file.path
    const m = fuzzyMatch(query, matchTarget)
    if (m.match) {
      const indices = scopeDir ? m.indices.map((i) => i + scopeDir.length) : m.indices
      results.push({ kind: 'file', path: file.path, isDirectory: file.isDirectory, matchIndices: indices, score: m.score, rootPath: hasMultipleRoots ? file.root : undefined })
    }
  }

  if (!scopeDir) {
    for (const agent of agents) {
      const m = fuzzyMatch(query, agent.name)
      if (m.match) {
        results.push({ kind: 'agent', name: agent.name, model: agent.model, matchIndices: m.indices, score: m.score })
      }
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}
