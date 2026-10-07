import type { BashEditToolUse } from './bash-edit-diff'

/** Display data, never an executor: parse the marker-based patch used by OpenCode V1/V2. */
export interface PatchToolFile {
  path: string
  kind: 'add' | 'update' | 'delete'
  movePath?: string
  /** Prefixed diff rows; section markers/anchors are not source lines. */
  diff?: string
  added: number
  removed: number
}

export function isPatchToolName(name: string): boolean {
  return name === 'Patch' || name === 'patch' || name === 'apply_patch'
}

/** Older transcript adapters called apply_patch `Edit`; keep its distinct payload identity. */
export function isPatchToolCall(name: string, input: Record<string, unknown>): boolean {
  return isPatchToolName(name) || (name === 'Edit' && (typeof input.patchText === 'string' || input.patch === true))
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Also accepts privacy-projected file headers (diffs arrive only on expansion). */
export function patchToolFiles(input: Record<string, unknown>): PatchToolFile[] {
  if (typeof input.patchText === 'string') return parsePatchToolText(input.patchText)
  if (!Array.isArray(input.files)) return []
  return input.files.flatMap((value) => {
    const file = record(value)
    if (!file || typeof file.path !== 'string' || !file.path || !['add', 'update', 'delete'].includes(String(file.kind))) return []
    const count = (key: string): number => typeof file[key] === 'number' && Number.isFinite(file[key]) ? Math.max(0, Math.floor(file[key])) : 0
    return [{
      path: file.path,
      kind: file.kind as PatchToolFile['kind'],
      ...(typeof file.movePath === 'string' && file.movePath ? { movePath: file.movePath } : {}),
      ...(typeof file.diff === 'string' ? { diff: file.diff } : {}),
      added: count('added'),
      removed: count('removed'),
    }]
  })
}

/** Tolerates an unfinished patch while input streams; only complete marker lines name files. */
export function parsePatchToolText(text: string): PatchToolFile[] {
  const lines = text.replace(/\r\n/g, '\n').trimStart().split('\n')
  if (lines[0]?.trim() !== '*** Begin Patch') return []
  const files: PatchToolFile[] = []
  let current: PatchToolFile | undefined
  const rows: string[] = []
  const flush = (): void => {
    if (!current) return
    if (rows.length) current.diff = rows.join('\n')
    files.push(current)
    current = undefined
    rows.length = 0
  }
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index]!
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line)
    if (header) {
      flush()
      // An unclosed last line may still be a partial filename, not a target yet.
      if (index === lines.length - 1) break
      const path = header[2]!.trim()
      if (path) current = { path, kind: header[1]!.toLowerCase() as PatchToolFile['kind'], added: 0, removed: 0 }
    } else if (line === '*** End Patch') {
      flush()
      break
    } else if (current && line.startsWith('*** Move to: ') && index < lines.length - 1) {
      const path = line.slice('*** Move to: '.length).trim()
      if (path) current.movePath = path
    } else if (current && /^[+ -]/.test(line)) {
      rows.push(line)
      if (line.startsWith('+')) current.added++
      if (line.startsWith('-')) current.removed++
    }
  }
  flush()
  return files
}

export function patchToolLineDelta(input: Record<string, unknown>): { added: number; removed: number } {
  const { added, removed } = summarizePatchToolFiles(patchToolFiles(input))
  return { added, removed }
}

/** One count contract for the collapsed header and Detail, including repeated sections. */
export function summarizePatchToolFiles(files: readonly PatchToolFile[]): { files: number; added: number; removed: number; approximate: boolean } {
  const paths = new Set<string>()
  let added = 0
  let removed = 0
  let approximate = false
  for (const file of files) {
    paths.add(file.movePath ?? file.path)
    added += file.added
    removed += file.removed
    // A Delete marker has no old contents. Preserve known counts, never invent
    // removed lines (including after the phone strips a known deletion's diff).
    if (file.kind === 'delete' && !file.diff && file.removed === 0) approximate = true
  }
  return { files: paths.size, added, removed, approximate }
}

/** Feed the same Edit / Write / Delete rows that Claude Bash's changed-file area uses. */
export function patchFileToolUse(parentId: string, index: number, file: PatchToolFile): BashEditToolUse {
  const filePath = file.movePath ?? file.path
  const toolName = file.kind === 'add' ? 'Write' : file.kind === 'delete' ? 'Delete' : 'Edit'
  const params: Record<string, unknown> = { file_path: filePath }
  if (file.diff) {
    if (toolName === 'Write') params.content = file.diff.split('\n').map((line) => line.slice(1)).join('\n') + '\n'
    else params.diff = file.diff
  }
  return {
    toolName, toolUseId: `${parentId}#patch${index}`, input: JSON.stringify(params),
    filePath, added: file.added, removed: file.removed, pathOnly: !file.diff,
  }
}
