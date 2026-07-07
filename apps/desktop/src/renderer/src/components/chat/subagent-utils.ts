import type { ContentBlock } from '@superone/shared/agent-types'
import { parseToolInput } from './tool-display'

export type JsonlEntry =
  | { type: 'tool'; toolName: string; description: string }
  | { type: 'activity'; text: string }
  | { type: 'structured'; data: unknown }

export const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput'

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

export interface JsonlRecord {
  type?: string
  message?: { content?: Array<{ type: string; name?: string; input?: Record<string, unknown>; text?: string }> }
}

/**
 * Maps subagent transcript records into interleaved activity entries. Shared by
 * the live tail parser (parseJsonlOutput) and the authoritative SDK-backed read
 * (getSubagentMessages), so both surfaces render identical activity.
 */
export function entriesFromRecords(records: JsonlRecord[]): { entries: JsonlEntry[]; resultText?: string } {
  const entries: JsonlEntry[] = []
  let lastTextIndex = -1
  for (const record of records) {
    if (record.type !== 'assistant' || !record.message?.content) continue
    for (const block of record.message.content) {
      if (block.type === 'tool_use' && block.name === STRUCTURED_OUTPUT_TOOL) {
        entries.push({ type: 'structured', data: block.input ?? {} })
      } else if (block.type === 'tool_use' && block.name) {
        entries.push({ type: 'tool', toolName: block.name, description: summarizeToolInput(block.name, block.input ?? {}) })
      } else if (block.type === 'text' && block.text) {
        lastTextIndex = entries.length
        entries.push({ type: 'activity', text: block.text })
      }
    }
  }
  const resultText = lastTextIndex >= 0 ? (entries[lastTextIndex] as { type: 'activity'; text: string }).text : undefined
  return { entries, resultText }
}

export function parseJsonlOutput(raw: string): { entries: JsonlEntry[]; resultText?: string } {
  const lines = raw.split('\n')
  const records: JsonlRecord[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    try { records.push(JSON.parse(line)) } catch {
      if (i === 0) return { entries: [] }
      continue
    }
  }
  return entriesFromRecords(records)
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

function blockParentToolUseId(block: ContentBlock): string | null {
  return 'parentToolUseId' in block ? block.parentToolUseId ?? null : null
}

export interface NestedSubagentSegment {
  taskBlock: ContentBlock & { type: 'tool_use' }
  childBlocks: ContentBlock[]
  resultBlock?: ContentBlock & { type: 'tool_result' }
}

export type SubagentChildItem =
  | { kind: 'block'; block: ContentBlock }
  | { kind: 'subagent'; segment: NestedSubagentSegment }

/**
 * Split a subagent's flat subtree into ordered render items, lifting any directly
 * nested `Agent` call (and its own subtree) into its own segment. The owner's
 * `childBlocks` carry the WHOLE subtree (all nesting depths) so this is the single
 * place that re-derives the tree; recurse by feeding each returned segment's
 * `childBlocks` back through this function. Without this, deeper-than-one-level
 * sub-agent output (parentToolUseId pointing at a nested Agent) matches no known
 * collector and leaks out as top-level blocks.
 */
export function groupSubagentChildren(blocks: ContentBlock[], ownerToolUseId: string): SubagentChildItem[] {
  const agentParent = new Map<string, string | null>()
  for (const b of blocks) {
    if (b.type === 'tool_use' && b.toolName === 'Agent') agentParent.set(b.toolUseId, blockParentToolUseId(b))
  }
  // The direct-child-of-owner agent whose subtree contains `parentId`, or null.
  const directChildAgent = (parentId: string | null): string | null => {
    let cur = parentId
    const seen = new Set<string>()
    while (cur && cur !== ownerToolUseId && agentParent.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      const p = agentParent.get(cur) ?? null
      if (p === ownerToolUseId || p == null || !agentParent.has(p)) return cur
      cur = p
    }
    return null
  }

  const items: SubagentChildItem[] = []
  const segments = new Map<string, NestedSubagentSegment>()
  for (const block of blocks) {
    if (block.type === 'tool_result' && segments.has(block.toolUseId)) {
      segments.get(block.toolUseId)!.resultBlock = block
      continue
    }
    const parentId = blockParentToolUseId(block)
    if (parentId === ownerToolUseId) {
      if (block.type === 'tool_use' && block.toolName === 'Agent') {
        const segment: NestedSubagentSegment = { taskBlock: block, childBlocks: [] }
        items.push({ kind: 'subagent', segment })
        segments.set(block.toolUseId, segment)
        continue
      }
      items.push({ kind: 'block', block })
      continue
    }
    const owner = directChildAgent(parentId)
    if (owner && segments.has(owner)) {
      segments.get(owner)!.childBlocks.push(block)
      continue
    }
    items.push({ kind: 'block', block })
  }
  return items
}

/**
 * Every block (any nesting depth) emitted within `rootToolUseId`'s sub-agent
 * subtree, excluding the root's own task block and result. All sub-agent output
 * lands in one assistant message, so a single message's `content` is the scope.
 */
export function collectSubagentSubtree(content: ContentBlock[], rootToolUseId: string): ContentBlock[] {
  const agentParent = new Map<string, string | null>()
  for (const b of content) {
    if (b.type === 'tool_use' && b.toolName === 'Agent') agentParent.set(b.toolUseId, blockParentToolUseId(b))
  }
  const inSubtree = (parentId: string | null): boolean => {
    let cur = parentId
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      if (cur === rootToolUseId) return true
      seen.add(cur)
      cur = agentParent.get(cur) ?? null
    }
    return false
  }
  return content.filter((b) => {
    if ((b.type === 'tool_use' || b.type === 'tool_result') && b.toolUseId === rootToolUseId) return false
    return inSubtree(blockParentToolUseId(b))
  })
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
