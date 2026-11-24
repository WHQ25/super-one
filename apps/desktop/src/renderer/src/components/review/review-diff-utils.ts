import type { DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs/react'
import { formatFilePrefix, lineKindToMarker } from '@superone/shared/file-quote-prefix'
import type { ReviewFileDiff } from '@superone/shared/review-types'
import { codeCommentAnchor, quoteMatchesFile } from '@/components/coding/code-comment-anchor'
import { measureCharWidth } from '@/lib/pretext-utils'
import type { ReplyComment } from '@/stores/chat'

export interface ReviewHunkDescriptor {
  index: number
  header: string
  oldStart: number
  newStart: number
  additions: number
  deletions: number
  singleHunkPatch: string
}

export interface ReviewDraftAnnotation {
  side: 'additions' | 'deletions'
  startLine: number
  endLine: number
}

export type ReviewAnnotationMeta =
  | { kind: 'comment'; comment: ReplyComment }
  | { kind: 'draft'; draft: ReviewDraftAnnotation }

export function extractIndividualHunkPatches(filePath: string, patch: string): ReviewHunkDescriptor[] {
  if (!patch.trim()) return []
  const lines = patch.split('\n')
  const headerLines: string[] = []
  const rawHunks: { header: string; body: string[] }[] = []
  let current: { header: string; body: string[] } | null = null

  for (const line of lines) {
    if (line.startsWith('@@')) {
      current = { header: line, body: [] }
      rawHunks.push(current)
      continue
    }
    if (!current) {
      headerLines.push(line)
    } else {
      current.body.push(line)
    }
  }

  const normalizedHeader = headerLines.length > 0
    ? headerLines
    : [`diff --git a/${filePath} b/${filePath}`, `--- a/${filePath}`, `+++ b/${filePath}`]

  return rawHunks.map((hunk, idx) => {
    const match = hunk.header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    const oldStart = match ? Number(match[1]) : 1
    const newStart = match ? Number(match[2]) : 1
    let additions = 0
    let deletions = 0
    for (const row of hunk.body) {
      if (row.startsWith('+') && !row.startsWith('+++')) additions += 1
      else if (row.startsWith('-') && !row.startsWith('---')) deletions += 1
    }
    return {
      index: idx + 1,
      header: hunk.header,
      oldStart,
      newStart,
      additions,
      deletions,
      singleHunkPatch: [...normalizedHeader, hunk.header, ...hunk.body].join('\n'),
    }
  })
}

export function extractPatchLineMap(patch: string): {
  additions: Map<number, { kind: 'added' | 'unchanged'; text: string }>
  deletions: Map<number, { kind: 'removed' | 'unchanged'; text: string }>
} {
  const additions = new Map<number, { kind: 'added' | 'unchanged'; text: string }>()
  const deletions = new Map<number, { kind: 'removed' | 'unchanged'; text: string }>()
  let oldLine = 0
  let newLine = 0
  let inHunk = false

  for (const row of patch.split('\n')) {
    if (row.startsWith('@@')) {
      const m = row.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) {
        oldLine = Number(m[1])
        newLine = Number(m[2])
        inHunk = true
      } else {
        inHunk = false
      }
      continue
    }
    if (!inHunk || row.startsWith('\\')) continue
    if (row.startsWith('+')) {
      additions.set(newLine, { kind: 'added', text: row.slice(1) })
      newLine += 1
    } else if (row.startsWith('-')) {
      deletions.set(oldLine, { kind: 'removed', text: row.slice(1) })
      oldLine += 1
    } else {
      const text = row.startsWith(' ') ? row.slice(1) : row
      additions.set(newLine, { kind: 'unchanged', text })
      deletions.set(oldLine, { kind: 'unchanged', text })
      oldLine += 1
      newLine += 1
    }
  }
  return { additions, deletions }
}

export function normalizeLineSelection(range: SelectedLineRange): ReviewDraftAnnotation {
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  const side = range.side === 'deletions' ? 'deletions' : 'additions'
  return { side, startLine: start, endLine: end }
}

export function formatReviewSelectionQuote(
  filePath: string,
  draft: ReviewDraftAnnotation,
  patch: string,
): string {
  const maps = extractPatchLineMap(patch)
  const sideMap = draft.side === 'deletions' ? maps.deletions : maps.additions
  const lineRange = draft.startLine === draft.endLine
    ? `L${draft.startLine}`
    : `L${draft.startLine}-L${draft.endLine}`
  const bodyLines: string[] = []
  let hasDiffMarker = false

  for (let ln = draft.startLine; ln <= draft.endLine; ln += 1) {
    const entry = sideMap.get(ln)
    if (!entry) continue
    if (entry.kind !== 'unchanged') hasDiffMarker = true
    bodyLines.push(`${lineKindToMarker(entry.kind)}${entry.text}`)
  }

  const prefix = formatFilePrefix(filePath, lineRange, undefined, undefined, hasDiffMarker || draft.side === 'deletions')
  return bodyLines.length > 0 ? `${prefix}\n${bodyLines.join('\n')}` : prefix
}

export function buildFullFilePath(root: string, relPath: string): string {
  if (!root) return relPath
  const trimmedRoot = root.replace(/\/$/, '')
  return relPath.startsWith('/') ? relPath : `${trimmedRoot}/${relPath}`
}

export function buildAnnotationsForFile(
  comments: readonly ReplyComment[],
  filePath: string,
  root: string,
  draft: ReviewDraftAnnotation | null,
): DiffLineAnnotation<ReviewAnnotationMeta>[] {
  const fullPath = buildFullFilePath(root, filePath)
  const annotations: DiffLineAnnotation<ReviewAnnotationMeta>[] = []

  for (const comment of comments) {
    const anchor = codeCommentAnchor(comment.quote)
    if (!anchor || !quoteMatchesFile(anchor.filePath, fullPath, filePath)) continue
    const lastLine = anchor.lines[anchor.lines.length - 1]
    if (!lastLine) continue
    const isRemovedOnly = comment.quote.split('\n').slice(1).every((l) => l.startsWith('-'))
      && comment.quote.split('\n').length > 1
    annotations.push({
      side: isRemovedOnly ? 'deletions' : 'additions',
      lineNumber: lastLine,
      metadata: { kind: 'comment', comment },
    })
  }

  if (draft) {
    annotations.push({
      side: draft.side,
      lineNumber: draft.endLine,
      metadata: { kind: 'draft', draft },
    })
  }

  return annotations
}

export function countCommentsByFile(
  comments: readonly ReplyComment[],
  files: readonly ReviewFileDiff[],
  root: string,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const file of files) {
    const fullPath = buildFullFilePath(root, file.path)
    let total = 0
    for (const comment of comments) {
      const anchor = codeCommentAnchor(comment.quote)
      if (anchor && quoteMatchesFile(anchor.filePath, fullPath, file.path)) {
        total += 1
      }
    }
    if (total > 0) counts.set(file.path, total)
  }
  return counts
}

export const SPLIT_DIFF_MIN_COLUMNS = 80
const SPLIT_DIFF_SIDE_PADDING_CHARS = 5
const SPLIT_DIFF_BORDER_PX = 5
const DEFAULT_DIFF_FONT_SIZE = '13px'
const DEFAULT_DIFF_FONT_FAMILY = '"SF Mono", Monaco, Consolas, "Ubuntu Mono", "Liberation Mono", "Courier New", monospace'
const DEFAULT_DIFF_CHAR_WIDTH_PX = 7.8

export function measureDiffCharWidthPx(element?: HTMLElement | null): number {
  if (typeof document === 'undefined') return DEFAULT_DIFF_CHAR_WIDTH_PX
  const computed = element ? getComputedStyle(element) : null
  const fontSize = computed?.getPropertyValue('--diffs-font-size').trim() || DEFAULT_DIFF_FONT_SIZE
  const fontFamily = computed?.getPropertyValue('--diffs-font-family').trim() || DEFAULT_DIFF_FONT_FAMILY
  return measureCharWidth(`${fontSize} ${fontFamily}`, DEFAULT_DIFF_CHAR_WIDTH_PX)
}

export function maxLineNumberInPatch(patch: string): number {
  if (!patch) return 0
  let maxLine = 0
  const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm
  let match: RegExpExecArray | null
  while ((match = hunkRe.exec(patch)) !== null) {
    const oldStart = Number(match[1])
    const oldCount = match[2] !== undefined ? Number(match[2]) : 1
    const newStart = Number(match[3])
    const newCount = match[4] !== undefined ? Number(match[4]) : 1
    const oldEnd = oldStart + Math.max(0, oldCount - 1)
    const newEnd = newStart + Math.max(0, newCount - 1)
    if (oldEnd > maxLine) maxLine = oldEnd
    if (newEnd > maxLine) maxLine = newEnd
  }
  return maxLine
}

export function maxLineNumberDigitsForFiles(files: readonly Pick<ReviewFileDiff, 'patch'>[]): number {
  let maxLine = 0
  for (const file of files) {
    const fileMax = maxLineNumberInPatch(file.patch)
    if (fileMax > maxLine) maxLine = fileMax
  }
  return maxLine > 0 ? String(maxLine).length : 3
}

export function computeSplitDiffMinWidthPx(
  charWidthPx = DEFAULT_DIFF_CHAR_WIDTH_PX,
  lineNumberDigits = 3,
): number {
  const safeCharWidth = Number.isFinite(charWidthPx) && charWidthPx > 0 ? charWidthPx : DEFAULT_DIFF_CHAR_WIDTH_PX
  const safeDigits = Math.max(1, Math.floor(lineNumberDigits))
  const perSideChars = SPLIT_DIFF_MIN_COLUMNS + safeDigits + SPLIT_DIFF_SIDE_PADDING_CHARS
  return Math.ceil(perSideChars * 2 * safeCharWidth + SPLIT_DIFF_BORDER_PX)
}

export function resolveAutoDiffStyle(
  paneWidthPx: number,
  charWidthPx = DEFAULT_DIFF_CHAR_WIDTH_PX,
  lineNumberDigits = 3,
): 'split' | 'unified' {
  return paneWidthPx >= computeSplitDiffMinWidthPx(charWidthPx, lineNumberDigits) ? 'split' : 'unified'
}

export function splitDirAndBase(filePath: string): { dir: string; base: string } {
  const idx = filePath.lastIndexOf('/')
  if (idx < 0) return { dir: '', base: filePath }
  return { dir: filePath.slice(0, idx), base: filePath.slice(idx + 1) }
}
