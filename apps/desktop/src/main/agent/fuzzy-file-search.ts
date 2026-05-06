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

  function walk(dir: string, root: string, depth: number): void {
    if (depth > maxDepth || result.length >= maxFiles) return
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as import('fs').Dirent[]
    } catch {
      return
    }
    for (const entry of entries) {
      if (result.length >= maxFiles) return
      if (EXCLUDED_DIRS.has(entry.name)) continue

      const fullPath = join(dir, entry.name)
      const relPath = relative(root, fullPath)

      if (seen.has(fullPath)) continue
      seen.add(fullPath)

      result.push({ path: relPath, isDirectory: entry.isDirectory(), root })
      if (entry.isDirectory()) {
        walk(fullPath, root, depth + 1)
      }
    }
  }

  for (const root of roots) {
    try {
      statSync(root)
      walk(root, root, 0)
    } catch {
      continue
    }
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
