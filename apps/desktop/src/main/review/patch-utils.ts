import { applyPatch } from 'diff'
import type { ReviewDiffSource, ReviewFileDiff, ReviewFileStatus } from '@superone/shared/review-types'

const MAX_FILES_PER_DIFF = 500
const MAX_PATCH_CHARS = 256 * 1024

export function normalizePosixPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function countPatchLines(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  let inHunk = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  return { additions, deletions }
}

export function splitUnifiedDiffByFile(rawDiff: string, source: ReviewDiffSource): ReviewFileDiff[] {
  if (!rawDiff.trim()) return []
  const sections: string[] = []
  const lines = rawDiff.split('\n')
  let current: string[] = []

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current.length > 0) sections.push(current.join('\n'))
      current = [line]
    } else if (current.length > 0) {
      current.push(line)
    }
  }
  if (current.length > 0) sections.push(current.join('\n'))

  const files: ReviewFileDiff[] = []
  for (const section of sections.slice(0, MAX_FILES_PER_DIFF)) {
    const parsed = parseSingleGitDiffSection(section, source)
    if (parsed) files.push(parsed)
  }
  return files
}

function unquoteGitPath(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function parseSingleGitDiffSection(section: string, source: ReviewDiffSource): ReviewFileDiff | null {
  const sectionLines = section.split('\n')
  const header = sectionLines[0] ?? ''
  const match = header.match(/^diff --git ("?a\/.+?"?) ("?b\/.+?"?)$/)
  let oldPath = match ? unquoteGitPath(match[1]).replace(/^a\//, '') : ''
  let newPath = match ? unquoteGitPath(match[2]).replace(/^b\//, '') : ''

  let status: ReviewFileStatus = 'modified'
  let isBinary = false

  for (const line of sectionLines.slice(1, 15)) {
    if (line.startsWith('new file mode')) status = 'added'
    else if (line.startsWith('deleted file mode')) status = 'deleted'
    else if (line.startsWith('rename from ')) {
      status = 'renamed'
      oldPath = unquoteGitPath(line.slice('rename from '.length))
    } else if (line.startsWith('rename to ')) {
      status = 'renamed'
      newPath = unquoteGitPath(line.slice('rename to '.length))
    } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      isBinary = true
    } else if (line.startsWith('@@')) {
      break
    }
  }

  const path = normalizePosixPath(status === 'deleted' ? (oldPath || newPath) : (newPath || oldPath))
  if (!path) return null

  const { additions, deletions } = isBinary ? { additions: 0, deletions: 0 } : countPatchLines(section)
  const truncatedPatch = section.length > MAX_PATCH_CHARS ? '' : section

  return {
    path,
    ...(status === 'renamed' && oldPath && oldPath !== newPath ? { oldPath: normalizePosixPath(oldPath) } : {}),
    status,
    additions,
    deletions,
    patch: isBinary ? '' : truncatedPatch,
    ...(isBinary ? { isBinary: true } : {}),
    source,
  }
}

export function synthesizeAddedFilePatch(filePath: string, content: string): string {
  const normalized = normalizePosixPath(filePath)
  if (!content) {
    return [
      `diff --git a/${normalized} b/${normalized}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${normalized}`,
    ].join('\n')
  }
  const hasTrailingNewline = content.endsWith('\n')
  const rawLines = hasTrailingNewline ? content.slice(0, -1).split('\n') : content.split('\n')
  const body = rawLines.map((line) => `+${line}`)
  if (!hasTrailingNewline) body.push('\\ No newline at end of file')
  return [
    `diff --git a/${normalized} b/${normalized}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${normalized}`,
    `@@ -0,0 +1,${rawLines.length} @@`,
    ...body,
  ].join('\n')
}

export function synthesizeDeletedFilePatch(filePath: string, content: string): string {
  const normalized = normalizePosixPath(filePath)
  if (!content) {
    return [
      `diff --git a/${normalized} b/${normalized}`,
      'deleted file mode 100644',
      `--- a/${normalized}`,
      '+++ /dev/null',
    ].join('\n')
  }
  const hasTrailingNewline = content.endsWith('\n')
  const rawLines = hasTrailingNewline ? content.slice(0, -1).split('\n') : content.split('\n')
  const body = rawLines.map((line) => `-${line}`)
  if (!hasTrailingNewline) body.push('\\ No newline at end of file')
  return [
    `diff --git a/${normalized} b/${normalized}`,
    'deleted file mode 100644',
    `--- a/${normalized}`,
    '+++ /dev/null',
    `@@ -1,${rawLines.length} +0,0 @@`,
    ...body,
  ].join('\n')
}

export function reverseUnifiedPatch(patch: string): string {
  const lines = patch.split('\n')
  const out: string[] = []
  let inHunk = false

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      inHunk = false
      out.push(line)
      continue
    }
    if (line.startsWith('--- ')) {
      inHunk = false
      out.push(`+++ ${line.slice(4)}`)
      continue
    }
    if (line.startsWith('+++ ')) {
      inHunk = false
      const prev = out[out.length - 1]
      if (prev && prev.startsWith('+++ ')) {
        out[out.length - 1] = `--- ${line.slice(4)}`
        out.push(prev)
      } else {
        out.push(`--- ${line.slice(4)}`)
      }
      continue
    }
    if (line.startsWith('@@')) {
      inHunk = true
      const match = line.match(/^@@ -(\d+(?:,\d+)?) \+(\d+(?:,\d+)?) @@(.*)$/)
      if (match) {
        out.push(`@@ -${match[2]} +${match[1]} @@${match[3]}`)
      } else {
        out.push(line)
      }
      continue
    }
    if (!inHunk) {
      if (line.startsWith('new file mode')) out.push(line.replace('new file mode', 'deleted file mode'))
      else if (line.startsWith('deleted file mode')) out.push(line.replace('deleted file mode', 'new file mode'))
      else out.push(line)
      continue
    }
    if (line.startsWith('+')) out.push(`-${line.slice(1)}`)
    else if (line.startsWith('-')) out.push(`+${line.slice(1)}`)
    else out.push(line)
  }

  return out.join('\n')
}

export function applyReversePatchToContent(currentContent: string, patch: string): string | null {
  const reversed = reverseUnifiedPatch(patch)
  const applied = applyPatch(currentContent, reversed, { fuzzFactor: 1 })
  if (applied === false) return null
  return applied
}

export function sumFileDiffTotals(files: readonly ReviewFileDiff[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const file of files) {
    additions += file.additions
    deletions += file.deletions
  }
  return { additions, deletions }
}
