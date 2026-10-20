import type { BashEditDiff, ProcessFoldSummary, TaskFileChange } from '@superone/shared/agent-types'
import { bashEditFileChanges } from '@superone/shared/bash-edit-diff'
import { fileMutationPath, isFileMutationTool } from '@superone/shared/file-mutation'
import { normalizeTranscriptTool } from '@superone/shared/tool-ui'
import { isPatchToolCall, patchToolFiles, summarizePatchToolFiles } from '@superone/shared/patch-tool'
import { computeLineDelta } from './line-delta'

export interface TurnProcessStats {
  toolCalls: number
  filesChanged: number
  added: number
  removed: number
}

export const EMPTY_TURN_PROCESS_STATS: TurnProcessStats = {
  toolCalls: 0,
  filesChanged: 0,
  added: 0,
  removed: 0,
}

type ClaudeProcessToolBlock = {
  type: string
  /** A transcript window's folded process (`notice` of kind `fold`). */
  fold?: ProcessFoldSummary
  toolName?: string
  toolUseId?: string
  input?: string
  toolFilePath?: string
  toolLineDelta?: { added: number; removed: number }
  taskFileChanges?: TaskFileChange[]
}

export type ClaudeProcessStatsSeg = {
  kind: string
  blocks?: ReadonlyArray<ClaudeProcessToolBlock>
  block?: ClaudeProcessToolBlock
  taskBlock?: ClaudeProcessToolBlock
  childBlocks?: ReadonlyArray<ClaudeProcessToolBlock>
  toolBlock?: ClaudeProcessToolBlock
}

export interface ClaudeProcessStatsOpts {
  toolResultAt: (toolUseId: string) => string | undefined
  isHiddenTool: (toolName: string, result?: string) => boolean
  isErrorTool?: (toolUseId: string) => boolean
  /** A Bash call's working-tree diff; its files count like Edit / Write rows. */
  bashEditDiffAt?: (toolUseId: string) => BashEditDiff | undefined
}

function parseToolInput(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

/**
 * One entry per call the turn's own agent made. A subagent is one call here —
 * its children count inside its card, not in the turn header; only their file
 * edits fold back into the turn (see `eachSubagentEdit`).
 */
function* eachClaudeToolUse(seg: ClaudeProcessStatsSeg): Generator<ClaudeProcessToolBlock> {
  if (seg.kind === 'block' && seg.block?.type === 'tool_use') {
    yield seg.block
    return
  }
  if (seg.kind === 'tools' || seg.kind === 'app-tools') {
    for (const block of seg.blocks ?? []) {
      if (block.type === 'tool_use') yield block
    }
    return
  }
  if (seg.kind === 'subagent' && seg.taskBlock) yield seg.taskBlock
  if (seg.kind === 'workflow' && seg.toolBlock) yield seg.toolBlock
}

/**
 * A subagent's edits are the turn's edits. Read them off the children when the
 * transcript carries them (desktop, legacy remote); a progressive remote shell
 * has no children and reads the container's `taskFileChanges` instead.
 */
function* eachSubagentEdit(
  seg: ClaudeProcessStatsSeg,
): Generator<{ block: ClaudeProcessToolBlock } | { change: TaskFileChange }> {
  if (seg.kind !== 'subagent') return
  if (seg.childBlocks?.length) {
    for (const block of seg.childBlocks) {
      if (block.type === 'tool_use') yield { block }
    }
    return
  }
  for (const change of seg.taskBlock?.taskFileChanges ?? []) yield { change }
}

function lineDeltaForMutation(
  toolName: string,
  params: Record<string, unknown>,
): { added: number; removed: number } | null {
  if (toolName === 'NotebookEdit') {
    return computeLineDelta('Edit', {
      old_string: String(params.old_source ?? ''),
      new_string: String(params.new_source ?? ''),
    })
  }
  return computeLineDelta(toolName, params)
}

function accumulateMutation(
  stats: TurnProcessStats,
  files: Set<string>,
  toolName: string,
  rawInput: Record<string, unknown>,
  projected?: { path?: string; delta?: { added: number; removed: number } },
): void {
  if (isPatchToolCall(toolName, rawInput)) {
    const patchFiles = patchToolFiles(rawInput)
    for (const file of patchFiles) files.add(file.movePath ?? file.path)
    const summary = summarizePatchToolFiles(patchFiles)
    stats.added += summary.added
    stats.removed += summary.removed
    return
  }
  const normalized = normalizeTranscriptTool(toolName, rawInput)
  if (!isFileMutationTool(normalized.toolName)) return
  const path = fileMutationPath(normalized.input) || projected?.path || ''
  if (path) files.add(path)
  const delta = lineDeltaForMutation(normalized.toolName, normalized.input) ?? projected?.delta ?? null
  if (!delta) return
  stats.added += delta.added
  stats.removed += delta.removed
}

export function summarizeClaudeProcess(
  segs: ReadonlyArray<ClaudeProcessStatsSeg>,
  opts: ClaudeProcessStatsOpts,
): TurnProcessStats {
  const { stats, files, moreFiles } = summarizeClaudeProcessFiles(segs, opts)
  return { ...stats, filesChanged: files.size + moreFiles }
}

/**
 * The Detail stats with the changed paths behind `filesChanged`, so a folded
 * run's files merge with the loaded ones instead of being counted twice.
 * `moreFiles` counts paths a fold did not list.
 */
export function summarizeClaudeProcessFiles(
  segs: ReadonlyArray<ClaudeProcessStatsSeg>,
  opts: ClaudeProcessStatsOpts,
): { stats: TurnProcessStats; files: Set<string>; moreFiles: number } {
  const stats: TurnProcessStats = { ...EMPTY_TURN_PROCESS_STATS }
  const files = new Set<string>()
  let moreFiles = 0
  const failed = (toolUseId: string, result: string | undefined): boolean =>
    opts.isErrorTool?.(toolUseId) === true || result?.startsWith('[denied] ') === true
  const accumulateChange = (change: TaskFileChange): void => {
    if (change.path) files.add(change.path)
    stats.added += change.added
    stats.removed += change.removed
  }
  const accumulateBlock = (block: ClaudeProcessToolBlock): void => {
    // A Bash call that edited files reports them as a diff, not as tool params.
    const bashEditDiff = block.toolName === 'Bash' ? opts.bashEditDiffAt?.(block.toolUseId ?? '') : undefined
    if (bashEditDiff) {
      for (const change of bashEditFileChanges(bashEditDiff)) accumulateChange(change)
      return
    }
    accumulateMutation(stats, files, block.toolName ?? '', parseToolInput(block.input ?? ''), {
      path: block.toolFilePath,
      delta: block.toolLineDelta,
    })
  }
  for (const seg of segs) {
    const fold = seg.kind === 'block' ? seg.block?.fold : undefined
    if (fold) {
      stats.toolCalls += fold.toolCalls
      stats.added += fold.added
      stats.removed += fold.removed
      for (const path of fold.files) files.add(path)
      moreFiles += fold.moreFiles ?? 0
      continue
    }
    for (const block of eachClaudeToolUse(seg)) {
      const toolName = block.toolName ?? ''
      const toolUseId = block.toolUseId ?? ''
      const result = opts.toolResultAt(toolUseId)
      if (opts.isHiddenTool(toolName, result)) continue
      stats.toolCalls += 1
      if (!failed(toolUseId, result)) accumulateBlock(block)
    }
    for (const edit of eachSubagentEdit(seg)) {
      if ('change' in edit) {
        accumulateChange(edit.change)
        continue
      }
      const toolUseId = edit.block.toolUseId ?? ''
      if (!failed(toolUseId, opts.toolResultAt(toolUseId))) accumulateBlock(edit.block)
    }
  }
  stats.filesChanged = files.size + moreFiles
  return { stats, files, moreFiles }
}
