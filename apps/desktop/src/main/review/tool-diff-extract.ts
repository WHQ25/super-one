import { isAbsolute, relative } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { bashEditToolUses } from '@superone/shared/bash-edit-diff'
import { fileMutationPath, isFileMutationTool } from '@superone/shared/file-mutation'
import { isPatchToolCall, patchToolFiles } from '@superone/shared/patch-tool'
import { normalizeTranscriptTool } from '@superone/shared/tool-ui'
import type { ReviewFileDiff, ReviewFileStatus, ReviewTurnDiff } from '@superone/shared/review-types'
import {
  countPatchLines,
  normalizePosixPath,
  sumFileDiffTotals,
  synthesizeAddedFilePatch,
  synthesizeDeletedFilePatch,
} from './patch-utils'

function toRepoRelativePath(filePath: string, rootDir: string): string {
  if (!filePath) return ''
  const clean = filePath.trim()
  if (isAbsolute(clean) && rootDir) {
    const rel = relative(rootDir, clean)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      return normalizePosixPath(rel)
    }
  }
  return normalizePosixPath(clean)
}

function parseInputObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function buildPatchFromToolInput(
  toolName: string,
  input: Record<string, unknown>,
  relPath: string,
): { status: ReviewFileStatus; patch: string } | null {
  if (typeof input.diff === 'string' && input.diff.trim()) {
    const rawDiff = input.diff
    const patch = rawDiff.startsWith('diff --git ')
      ? rawDiff
      : [
          `diff --git a/${relPath} b/${relPath}`,
          `--- a/${relPath}`,
          `+++ b/${relPath}`,
          rawDiff,
        ].join('\n')
    const status: ReviewFileStatus = toolName === 'Delete' ? 'deleted' : 'modified'
    return { status, patch }
  }
  if (typeof input.diffString === 'string' && input.diffString.trim()) {
    const rawDiff = input.diffString
    const patch = rawDiff.startsWith('diff --git ')
      ? rawDiff
      : [
          `diff --git a/${relPath} b/${relPath}`,
          `--- a/${relPath}`,
          `+++ b/${relPath}`,
          rawDiff,
        ].join('\n')
    return { status: 'modified', patch }
  }
  if (toolName === 'Write' && typeof input.content === 'string') {
    return { status: 'added', patch: synthesizeAddedFilePatch(relPath, input.content) }
  }
  if (toolName === 'Delete') {
    return { status: 'deleted', patch: synthesizeDeletedFilePatch(relPath, '') }
  }
  const oldStr = typeof input.old_string === 'string'
    ? input.old_string
    : typeof input.old_source === 'string'
      ? input.old_source
      : typeof input.oldText === 'string'
        ? input.oldText
        : null
  const newStr = typeof input.new_string === 'string'
    ? input.new_string
    : typeof input.new_source === 'string'
      ? input.new_source
      : typeof input.newText === 'string'
        ? input.newText
        : null

  if (oldStr !== null || newStr !== null) {
    const patch = createTwoFilesPatch(
      `a/${relPath}`,
      `b/${relPath}`,
      oldStr ?? '',
      newStr ?? '',
      '',
      '',
      { context: 3 },
    )
    const cleanPatch = `diff --git a/${relPath} b/${relPath}\n${patch.replace(/^Index:.*\n=+\n/, '')}`
    const status: ReviewFileStatus = oldStr === null ? 'added' : newStr === null ? 'deleted' : 'modified'
    return { status, patch: cleanPatch }
  }
  return null
}

function collectBlocksFromMessages(messages: readonly ChatMessage[]): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) blocks.push(block)
    }
  }
  return blocks
}

export function extractTurnToolTouchedPaths(messages: readonly ChatMessage[], rootDir: string): Set<string> {
  const paths = new Set<string>()
  const blocks = collectBlocksFromMessages(messages)

  for (const block of blocks) {
    if (block.type === 'tool_use') {
      const rawInput = parseInputObject(block.input)
      if (isPatchToolCall(block.toolName ?? '', rawInput)) {
        for (const f of patchToolFiles(rawInput)) {
          const p = toRepoRelativePath(f.movePath ?? f.path, rootDir)
          if (p) paths.add(p)
        }
        continue
      }
      const normalized = normalizeTranscriptTool(block.toolName ?? '', rawInput)
      if (isFileMutationTool(normalized.toolName)) {
        const rawPath = fileMutationPath(normalized.input) || block.toolFilePath || ''
        const p = toRepoRelativePath(rawPath, rootDir)
        if (p) paths.add(p)
      }
      for (const change of block.taskFileChanges ?? []) {
        const p = toRepoRelativePath(change.path, rootDir)
        if (p) paths.add(p)
      }
    } else if (block.type === 'tool_result' && block.bashEditDiff) {
      for (const row of bashEditToolUses(block.toolUseId ?? '', block.bashEditDiff)) {
        const p = toRepoRelativePath(row.filePath, rootDir)
        if (p) paths.add(p)
      }
    }
  }

  for (const msg of messages) {
    const codexItems = msg.metadata?.codex?.items ?? []
    for (const item of codexItems) {
      if (item.type === 'file_change') {
        for (const change of item.changes ?? []) {
          const p = toRepoRelativePath(change.path, rootDir)
          if (p) paths.add(p)
        }
      }
    }
  }

  return paths
}

function upsertFileDiff(target: Map<string, ReviewFileDiff>, entry: ReviewFileDiff): void {
  const existing = target.get(entry.path)
  if (!existing) {
    target.set(entry.path, entry)
    return
  }
  const combinedPatch = existing.patch && entry.patch
    ? `${existing.patch}\n${entry.patch}`
    : entry.patch || existing.patch
  target.set(entry.path, {
    ...existing,
    status: entry.status === 'deleted' ? 'deleted' : existing.status === 'added' ? 'added' : entry.status,
    additions: existing.additions + entry.additions,
    deletions: existing.deletions + entry.deletions,
    patch: combinedPatch,
  })
}

export function extractTurnToolDiffs(messages: readonly ChatMessage[], rootDir: string): ReviewFileDiff[] {
  const byPath = new Map<string, ReviewFileDiff>()
  const blocks = collectBlocksFromMessages(messages)

  const erroredToolIds = new Set<string>()
  for (const block of blocks) {
    if (block.type === 'tool_result' && block.toolUseId && block.isError) {
      erroredToolIds.add(block.toolUseId)
    }
  }

  for (const block of blocks) {
    if (block.type === 'tool_use') {
      if (block.toolUseId && erroredToolIds.has(block.toolUseId)) continue
      const rawInput = parseInputObject(block.input)
      if (isPatchToolCall(block.toolName ?? '', rawInput)) {
        for (const pf of patchToolFiles(rawInput)) {
          const relPath = toRepoRelativePath(pf.movePath ?? pf.path, rootDir)
          if (!relPath) continue
          const patchText = pf.diff ?? ''
          const patch = patchText.startsWith('diff --git ')
            ? patchText
            : patchText
              ? `diff --git a/${relPath} b/${relPath}\n--- a/${relPath}\n+++ b/${relPath}\n${patchText}`
              : ''
          const counts = patch ? countPatchLines(patch) : { additions: 0, deletions: 0 }
          const status: ReviewFileStatus = pf.kind === 'add'
            ? 'added'
            : pf.kind === 'delete'
              ? 'deleted'
              : pf.movePath
                ? 'renamed'
                : 'modified'
          upsertFileDiff(byPath, {
            path: relPath,
            status,
            additions: counts.additions,
            deletions: counts.deletions,
            patch,
            source: 'tool-fallback',
          })
        }
        continue
      }

      const normalized = normalizeTranscriptTool(block.toolName ?? '', rawInput)
      if (isFileMutationTool(normalized.toolName)) {
        const rawPath = fileMutationPath(normalized.input) || block.toolFilePath || ''
        const relPath = toRepoRelativePath(rawPath, rootDir)
        if (!relPath) continue
        const built = buildPatchFromToolInput(normalized.toolName, normalized.input, relPath)
        const counts = built?.patch
          ? countPatchLines(built.patch)
          : {
              additions: block.toolLineDelta?.added ?? 0,
              deletions: block.toolLineDelta?.removed ?? 0,
            }
        upsertFileDiff(byPath, {
          path: relPath,
          status: built?.status ?? (normalized.toolName === 'Delete' ? 'deleted' : 'modified'),
          additions: counts.additions,
          deletions: counts.deletions,
          patch: built?.patch ?? '',
          source: 'tool-fallback',
        })
      }

      for (const change of block.taskFileChanges ?? []) {
        const relPath = toRepoRelativePath(change.path, rootDir)
        if (!relPath || byPath.has(relPath)) continue
        upsertFileDiff(byPath, {
          path: relPath,
          status: 'modified',
          additions: change.added,
          deletions: change.removed,
          patch: '',
          source: 'tool-fallback',
        })
      }
    } else if (block.type === 'tool_result' && block.bashEditDiff) {
      for (const row of bashEditToolUses(block.toolUseId ?? '', block.bashEditDiff)) {
        const relPath = toRepoRelativePath(row.filePath, rootDir)
        if (!relPath) continue
        const parsed = parseInputObject(row.input)
        const built = buildPatchFromToolInput(row.toolName, parsed, relPath)
        upsertFileDiff(byPath, {
          path: relPath,
          status: built?.status ?? (row.toolName === 'Write' ? 'added' : row.toolName === 'Delete' ? 'deleted' : 'modified'),
          additions: row.added,
          deletions: row.removed,
          patch: built?.patch ?? '',
          source: 'tool-fallback',
        })
      }
    }
  }

  for (const msg of messages) {
    const codexItems = msg.metadata?.codex?.items ?? []
    for (const item of codexItems) {
      if (item.type !== 'file_change') continue
      for (const change of item.changes ?? []) {
        const relPath = toRepoRelativePath(change.path, rootDir)
        if (!relPath) continue
        const rawDiff = change.diff ?? ''
        const patch = rawDiff
          ? rawDiff.startsWith('diff --git ')
            ? rawDiff
            : `diff --git a/${relPath} b/${relPath}\n--- a/${relPath}\n+++ b/${relPath}\n${rawDiff}`
          : ''
        const counts = patch
          ? countPatchLines(patch)
          : {
              additions: change.toolLineDelta?.added ?? 0,
              deletions: change.toolLineDelta?.removed ?? 0,
            }
        const rawKind: unknown = change.kind
        const kind = typeof rawKind === 'string'
          ? rawKind
          : rawKind && typeof rawKind === 'object' && 'type' in rawKind
            ? String((rawKind as { type?: unknown }).type ?? '')
            : ''
        const status: ReviewFileStatus = kind === 'add' ? 'added' : kind === 'delete' ? 'deleted' : 'modified'
        upsertFileDiff(byPath, {
          path: relPath,
          status,
          additions: counts.additions,
          deletions: counts.deletions,
          patch,
          source: 'tool-fallback',
        })
      }
    }
  }

  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path))
}

export function mergeFileDiffLists(lists: ReadonlyArray<readonly ReviewFileDiff[]>): ReviewFileDiff[] {
  const byPath = new Map<string, ReviewFileDiff>()
  for (const list of lists) {
    for (const file of list) {
      upsertFileDiff(byPath, file)
    }
  }
  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path))
}

function extractPromptPreview(message: ChatMessage): string {
  for (const block of message.content ?? []) {
    if (block.type === 'text' && block.text.trim()) {
      const oneLine = block.text.trim().replace(/\s+/g, ' ')
      return oneLine.length > 80 ? `${oneLine.slice(0, 79)}…` : oneLine
    }
  }
  return ''
}

export function buildTurnsFromTranscript(messages: readonly ChatMessage[], cwd: string): ReviewTurnDiff[] {
  const turns: ReviewTurnDiff[] = []
  let currentUser: ChatMessage | null = null
  let currentAssistants: ChatMessage[] = []

  const flush = () => {
    if (!currentUser) return
    const files = extractTurnToolDiffs(currentAssistants, cwd)
    const totals = sumFileDiffTotals(files)
    const lastAssistant = currentAssistants[currentAssistants.length - 1] ?? null
    const parsedTime = Date.parse(lastAssistant?.createdAt ?? currentUser.createdAt ?? '')
    turns.push({
      turnIndex: turns.length + 1,
      userMessageId: currentUser.id,
      assistantMessageId: lastAssistant?.id ?? null,
      promptPreview: extractPromptPreview(currentUser),
      cwd,
      source: 'tool-fallback',
      concurrent: false,
      createdAt: Number.isFinite(parsedTime) ? parsedTime : Date.now(),
      files,
      totalAdditions: totals.additions,
      totalDeletions: totals.deletions,
    })
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      flush()
      currentUser = msg
      currentAssistants = []
    } else if (msg.role === 'assistant' && currentUser) {
      currentAssistants.push(msg)
    }
  }
  flush()

  return turns
}
