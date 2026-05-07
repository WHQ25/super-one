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
}

function statusFromCell(c: string): GitFileStatus | null {
  if (c === 'M' || c === 'A' || c === 'D' || c === 'R' || c === 'C' || c === 'U') return c
  return null
}

export function parseGitStatusLine(line: string): ParsedGitStatusLine {
  const x = line[0]
  const y = line[1]
  const filePath = line.slice(3)

  if (x === '!' && y === '!') {
    return { path: filePath.replace(/\/$/, ''), index: null, worktree: '!', ignored: true }
  }
  if (x === '?' && y === '?') {
    return { path: filePath, index: null, worktree: '?', ignored: false }
  }

  return {
    path: filePath,
    index: statusFromCell(x),
    worktree: statusFromCell(y),
    ignored: false,
  }
}

export interface ParsedGitStatus {
  statusMap: Map<string, GitStatusPair>
  ignoredDirs: Set<string>
}

export function parseGitStatusOutput(raw: string): ParsedGitStatus {
  const statusMap = new Map<string, GitStatusPair>()
  const ignoredDirs = new Set<string>()

  for (const line of raw.split('\n').filter(Boolean)) {
    const parsed = parseGitStatusLine(line)
    statusMap.set(parsed.path, { index: parsed.index, worktree: parsed.worktree })
    if (parsed.ignored && line.slice(3).endsWith('/')) {
      ignoredDirs.add(parsed.path)
    }
  }

  return { statusMap, ignoredDirs }
}

export interface ParsedGitStatusFile {
  path: string
  status: GitFileStatus
  staged: boolean
}

const MERGED_PRIORITY = ['?', 'D', 'A', 'R', 'C', 'U', 'M'] as const

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
