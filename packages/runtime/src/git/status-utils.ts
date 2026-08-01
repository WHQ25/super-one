import type { GitFileStatus } from '@superone/shared/agent-types'

export interface GitStatusPair {
  index: GitFileStatus | null
  worktree: GitFileStatus | null
}

export interface ParsedGitStatusLine {
  path: string
  index: GitFileStatus | null
  worktree: GitFileStatus | null
  ignored: boolean
  fromPath: string | null
  isDirEntry: boolean
}

export const IGNORED_PAIR: GitStatusPair = { index: null, worktree: '!' }
export const UNTRACKED_PAIR: GitStatusPair = { index: null, worktree: '?' }
export const EMPTY_PAIR: GitStatusPair = { index: null, worktree: null }

/** Higher = more severe when rolling up child status onto a parent directory. */
export const GIT_STATUS_PRIORITY: Record<string, number> = {
  U: 6,
  D: 5,
  R: 4,
  C: 4,
  T: 3,
  M: 3,
  A: 2,
  '?': 1,
}

function statusFromCell(c: string): GitFileStatus | null {
  if (
    c === 'M' || c === 'A' || c === 'D' || c === 'R' ||
    c === 'C' || c === 'U' || c === 'T'
  ) return c
  return null
}

/** Strip git porcelain C-style quoting and a trailing directory slash. */
export function normalizeGitPath(raw: string): { path: string; isDir: boolean } {
  let s = raw
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).replace(/\\([\\"nrt])/g, (_, c: string) => {
      if (c === 'n') return '\n'
      if (c === 't') return '\t'
      if (c === 'r') return '\r'
      return c
    })
  }
  const isDir = s.endsWith('/')
  if (isDir) s = s.slice(0, -1)
  return { path: s, isDir }
}

function parseRenameCopyPath(filePath: string): { path: string; fromPath: string; isDir: boolean } {
  const arrow = ' -> '
  const idx = filePath.indexOf(arrow)
  if (idx === -1) {
    const n = normalizeGitPath(filePath)
    return { path: n.path, fromPath: n.path, isDir: n.isDir }
  }
  const from = normalizeGitPath(filePath.slice(0, idx))
  const to = normalizeGitPath(filePath.slice(idx + arrow.length))
  return { path: to.path, fromPath: from.path, isDir: to.isDir }
}

export function parseGitStatusLine(line: string): ParsedGitStatusLine {
  const x = line[0]
  const y = line[1]
  const rest = line.slice(3)

  if (x === '!' && y === '!') {
    const { path, isDir } = normalizeGitPath(rest)
    return { path, index: null, worktree: '!', ignored: true, fromPath: null, isDirEntry: isDir }
  }
  if (x === '?' && y === '?') {
    const { path, isDir } = normalizeGitPath(rest)
    return { path, index: null, worktree: '?', ignored: false, fromPath: null, isDirEntry: isDir }
  }

  if (rest.includes(' -> ')) {
    const { path, fromPath, isDir } = parseRenameCopyPath(rest)
    return {
      path,
      index: statusFromCell(x),
      worktree: statusFromCell(y),
      ignored: false,
      fromPath,
      isDirEntry: isDir,
    }
  }

  const { path, isDir } = normalizeGitPath(rest)
  return {
    path,
    index: statusFromCell(x),
    worktree: statusFromCell(y),
    ignored: false,
    fromPath: null,
    isDirEntry: isDir,
  }
}

export interface ParsedGitStatus {
  statusMap: Map<string, GitStatusPair>
  ignoredDirs: Set<string>
  untrackedDirs: Set<string>
}

export function parseGitStatusOutput(raw: string): ParsedGitStatus {
  const statusMap = new Map<string, GitStatusPair>()
  const ignoredDirs = new Set<string>()
  const untrackedDirs = new Set<string>()

  for (const line of raw.split('\n').filter(Boolean)) {
    const parsed = parseGitStatusLine(line)
    statusMap.set(parsed.path, { index: parsed.index, worktree: parsed.worktree })
    if (parsed.ignored && parsed.isDirEntry) {
      ignoredDirs.add(parsed.path)
    }
    if (!parsed.ignored && parsed.worktree === '?' && parsed.isDirEntry) {
      untrackedDirs.add(parsed.path)
    }
  }

  return { statusMap, ignoredDirs, untrackedDirs }
}

export interface ParsedGitStatusFile {
  path: string
  status: GitFileStatus
  staged: boolean
}

const MERGED_PRIORITY = ['?', 'D', 'A', 'R', 'C', 'U', 'T', 'M'] as const

function mergedStatus(p: ParsedGitStatusLine): GitFileStatus {
  if (p.ignored) return '!'
  for (const s of MERGED_PRIORITY) {
    if (p.index === s || p.worktree === s) return s
  }
  return 'M'
}

export function parseGitStatusFiles(raw: string): ParsedGitStatusFile[] {
  return raw.split('\n').filter(Boolean).map((line) => {
    const parsed = parseGitStatusLine(line)
    return {
      path: parsed.path,
      status: mergedStatus(parsed),
      staged: parsed.index !== null,
    }
  })
}

export function isPairIgnored(p: GitStatusPair | undefined): boolean {
  return p?.index === '!' || p?.worktree === '!'
}

/** True if relPath is dir itself or a descendant of any path in dirs. */
export function isUnderDirSet(relPath: string, dirs: Set<string>): boolean {
  if (dirs.size === 0) return false
  if (dirs.has(relPath)) return true
  let idx = relPath.indexOf('/')
  while (idx !== -1) {
    if (dirs.has(relPath.slice(0, idx))) return true
    idx = relPath.indexOf('/', idx + 1)
  }
  return false
}

function worstColumn(values: (GitFileStatus | null | undefined)[]): GitFileStatus | null {
  let worst: GitFileStatus | null = null
  let worstPri = 0
  for (const s of values) {
    if (!s || s === '!') continue
    const pri = GIT_STATUS_PRIORITY[s] ?? 0
    if (pri > worstPri) {
      worst = s
      worstPri = pri
    }
  }
  return worst
}

/** Roll up the worst index/worktree among statusMap entries under dirRelPath/. */
export function dirStatusPair(
  statusMap: Map<string, GitStatusPair>,
  dirRelPath: string,
): GitStatusPair {
  const prefix = dirRelPath + '/'
  let worstIdx: GitFileStatus | null = null
  let worstIdxPri = 0
  let worstWt: GitFileStatus | null = null
  let worstWtPri = 0
  for (const [path, pair] of statusMap) {
    if (!path.startsWith(prefix)) continue
    if (isPairIgnored(pair)) continue
    if (pair.index) {
      const pri = GIT_STATUS_PRIORITY[pair.index] ?? 0
      if (pri > worstIdxPri) {
        worstIdx = pair.index
        worstIdxPri = pri
      }
    }
    if (pair.worktree) {
      const pri = GIT_STATUS_PRIORITY[pair.worktree] ?? 0
      if (pri > worstWtPri) {
        worstWt = pair.worktree
        worstWtPri = pri
      }
    }
  }
  return { index: worstIdx, worktree: worstWt }
}

/**
 * Resolve the git status pair for a single file-tree entry.
 * Handles ancestor untracked/ignored dirs that git only reports as `?? dir/` / `!! dir/`.
 */
export function resolveEntryStatusPair(
  relPath: string,
  isDir: boolean,
  parsed: ParsedGitStatus,
): GitStatusPair {
  if (isUnderDirSet(relPath, parsed.ignoredDirs) || isPairIgnored(parsed.statusMap.get(relPath))) {
    return IGNORED_PAIR
  }
  if (isUnderDirSet(relPath, parsed.untrackedDirs)) {
    return UNTRACKED_PAIR
  }
  if (isDir) {
    return dirStatusPair(parsed.statusMap, relPath)
  }
  return parsed.statusMap.get(relPath) ?? EMPTY_PAIR
}

/** Used by the recursive full-tree walk when children are already loaded. */
export function worstChildPair(
  children: { gitIndex?: GitFileStatus | null; gitWorktree?: GitFileStatus | null }[],
): GitStatusPair {
  return {
    index: worstColumn(children.map((c) => c.gitIndex ?? null)),
    worktree: worstColumn(children.map((c) => c.gitWorktree ?? null)),
  }
}
