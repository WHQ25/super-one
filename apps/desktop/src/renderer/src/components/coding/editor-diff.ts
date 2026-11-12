import { structuredPatch } from 'diff'
import { formatFilePrefix, lineKindToMarker } from '@superone/shared/file-quote-prefix'
import { splitContentLines } from '@/lib/text-lines'
import type { MinimapLine } from './CodeMinimap'

export type DiffChangeKind = 'added' | 'modified' | 'deleted'

export interface EditorDiffChange {
  id: string
  kind: DiffChangeKind
  oldStartLine: number
  oldLines: string[]
  newStartLine: number
  newEndLine: number
  newLines: string[]
  anchorLine: number
  deletePosition?: 'above' | 'below'
}

function makeChange(
  oldStartLine: number,
  oldLines: string[],
  newStartLine: number,
  newLines: string[],
  newLineCount: number,
): EditorDiffChange {
  const safeMaxLine = Math.max(1, newLineCount)
  if (oldLines.length === 0) {
    const newEndLine = newStartLine + newLines.length - 1
    return {
      id: `add:${newStartLine}:${newEndLine}`,
      kind: 'added',
      oldStartLine,
      oldLines,
      newStartLine,
      newEndLine,
      newLines,
      anchorLine: newStartLine,
    }
  }
  if (newLines.length === 0) {
    const isTop = newStartLine <= 1
    const anchorLine = isTop ? 1 : Math.min(newStartLine - 1, safeMaxLine)
    return {
      id: `del:${oldStartLine}:${anchorLine}:${isTop ? 'above' : 'below'}`,
      kind: 'deleted',
      oldStartLine,
      oldLines,
      newStartLine,
      newEndLine: newStartLine - 1,
      newLines,
      anchorLine,
      deletePosition: isTop ? 'above' : 'below',
    }
  }
  const newEndLine = newStartLine + newLines.length - 1
  return {
    id: `mod:${newStartLine}:${newEndLine}`,
    kind: 'modified',
    oldStartLine,
    oldLines,
    newStartLine,
    newEndLine,
    newLines,
    anchorLine: newStartLine,
  }
}

export function parseEditorDiffChanges(unifiedDiff: string, newLineCount: number): EditorDiffChange[] {
  if (!unifiedDiff) return []
  const rows = splitContentLines(unifiedDiff)
  const changes: EditorDiffChange[] = []

  let inHunk = false
  let oldLine = 1
  let newLine = 1
  let runOldStart = 1
  let runNewStart = 1
  let oldBuf: string[] = []
  let newBuf: string[] = []

  const flush = () => {
    if (oldBuf.length === 0 && newBuf.length === 0) return
    changes.push(makeChange(runOldStart, oldBuf, Math.max(1, runNewStart), newBuf, newLineCount))
    oldBuf = []
    newBuf = []
  }

  for (const row of rows) {
    if (row.startsWith('@@')) {
      flush()
      const match = row.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/)
      if (match) {
        oldLine = Number(match[1])
        newLine = Number(match[2])
        inHunk = true
      } else {
        inHunk = false
      }
      continue
    }
    if (!inHunk || row.startsWith('\\')) continue

    if (row.startsWith('-')) {
      if (oldBuf.length === 0 && newBuf.length === 0) {
        runOldStart = oldLine
        runNewStart = newLine
      }
      oldBuf.push(row.slice(1))
      oldLine++
      continue
    }

    if (row.startsWith('+')) {
      if (oldBuf.length === 0 && newBuf.length === 0) {
        runOldStart = oldLine
        runNewStart = newLine
      }
      newBuf.push(row.slice(1))
      newLine++
      continue
    }

    flush()
    oldLine++
    newLine++
  }

  flush()
  return changes
}

interface RawHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  rows: string[]
}

function parseRawHunks(unifiedDiff: string): RawHunk[] {
  const rows = splitContentLines(unifiedDiff)
  const hunks: RawHunk[] = []
  let current: RawHunk | null = null

  for (const row of rows) {
    if (row.startsWith('@@')) {
      const match = row.match(/^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/)
      if (match) {
        current = {
          oldStart: Number(match[1]),
          oldCount: match[2] !== undefined ? Number(match[2]) : 1,
          newStart: Number(match[3]),
          newCount: match[4] !== undefined ? Number(match[4]) : 1,
          rows: [],
        }
        hunks.push(current)
      } else {
        current = null
      }
      continue
    }
    if (current) current.rows.push(row)
  }
  return hunks
}

function inferOldTrailingNewline(diskContent: string, hunks: RawHunk[], diskLineCount: number): boolean {
  if (hunks.length === 0) return diskContent.endsWith('\n')
  const last = hunks[hunks.length - 1]
  let lastOldRowIdx = -1
  for (let i = 0; i < last.rows.length; i++) {
    const r = last.rows[i]
    if (r.startsWith('-') || r.startsWith(' ')) lastOldRowIdx = i
  }
  if (lastOldRowIdx >= 0 && last.rows[lastOldRowIdx + 1]?.startsWith('\\')) {
    return false
  }
  const hunkTouchesEof = last.newCount === 0
    ? last.newStart >= diskLineCount
    : last.newStart + last.newCount - 1 >= diskLineCount
  if (hunkTouchesEof && lastOldRowIdx >= 0) {
    return true
  }
  return diskContent.endsWith('\n')
}

export function reconstructBaseContent(diskContent: string, unifiedDiff: string): string {
  if (!unifiedDiff) return diskContent
  const hunks = parseRawHunks(unifiedDiff)
  if (hunks.length === 0) return diskContent

  const eol = diskContent.includes('\r\n') ? '\r\n' : '\n'
  const lines = splitContentLines(diskContent)
  const oldHasTrailingNewline = inferOldTrailingNewline(diskContent, hunks, lines.length)

  for (let i = hunks.length - 1; i >= 0; i--) {
    const hunk = hunks[i]
    const oldHunkLines: string[] = []
    for (const row of hunk.rows) {
      if (row.startsWith('\\') || row.startsWith('+')) continue
      oldHunkLines.push(row.startsWith('-') || row.startsWith(' ') ? row.slice(1) : row)
    }
    const spliceAt = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1
    lines.splice(spliceAt, hunk.newCount, ...oldHunkLines)
  }

  if (lines.length === 0) return ''
  return lines.join(eol) + (oldHasTrailingNewline ? eol : '')
}

export function computeLiveDiffChanges(baseContent: string, currentContent: string): EditorDiffChange[] {
  const normBase = baseContent.replace(/\r\n/g, '\n')
  const normCurrent = currentContent.replace(/\r\n/g, '\n')
  if (normBase === normCurrent) return []

  const newLineCount = splitContentLines(normCurrent).length
  const patch = structuredPatch('a', 'b', normBase, normCurrent, '', '', { context: 0 })
  const changes: EditorDiffChange[] = []

  for (const hunk of patch.hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    let runOldStart = oldLine
    let runNewStart = newLine
    let oldBuf: string[] = []
    let newBuf: string[] = []

    const flush = () => {
      if (oldBuf.length === 0 && newBuf.length === 0) return
      changes.push(makeChange(runOldStart, oldBuf, Math.max(1, runNewStart), newBuf, newLineCount))
      oldBuf = []
      newBuf = []
    }

    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue
      if (line.startsWith('-')) {
        if (oldBuf.length === 0 && newBuf.length === 0) {
          runOldStart = oldLine
          runNewStart = newLine
        }
        oldBuf.push(line.slice(1))
        oldLine++
      } else if (line.startsWith('+')) {
        if (oldBuf.length === 0 && newBuf.length === 0) {
          runOldStart = oldLine
          runNewStart = newLine
        }
        newBuf.push(line.slice(1))
        newLine++
      } else {
        flush()
        oldLine++
        newLine++
      }
    }
    flush()
  }

  return changes
}

export function findChangeForGutterLine(
  changes: readonly EditorDiffChange[],
  lineNumber: number,
  pointerHalf: 'top' | 'bottom' = 'bottom',
): EditorDiffChange | null {
  for (const change of changes) {
    if (change.kind !== 'deleted' && lineNumber >= change.newStartLine && lineNumber <= change.newEndLine) {
      return change
    }
  }
  const deletedOnLine = changes.filter((c) => c.kind === 'deleted' && c.anchorLine === lineNumber)
  if (deletedOnLine.length === 0) return null
  if (deletedOnLine.length === 1) return deletedOnLine[0]
  const preferred = pointerHalf === 'top' ? 'above' : 'below'
  return deletedOnLine.find((c) => c.deletePosition === preferred) ?? deletedOnLine[0]
}

export function revertDiffChange(currentContent: string, change: EditorDiffChange): string {
  const eol = currentContent.includes('\r\n') ? '\r\n' : '\n'
  const hadTrailingNewline = currentContent === '' ? true : currentContent.endsWith('\n')
  const lines = splitContentLines(currentContent)

  if (change.kind === 'added') {
    lines.splice(change.newStartLine - 1, change.newLines.length)
  } else if (change.kind === 'modified') {
    lines.splice(change.newStartLine - 1, change.newLines.length, ...change.oldLines)
  } else {
    const insertIdx = Math.max(0, Math.min(change.newStartLine - 1, lines.length))
    lines.splice(insertIdx, 0, ...change.oldLines)
  }

  if (lines.length === 0) return ''
  return lines.join(eol) + (hadTrailingNewline ? eol : '')
}

export function buildEditorMinimapLines(content: string, changes: readonly EditorDiffChange[]): MinimapLine[] {
  const rawLines = splitContentLines(content)
  const result: MinimapLine[] = rawLines.map((text, i) => ({
    kind: 'unchanged',
    lineNum: i + 1,
    text,
    sourceIdx: i,
  }))
  if (changes.length === 0 || result.length === 0) return result

  for (const ch of changes) {
    if (ch.kind === 'added' || ch.kind === 'modified') {
      const start = Math.max(1, ch.newStartLine)
      const end = Math.min(result.length, ch.newEndLine)
      for (let ln = start; ln <= end; ln++) {
        result[ln - 1].kind = ch.kind
      }
    } else {
      const ln = Math.max(1, Math.min(result.length, ch.anchorLine))
      if (ch.deletePosition === 'above') {
        result[ln - 1].deletedAbove = true
      } else {
        result[ln - 1].deletedBelow = true
      }
    }
  }
  return result
}

/** Composer quote for one gutter hunk, in the same `path:Lx:D` shape as a diff selection. */
export function formatDiffHunkQuote(filePath: string, change: EditorDiffChange): string {
  const range = change.kind === 'deleted'
    ? `L${change.anchorLine}`
    : change.newStartLine === change.newEndLine
      ? `L${change.newStartLine}`
      : `L${change.newStartLine}-L${change.newEndLine}`
  const body = [
    ...change.oldLines.map((line) => `${lineKindToMarker('removed')}${line}`),
    ...change.newLines.map((line) => `${lineKindToMarker('added')}${line}`),
  ].join('\n')
  return `${formatFilePrefix(filePath, range, undefined, undefined, true)}\n${body}`
}
