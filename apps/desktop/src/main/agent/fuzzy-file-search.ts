/**
 * Local filesystem inventory + thin re-export of pure fuzzy matchers from
 * `@superone/runtime/fs` (shared with remote-mentions / CLI inventory paths).
 */

import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { fdir } from 'fdir'
import ignore, { type Ignore } from 'ignore'
import type { FileSearchResult, MentionSearchItem } from '@superone/shared/agent-types'
import {
  EXCLUDED_DIRS,
  fuzzyMatch,
  searchFilesInEntries,
  searchMentionsInEntries,
  type AgentEntry,
  type FuzzyMatchResult,
} from '@superone/runtime/fs'

export {
  EXCLUDED_DIRS,
  fuzzyMatch,
  searchFilesInEntries,
  searchMentionsInEntries,
  type AgentEntry,
  type FuzzyMatchResult,
}

interface CollectedFile {
  path: string
  isDirectory: boolean
  root: string
}

function loadIgnore(root: string): Ignore {
  const ig = ignore()
  for (const d of EXCLUDED_DIRS) ig.add(d)
  try {
    ig.add(readFileSync(join(root, '.gitignore'), 'utf8'))
  } catch {
    // no .gitignore — baseline EXCLUDED_DIRS still apply
  }
  return ig
}

export function collectFiles(
  roots: string[],
  maxDepth = 10,
  maxFiles = 50000
): CollectedFile[] {
  const result: CollectedFile[] = []
  for (const root of roots) {
    if (result.length >= maxFiles) break
    try {
      statSync(root)
    } catch {
      continue
    }
    const ig = loadIgnore(root)
    const remaining = maxFiles - result.length
    const rootPrefix = root.endsWith('/') ? root : root + '/'
    const toRelative = (abs: string): string => {
      if (abs === root) return ''
      return abs.startsWith(rootPrefix) ? abs.slice(rootPrefix.length) : abs
    }
    const paths = new fdir()
      .withRelativePaths()
      .withDirs()
      .withPathSeparator('/')
      .withMaxDepth(maxDepth)
      .withMaxFiles(remaining)
      .exclude((_name, dirPath) => {
        const rel = toRelative(dirPath).replace(/\/$/, '')
        return rel.length > 0 && ig.ignores(rel)
      })
      .filter((path, isDir) => {
        if (isDir) return true
        return !ig.ignores(path)
      })
      .crawl(root)
      .sync()
    for (const p of paths) {
      if (!p) continue
      const isDir = p.endsWith('/')
      const cleanPath = isDir ? p.slice(0, -1) : p
      if (!cleanPath) continue
      result.push({ path: cleanPath, isDirectory: isDir, root })
      if (result.length >= maxFiles) break
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
  const results = searchFilesInEntries(files, query, limit)
  if (roots.length > 1) return results
  return results.map((r) => ({ ...r, rootPath: undefined }))
}

/**
 * Direct children of the current @-mention scope (project root, or the dir
 * after the last `/` in the query). Mirrors LIST_DIRECTORY: skips only
 * EXCLUDED_DIRS, **not** .gitignore — so typing after the user already saw an
 * entry in browse mode can still match gitignored files/folders.
 */
export function listScopeChildren(roots: string[], scopeDir?: string): CollectedFile[] {
  const result: CollectedFile[] = []
  const prefix = scopeDir?.replace(/\\/g, '/') ?? ''
  const prefixNorm = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix

  for (const root of roots) {
    const absDir = prefixNorm ? join(root, prefixNorm) : root
    let entries
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name) || entry.name === '.DS_Store') continue
      let isDirectory = entry.isDirectory()
      if (entry.isSymbolicLink()) {
        try {
          isDirectory = statSync(join(absDir, entry.name)).isDirectory()
        } catch {
          continue
        }
      }
      const path = prefixNorm ? `${prefixNorm}${entry.name}` : entry.name
      result.push({ path, isDirectory, root })
    }
  }
  return result
}

/**
 * Deep crawl of a typed path prefix (e.g. `docs/temp/`) without applying
 * .gitignore. Once the user hand-types into a gitignored folder, its whole
 * subtree must stay fuzzy-matchable. Still skips EXCLUDED_DIRS (node_modules,
 * dist, …) for performance/safety.
 */
export function collectScopeTree(
  roots: string[],
  scopeDir: string,
  maxDepth = 10,
  maxFiles = 50000
): CollectedFile[] {
  const result: CollectedFile[] = []
  const prefixNorm = scopeDir.replace(/\\/g, '/').replace(/\/?$/, '/')
  if (!prefixNorm) return result

  for (const root of roots) {
    if (result.length >= maxFiles) break
    const absBase = join(root, prefixNorm)
    try {
      if (!statSync(absBase).isDirectory()) continue
    } catch {
      continue
    }
    const remaining = maxFiles - result.length
    const paths = new fdir()
      .withRelativePaths()
      .withDirs()
      .withPathSeparator('/')
      .withMaxDepth(maxDepth)
      .withMaxFiles(remaining)
      .exclude((name) => EXCLUDED_DIRS.has(name))
      .crawl(absBase)
      .sync()
    for (const p of paths) {
      if (!p) continue
      const isDir = p.endsWith('/')
      const clean = isDir ? p.slice(0, -1) : p
      if (!clean) continue
      result.push({ path: `${prefixNorm}${clean}`, isDirectory: isDir, root })
      if (result.length >= maxFiles) break
    }
  }
  return result
}

/**
 * Build the candidate set for @-mention search.
 *
 * - Unscoped (`@foo`): project-wide crawl respects .gitignore (perf), plus
 *   always-visible root children so gitignored top-level names still match.
 * - Scoped (`@docs/temp/…`): the typed directory is fully crawled **without**
 *   .gitignore so hand-navigated gitignored trees stay fuzzy-matchable at any depth.
 */
function mergeScopeCandidates(roots: string[], scopeDir?: string): CollectedFile[] {
  const byKey = new Map<string, CollectedFile>()
  const put = (f: CollectedFile) => { byKey.set(`${f.root}\0${f.path}`, f) }

  if (scopeDir) {
    // User committed a path prefix via `/` — open that whole tree (no gitignore).
    for (const f of collectScopeTree(roots, scopeDir)) put(f)
    // Direct children cover the case where the scope dir is empty / crawl misses.
    for (const f of listScopeChildren(roots, scopeDir)) put(f)
    return [...byKey.values()]
  }

  for (const f of collectFiles(roots)) put(f)
  // Root-level readdir so gitignored top-level folders still match when typing.
  for (const f of listScopeChildren(roots, undefined)) put(f)
  return [...byKey.values()]
}

export function searchMentions(
  roots: string[],
  query: string,
  agents: AgentEntry[],
  limit = 20,
  scopeDir?: string
): MentionSearchItem[] {
  // Always include current-directory entries (even gitignored) so the @ popup
  // can match what browse mode already listed when the user starts typing.
  const scoped = mergeScopeCandidates(roots, scopeDir)
  return searchMentionsInEntries(scoped, query, agents, limit, scopeDir, roots.length > 1)
}
