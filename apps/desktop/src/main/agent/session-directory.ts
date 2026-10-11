import { existsSync } from 'fs'
import type { Session } from '../session/types'

interface SessionDirectoryHint {
  sessionId?: string
  worktreePath?: string | null
  gitBranch?: string | null
}

/** A named new session defaults to its project, independent of the focused runtime. */
export function sessionCreationCwd(
  projectPath: string,
  hint: SessionDirectoryHint | undefined,
  active: Pick<Session, 'id' | 'cwd'> | null | undefined,
): string {
  if (hint?.worktreePath !== undefined) return hint.worktreePath ?? projectPath
  if (active && (!hint?.sessionId || active.id === hint.sessionId)) return active.cwd
  return projectPath
}

export async function applySessionDirectoryHint(
  session: Session,
  hint?: SessionDirectoryHint,
): Promise<void> {
  const cwd = hint?.worktreePath === null ? session.projectPath : hint?.worktreePath?.trim()
  if (!cwd || !existsSync(cwd)) return
  const branch = hint?.gitBranch
  if (session.cwd === cwd) {
    if (branch !== undefined && branch !== session.snapshot.gitBranch) {
      await session.applyWorktreeSelection(cwd, branch)
    }
    return
  }
  await session.applyWorktreeSelection(cwd, branch ?? undefined)
}
