import type { CodexThreadItem } from '@superone/shared/agent-types'
import { normalizeTranscriptTool } from '@superone/shared/tool-ui'
import { computeLineDelta } from './tool-block-utils'
import { parseToolInput } from './tool-display'

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

const FILE_MUTATION_TOOLS = new Set(['Edit', 'Write', 'FileChange', 'NotebookEdit'])

type ClaudeProcessToolBlock = {
  type: string
  toolName?: string
  toolUseId?: string
  input?: string
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
}

export type CodexProcessStatsSeg = {
  kind: string
  index?: number
  indices?: number[]
}

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
  if (seg.kind === 'subagent') {
    if (seg.taskBlock) yield seg.taskBlock
    for (const block of seg.childBlocks ?? []) {
      if (block.type === 'tool_use') yield block
    }
    return
  }
  if (seg.kind === 'workflow' && seg.toolBlock) {
    yield seg.toolBlock
  }
}

function mutationFilePath(params: Record<string, unknown>): string {
  const raw = params.file_path ?? params.notebook_path ?? params.target_file ?? params.path
  return typeof raw === 'string' ? raw : ''
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

function isDeniedResult(result?: string): boolean {
  return !!result && result.startsWith('[denied] ')
}

function accumulateMutation(
  stats: TurnProcessStats,
  files: Set<string>,
  toolName: string,
  rawInput: Record<string, unknown>,
): void {
  const normalized = normalizeTranscriptTool(toolName, rawInput)
  if (!FILE_MUTATION_TOOLS.has(normalized.toolName)) return
  const path = mutationFilePath(normalized.input)
  if (path) files.add(path)
  const delta = lineDeltaForMutation(normalized.toolName, normalized.input)
  if (!delta) return
  stats.added += delta.added
  stats.removed += delta.removed
}

function finishStats(stats: TurnProcessStats, files: Set<string>): TurnProcessStats {
  stats.filesChanged = files.size
  return stats
}

/** Summarize visible tool calls / file mutations in a Claude-shaped compact process. */
export function summarizeClaudeProcess(
  segs: ReadonlyArray<ClaudeProcessStatsSeg>,
  opts: ClaudeProcessStatsOpts,
): TurnProcessStats {
  const stats: TurnProcessStats = { ...EMPTY_TURN_PROCESS_STATS }
  const files = new Set<string>()
  for (const seg of segs) {
    for (const block of eachClaudeToolUse(seg)) {
      const toolName = block.toolName ?? ''
      const toolUseId = block.toolUseId ?? ''
      const result = opts.toolResultAt(toolUseId)
      if (opts.isHiddenTool(toolName, result)) continue
      stats.toolCalls += 1
      if (opts.isErrorTool?.(toolUseId) || isDeniedResult(result)) continue
      accumulateMutation(stats, files, toolName, parseToolInput(block.input ?? '', toolName))
    }
  }
  return finishStats(stats, files)
}

function itemsInCodexProcess(
  segs: ReadonlyArray<CodexProcessStatsSeg>,
  items: ReadonlyArray<CodexThreadItem>,
): CodexThreadItem[] {
  const out: CodexThreadItem[] = []
  for (const seg of segs) {
    const indices = seg.indices ?? (seg.index != null ? [seg.index] : [])
    for (const index of indices) {
      const item = items[index]
      if (item) out.push(item)
    }
  }
  return out
}

/** Summarize visible tool calls / file mutations in a Codex compact process. */
export function summarizeCodexProcess(
  segs: ReadonlyArray<CodexProcessStatsSeg>,
  items: ReadonlyArray<CodexThreadItem>,
): TurnProcessStats {
  const stats: TurnProcessStats = { ...EMPTY_TURN_PROCESS_STATS }
  const files = new Set<string>()
  for (const item of itemsInCodexProcess(segs, items)) {
    switch (item.type) {
      case 'command_execution':
      case 'mcp_tool_call':
      case 'web_search':
      case 'collab_tool_call':
        stats.toolCalls += 1
        break
      case 'file_change': {
        stats.toolCalls += 1
        if (item.status === 'failed') break
        for (const change of item.changes) {
          if (change.path) files.add(change.path)
          accumulateMutation(stats, files, 'FileChange', {
            file_path: change.path,
            kind: change.kind,
            diff: change.diff ?? '',
          })
        }
        break
      }
      default:
        break
    }
  }
  return finishStats(stats, files)
}
