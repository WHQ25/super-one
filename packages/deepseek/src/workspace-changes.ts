/**
 * A turn's workspace changes as the file-edit rows the chat already renders.
 *
 * `dsh-workspace-changes` snapshots the working tree around every top-level
 * turn and announces the files that changed. dsh's own `write` / `edit` calls
 * already render as Edit/Write rows with their diffs; what the snapshot adds is
 * everything else — files a shell command created, rewrote or deleted. Those
 * are projected through the same Edit / Write / Delete rows a Claude Bash call's
 * `bashEditDiff` becomes, so the transcript, the expanded diff and the turn's
 * line totals treat them exactly like the rest.
 */

import { isAbsolute, resolve } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceChanges } from '@deepseek-ai/dsh-workspace-changes'
import type { BashEditDiff, BashEditDiffFile } from '@superone/shared/agent-types'
import { bashEditToolUses, type BashEditToolUse } from '@superone/shared/bash-edit-diff'

/**
 * The file a dsh file tool changes, mirroring the recorder's own rule for which
 * calls it captures.
 * @param name - the model-facing tool name.
 * @param rawArguments - the call's arguments as logged (JSON text).
 * @returns the path as the call named it, or undefined for any other call.
 */
export function fileToolPath(name: string, rawArguments: string): string | undefined {
  if (name !== 'write' && name !== 'edit' && name !== 'str_replace_editor') return undefined
  let args: unknown
  try {
    args = JSON.parse(rawArguments)
  } catch {
    return undefined
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const record = args as Record<string, unknown>
  const path = name === 'str_replace_editor' ? record.path : record.file_path
  return typeof path === 'string' && path.length > 0 ? path : undefined
}

/**
 * Resolve a path a tool or the summary names against the session directory.
 * @param cwd - the session working directory.
 * @param path - relative to it, or absolute.
 * @returns the absolute path.
 */
export function workspacePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path)
}

/**
 * Rows for the files one `workspace/changes` event lists that no file tool
 * already showed.
 * @param service - the recorder's host service.
 * @param sessionId - the dsh session that appended the event.
 * @param seq - the event's sequence.
 * @param rowIdBase - stable per turn, so a re-recorded turn updates its rows.
 * @param covered - absolute paths the turn's file-tool calls named.
 * @param signal - cancels the snapshot reads.
 * @returns one row per uncovered file, rendered files first.
 */
export async function workspaceChangeRows(
  service: WorkspaceChanges,
  sessionId: string,
  seq: number,
  rowIdBase: string,
  covered: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<BashEditToolUse[]> {
  const id = SessionId(sessionId)
  const summary = service.summary(id, seq)
  if (!summary) return []
  const files: BashEditDiffFile[] = []
  const changedFiles: string[] = []
  for (const [index, file] of summary.files.entries()) {
    const filePath = workspacePath(summary.cwd, file.path)
    if (covered.has(filePath)) continue
    // Binary and oversized files have no lines to show; they still count as
    // changed, as path-only rows.
    const diff = file.binary || file.oversized ? undefined : await service.diff(id, seq, index, signal)
    if (diff?.kind !== 'text') {
      changedFiles.push(filePath)
      continue
    }
    files.push({
      filePath,
      hunks: diff.hunks,
      ...(!diff.before ? { created: true as const } : {}),
      ...(!diff.after ? { deleted: true as const } : {}),
    })
  }
  const edits: BashEditDiff = {
    files,
    // Files past the recorder's cap are known only by count.
    moreFiles: Math.max(0, summary.total - summary.files.length),
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
  }
  return bashEditToolUses(rowIdBase, edits)
}
