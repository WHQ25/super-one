import type { GitFileStatus } from '@superone/shared/agent-types'

export interface ParsedGitStatusLine {
  path: string
  status: GitFileStatus
  ignored: boolean
}

export function parseGitStatusLine(line: string): ParsedGitStatusLine {
  const x = line[0]
  const y = line[1]
  const filePath = line.slice(3)

  if (x === '!' && y === '!') {
    return { path: filePath.replace(/\/$/, ''), status: '!', ignored: true }
  }

  let status: GitFileStatus
  if (x === '?' || y === '?') status = '?'
  else if (x === 'D' || y === 'D') status = 'D'
  else if (x === 'A') status = 'A'
  else if (x === 'R' || y === 'R') status = 'R'
  else if (x === 'C' || y === 'C') status = 'C'
  else if (x === 'U' || y === 'U') status = 'U'
  else status = 'M'

  const staged = x !== ' ' && x !== '?'
  return { path: filePath, status, ignored: false }
}

export interface ParsedGitStatus {
  statusMap: Map<string, GitFileStatus>
  ignoredDirs: Set<string>
}

export function parseGitStatusOutput(raw: string): ParsedGitStatus {
  const statusMap = new Map<string, GitFileStatus>()
  const ignoredDirs = new Set<string>()

  for (const line of raw.split('\n').filter(Boolean)) {
    const parsed = parseGitStatusLine(line)
    statusMap.set(parsed.path, parsed.status)
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

export function parseGitStatusFiles(raw: string): ParsedGitStatusFile[] {
  return raw.split('\n').filter(Boolean).map((line) => {
    const x = line[0]
    const parsed = parseGitStatusLine(line)
    return {
      path: parsed.path,
      status: parsed.status,
      staged: x !== ' ' && x !== '?',
    }
  })
}
