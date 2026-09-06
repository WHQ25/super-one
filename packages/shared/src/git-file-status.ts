import type { GitFileStatus } from './agent-types'

const STATUS_CODES = new Set(['M', 'A', 'D', 'R', 'C', 'U', 'T', '?', '!'])

function statusCode(char: string | undefined): GitFileStatus | null {
  if (!char || char === ' ') return null
  return STATUS_CODES.has(char) ? char as GitFileStatus : null
}

export interface GitFileStatusEntry {
  /** Repo-relative POSIX path, as git reports it. */
  path: string
  /** Staged side of the porcelain pair; `null` when the index is clean. */
  index: GitFileStatus | null
  /** Unstaged side; `null` when the working tree matches the index. */
  worktree: GitFileStatus | null
}

/**
 * Parse `git status --porcelain` (v1) into per-file index/worktree statuses.
 *
 * Two shapes need care. A rename is reported as `R  old -> new`, and it is the
 * NEW path the tree shows, so the arrow has to be split rather than kept whole.
 * And `-z` is not used here because the output already crosses the wire as text;
 * paths containing a quote are returned by git already quoted, and unquoting them
 * is what keeps a file called `a"b.txt` from being filed under a path nobody has.
 */
export function parseGitPorcelain(output: string): GitFileStatusEntry[] {
  const entries: GitFileStatusEntry[] = []
  for (const line of output.split('\n')) {
    if (line.length < 4) continue
    const index = statusCode(line[0])
    const worktree = statusCode(line[1])
    if (!index && !worktree) continue
    const raw = line.slice(3)
    const arrow = raw.indexOf(' -> ')
    const target = arrow === -1 ? raw : raw.slice(arrow + 4)
    entries.push({ path: unquoteGitPath(target), index, worktree })
  }
  return entries
}

function unquoteGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value
  return value
    .slice(1, -1)
    .replace(/\\(["\\])/g, '$1')
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
}

/** The semantic role a status paints as; every surface maps this to its own palette. */
export type GitFileTone = 'modified' | 'added' | 'deleted' | 'renamed' | 'conflict' | 'ignored'

const TONE: Record<GitFileStatus, GitFileTone> = {
  M: 'modified',
  T: 'modified',
  A: 'added',
  '?': 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'renamed',
  U: 'conflict',
  '!': 'ignored',
}

/**
 * How a file's git state should read, from the porcelain pair.
 *
 * `staged` is what distinguishes a change git already has from one it does not,
 * and the two can both be set — a file staged and then edited again. Untracked
 * (`?`) is deliberately not dimmed: it has no index side by definition, so the
 * unstaged rule would make every new file look half-there.
 */
export function gitFileTone(
  index: GitFileStatus | null | undefined,
  worktree: GitFileStatus | null | undefined,
): { tone: GitFileTone; staged: boolean; partiallyStaged: boolean } | null {
  if (index === '!' || worktree === '!') return { tone: 'ignored', staged: false, partiallyStaged: false }
  const hasIndex = index != null
  const hasWorktree = worktree != null
  if (!hasIndex && !hasWorktree) return null
  const display = (hasIndex ? index : worktree) as GitFileStatus
  return {
    tone: TONE[display] ?? 'modified',
    staged: hasIndex || display === '?',
    partiallyStaged: hasIndex && hasWorktree,
  }
}

/**
 * Directories inherit the loudest state under them, so a collapsed folder still
 * says something changed inside. Conflicts outrank everything: they are the one
 * state that blocks work.
 */
const TONE_RANK: GitFileTone[] = ['ignored', 'renamed', 'added', 'modified', 'deleted', 'conflict']

export function strongestGitTone(tones: Iterable<GitFileTone>): GitFileTone | null {
  let best: GitFileTone | null = null
  for (const tone of tones) {
    if (best == null || TONE_RANK.indexOf(tone) > TONE_RANK.indexOf(best)) best = tone
  }
  return best
}
