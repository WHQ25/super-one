import type { BashEditDiff, BashEditDiffFile, BashEditDiffHunk, TaskFileChange } from './agent-types'

/**
 * A Bash call's working-tree changes, projected onto the file-edit rows the chat
 * already renders: one synthesized `Edit` / `Write` / `Delete` tool use per file.
 * The desktop draws them under the Bash block, the turn's diff stat counts them,
 * and the phone reads the same rows off the projected `bash_result`.
 */
export interface BashEditToolUse {
  toolName: 'Edit' | 'Write' | 'Delete'
  toolUseId: string
  /** JSON, same shape the real tool would carry (`file_path` + `diff` / `content`). */
  input: string
  filePath: string
  added: number
  removed: number
  /** No hunks came through (binary, too large, or past the file cap): header-only row. */
  pathOnly: boolean
}

export interface BashEditDiffSummary {
  /** Every changed file the CLI knows of, shown or not. */
  files: number
  added: number
  removed: number
  /** Some changed files carry no line counts, so the totals understate. */
  approximate: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function parseHunk(raw: unknown): BashEditDiffHunk | null {
  const rec = asRecord(raw)
  if (!rec || !Array.isArray(rec.lines)) return null
  const lines = rec.lines.filter((line): line is string => typeof line === 'string')
  const num = (key: string): number => (typeof rec[key] === 'number' ? rec[key] as number : 0)
  return { oldStart: num('oldStart'), oldLines: num('oldLines'), newStart: num('newStart'), newLines: num('newLines'), lines }
}

function parseFile(raw: unknown): BashEditDiffFile | null {
  const rec = asRecord(raw)
  if (!rec || typeof rec.filePath !== 'string' || !rec.filePath) return null
  const hunks = Array.isArray(rec.hunks) ? rec.hunks.map(parseHunk).filter((h): h is BashEditDiffHunk => h !== null) : []
  return {
    filePath: rec.filePath,
    hunks,
    ...(rec.created === true ? { created: true as const } : {}),
    ...(rec.deleted === true ? { deleted: true as const } : {}),
  }
}

/**
 * Validate the CLI's `tool_use_result.bashEditDiff`. Returns undefined for
 * anything that is not the documented shape — the field is `@internal` upstream,
 * so a silent drop beats a crash when a future CLI reshapes it.
 */
export function parseBashEditDiff(raw: unknown): BashEditDiff | undefined {
  const rec = asRecord(raw)
  if (!rec || !Array.isArray(rec.files)) return undefined
  const files = rec.files.map(parseFile).filter((f): f is BashEditDiffFile => f !== null)
  const moreFiles = typeof rec.moreFiles === 'number' && rec.moreFiles > 0 ? Math.floor(rec.moreFiles) : 0
  const changedFiles = Array.isArray(rec.changedFiles)
    ? rec.changedFiles.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : undefined
  const diff: BashEditDiff = {
    files,
    moreFiles,
    ...(changedFiles && changedFiles.length > 0 ? { changedFiles } : {}),
    ...(rec.unavailable === true ? { unavailable: true as const } : {}),
    ...(rec.skipped === true ? { skipped: true as const } : {}),
    ...(rec.shared === true ? { shared: true as const } : {}),
  }
  return isEmptyBashEditDiff(diff) ? undefined : diff
}

/** Nothing to show: no files, no hidden count, and not a deliberate skip. */
export function isEmptyBashEditDiff(diff: BashEditDiff): boolean {
  return diff.files.length === 0 && diff.moreFiles === 0 && !(diff.changedFiles?.length) && !diff.skipped
}

function countHunkLines(hunks: BashEditDiffHunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  }
  return { added, removed }
}

/** Unified diff body (hunk headers + prefixed rows), what an `Edit` row's `diff` param renders. */
export function hunksToUnifiedDiff(hunks: BashEditDiffHunk[]): string {
  return hunks
    .map((hunk) => [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines].join('\n'))
    .join('\n')
}

/** A created file's hunks are all `+` rows, so its full content is recoverable for a `Write` row. */
export function hunksToContent(hunks: BashEditDiffHunk[]): string {
  const rows: string[] = []
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) rows.push(line.slice(1))
    }
  }
  return rows.length > 0 ? rows.join('\n') + '\n' : ''
}

/** Synthesized tool-use id for the i-th file of a Bash call; never collides with an SDK id. */
export function bashEditToolUseId(bashToolUseId: string, index: number): string {
  return `${bashToolUseId}#edit${index}`
}

/** One file-edit row per changed file: rendered files first, then path-only rows for the rest. */
export function bashEditToolUses(bashToolUseId: string, diff: BashEditDiff): BashEditToolUse[] {
  const rows: BashEditToolUse[] = []
  const seen = new Set<string>()
  for (const file of diff.files) {
    seen.add(file.filePath)
    const { added, removed } = countHunkLines(file.hunks)
    const hasHunks = file.hunks.length > 0
    const index = rows.length
    if (file.deleted) {
      rows.push({
        toolName: 'Delete',
        toolUseId: bashEditToolUseId(bashToolUseId, index),
        input: JSON.stringify(hasHunks ? { file_path: file.filePath, diff: hunksToUnifiedDiff(file.hunks) } : { file_path: file.filePath }),
        filePath: file.filePath,
        added: 0,
        removed,
        pathOnly: !hasHunks,
      })
      continue
    }
    if (file.created) {
      rows.push({
        toolName: 'Write',
        toolUseId: bashEditToolUseId(bashToolUseId, index),
        input: JSON.stringify(hasHunks ? { file_path: file.filePath, content: hunksToContent(file.hunks) } : { file_path: file.filePath }),
        filePath: file.filePath,
        added,
        removed: 0,
        pathOnly: !hasHunks,
      })
      continue
    }
    rows.push({
      toolName: 'Edit',
      toolUseId: bashEditToolUseId(bashToolUseId, index),
      input: JSON.stringify(hasHunks ? { file_path: file.filePath, diff: hunksToUnifiedDiff(file.hunks) } : { file_path: file.filePath }),
      filePath: file.filePath,
      added,
      removed,
      pathOnly: !hasHunks,
    })
  }
  for (const filePath of diff.changedFiles ?? []) {
    if (seen.has(filePath)) continue
    seen.add(filePath)
    rows.push({
      toolName: 'Edit',
      toolUseId: bashEditToolUseId(bashToolUseId, rows.length),
      input: JSON.stringify({ file_path: filePath }),
      filePath,
      added: 0,
      removed: 0,
      pathOnly: true,
    })
  }
  return rows
}

/** Header totals: file count includes the hidden `moreFiles`, line counts only what came through. */
export function summarizeBashEditDiff(diff: BashEditDiff): BashEditDiffSummary {
  const rows = bashEditToolUses('', diff)
  let added = 0
  let removed = 0
  let pathOnly = 0
  for (const row of rows) {
    added += row.added
    removed += row.removed
    if (row.pathOnly) pathOnly++
  }
  // `changedFiles` already lists the hidden files when it is longer than `files`,
  // so only count `moreFiles` past what the rows cover.
  const hidden = Math.max(0, diff.files.length + diff.moreFiles - rows.length)
  return {
    files: rows.length + hidden,
    added,
    removed,
    approximate: hidden > 0 || pathOnly > 0 || diff.unavailable === true,
  }
}

/** The per-file rows as the turn stat consumes them (path + line delta). */
export function bashEditFileChanges(diff: BashEditDiff): TaskFileChange[] {
  return bashEditToolUses('', diff).map((row) => ({ path: row.filePath, added: row.added, removed: row.removed }))
}
