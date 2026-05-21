import type { ContentBlock } from '@superone/shared/agent-types'
import { parseToolInput } from './tool-display'

export type JsonlEntry =
  | { type: 'tool'; toolName: string; description: string }
  | { type: 'activity'; text: string }

function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  if (input.file_path) return String(input.file_path)
  if (input.command) return String(input.command).slice(0, 120)
  if (input.pattern) return String(input.pattern)
  if (input.query) return String(input.query).slice(0, 120)
  if (input.url) return String(input.url)
  if (input.prompt) return String(input.prompt).slice(0, 120)
  if (input.description) return String(input.description).slice(0, 120)
  return ''
}

export function parseJsonlOutput(raw: string): { entries: JsonlEntry[]; resultText?: string } {
  const lines = raw.split('\n')
  const entries: JsonlEntry[] = []
  let lastTextIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    let record: { type?: string; message?: { content?: Array<{ type: string; name?: string; input?: Record<string, unknown>; text?: string }> } }
    try { record = JSON.parse(line) } catch {
      if (i === 0) return { entries: [] }
      continue
    }
    if (record.type !== 'assistant' || !record.message?.content) continue
    for (const block of record.message.content) {
      if (block.type === 'tool_use' && block.name) {
        entries.push({ type: 'tool', toolName: block.name, description: summarizeToolInput(block.name, block.input ?? {}) })
      } else if (block.type === 'text' && block.text) {
        lastTextIndex = entries.length
        entries.push({ type: 'activity', text: block.text })
      }
    }
  }
  let resultText: string | undefined
  if (lastTextIndex >= 0) {
    resultText = (entries[lastTextIndex] as { type: 'activity'; text: string }).text
  }
  return { entries, resultText }
}

export interface ParsedTaskInput {
  name: string
  teamName: string
  description: string
  subagentType: string
  prompt: string
  model?: string
  runInBackground: boolean
}

/** Parse Task tool input to extract display info. */
export function parseTaskInput(input: string): ParsedTaskInput {
  const params = parseToolInput(input, 'Task')
  return {
    name: String(params.name ?? ''),
    teamName: String(params.team_name ?? ''),
    description: String(params.description ?? ''),
    subagentType: String(params.subagent_type ?? ''),
    prompt: String(params.prompt ?? ''),
    model: params.model ? String(params.model) : undefined,
    runInBackground: params.run_in_background === true,
  }
}

/** Build a toolUseId → summary map for correlating tool_result with tool_use. */
export function buildToolResultMap(blocks: ContentBlock[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const block of blocks) {
    if (block.type === 'tool_result' && block.summary) map.set(block.toolUseId, block.summary)
  }
  return map
}

export interface ToolErrorMaps {
  errorIds: Set<string>
  timedOutIds: Set<string>
}

/** Collect toolUseIds whose tool_result reported an error or timeout. */
export function buildToolErrorMaps(blocks: ContentBlock[]): ToolErrorMaps {
  const errorIds = new Set<string>()
  const timedOutIds = new Set<string>()
  for (const block of blocks) {
    if (block.type !== 'tool_result') continue
    if (block.isError) errorIds.add(block.toolUseId)
    if (block.isTimedOut) timedOutIds.add(block.toolUseId)
  }
  return { errorIds, timedOutIds }
}

/**
 * Whole-second run duration for a subagent. Prefers backend-recorded values
 * (`elapsedSeconds`, `taskUsage.durationMs`, live `progress.durationMs`) so the
 * number stays correct after a session is reloaded from history. The live
 * wall-clock (`now - startedAt`) is only meaningful while the agent is still
 * running — a persisted `startedAt` is stale once the session is reopened.
 */
export function computeSubagentElapsed(
  taskBlock: ContentBlock & { type: 'tool_use' },
  progress: { durationMs?: number } | undefined,
  isRunning: boolean,
  now: number = Date.now(),
): number {
  const recorded =
    (taskBlock.elapsedSeconds ? Math.round(taskBlock.elapsedSeconds) : 0)
    || (taskBlock.taskUsage?.durationMs ? Math.round(taskBlock.taskUsage.durationMs / 1000) : 0)
    || (progress?.durationMs ? Math.round(progress.durationMs / 1000) : 0)
  if (recorded > 0) return recorded
  if (isRunning && taskBlock.startedAt) return Math.floor((now - taskBlock.startedAt) / 1000)
  return 0
}
