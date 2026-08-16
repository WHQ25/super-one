/**
 * Claude CLI transcript inspection — shared by desktop and node CLI.
 *
 * The CLI mints a session id and writes `<id>.jsonl` (mode / permission-mode /
 * system rows) the moment the process starts, *before* any conversation row
 * exists. Resuming such a transcript is silent: only a **missing** file makes
 * the CLI fail with `No conversation found with session ID`, while a file with
 * zero user/assistant rows resumes as an empty conversation. That is invisible
 * in SuperOne — the UI still renders SQLite history while the agent greets the
 * chat as brand new — so callers use this to log the discrepancy.
 */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { claudeProjectSlug, claudeProjectsDir } from './fork-session'

export type ClaudeTranscriptState =
  /** Has at least one user/assistant row — resume restores real context. */
  | 'ok'
  /** No transcript for this id under that cwd — resume fails loudly (exit 1). */
  | 'missing'
  /** File exists but carries no conversation row — resume is silently empty. */
  | 'empty'
  /** Could not be determined (unreadable cwd / io error) — never a signal. */
  | 'unknown'

/**
 * Only small files are scanned: a transcript that carries conversation rows is
 * far larger than this, so size alone answers the question for real sessions.
 */
const MAX_INSPECT_BYTES = 64 * 1024

const CONVERSATION_ROW = /"type"\s*:\s*"(?:user|assistant)"/

export function claudeTranscriptPath(providerSessionId: string, cwd: string, projectsDir?: string): string {
  const root = projectsDir ?? claudeProjectsDir()
  return join(root, claudeProjectSlug(realpathSync(cwd)), `${providerSessionId}.jsonl`)
}

export function inspectClaudeTranscript(
  providerSessionId: string,
  cwd: string,
  projectsDir?: string,
): ClaudeTranscriptState {
  if (!providerSessionId?.trim() || !cwd?.trim()) return 'unknown'
  try {
    const file = claudeTranscriptPath(providerSessionId.trim(), cwd, projectsDir)
    if (!existsSync(file)) return 'missing'
    if (statSync(file).size > MAX_INSPECT_BYTES) return 'ok'
    return CONVERSATION_ROW.test(readFileSync(file, 'utf8')) ? 'ok' : 'empty'
  } catch {
    return 'unknown'
  }
}
