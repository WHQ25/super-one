import type { ContentBlock } from '@superone/shared/agent-types'
import {
  applyDescriptionPersonaLabel,
  formatTranscriptToolResult as formatSharedTranscriptToolResult,
  isSubagentToolName,
  normalizeTranscriptTool,
} from '@superone/shared/tool-ui'
import { parseToolInput } from './tool-display'

export { normalizeTranscriptTool } from '@superone/shared/tool-ui'
export { formatTranscriptToolResult } from '@superone/shared/tool-ui'
export { isSubagentToolName } from '@superone/shared/tool-ui'

/** Tool activity from subagent/workflow JSONL — carries enough data for full ToolBlock UI. */
export type JsonlToolEntry = {
  type: 'tool'
  toolName: string
  description: string
  /** Stable id for correlating tool_result (Grok tool_call_id / Claude tool_use id). */
  toolUseId?: string
  /** JSON string of normalized Claude-shaped input for ToolBlock. */
  input?: string
  result?: string
  isError?: boolean
}

export type JsonlEntry =
  | JsonlToolEntry
  | { type: 'activity'; text: string }
  | { type: 'structured'; data: unknown }

export const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput'

function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  if (input.file_path) return String(input.file_path)
  if (input.target_file) return String(input.target_file)
  if (input.target_directory) return String(input.target_directory)
  if (input.command) return String(input.command).slice(0, 120)
  if (input.pattern) {
    const path = input.path != null ? ` in ${String(input.path)}` : ''
    return `${String(input.pattern).slice(0, 80)}${path}`
  }
  if (input.query) return String(input.query).slice(0, 120)
  if (input.url) return String(input.url)
  if (input.path) return String(input.path)
  if (input.prompt) return String(input.prompt).slice(0, 120)
  if (input.description) return String(input.description).slice(0, 120)
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__')
    return parts[parts.length - 1] ?? toolName
  }
  return ''
}

function toolInputJson(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input)
  } catch {
    return '{}'
  }
}

function makeToolEntry(
  rawName: string,
  rawInput: Record<string, unknown>,
  toolUseId?: string,
): JsonlToolEntry | { type: 'structured'; data: unknown } {
  if (rawName === STRUCTURED_OUTPUT_TOOL) {
    return { type: 'structured', data: rawInput }
  }
  const { toolName, input } = normalizeTranscriptTool(rawName, rawInput)
  return {
    type: 'tool',
    toolName,
    description: summarizeToolInput(toolName, input),
    ...(toolUseId ? { toolUseId } : {}),
    input: toolInputJson(input),
  }
}

function attachToolResult(
  entries: JsonlEntry[],
  byId: Map<string, number>,
  toolUseId: string | undefined,
  content: unknown,
  isError?: boolean,
): void {
  if (!toolUseId) return
  const idx = byId.get(toolUseId)
  if (idx == null) return
  const entry = entries[idx]
  if (entry?.type !== 'tool') return
  // format + cap — shared with live ACP output unwrapping (ListDir/MCP/Grep envelopes).
  const result = formatSharedTranscriptToolResult(content)
  entries[idx] = {
    ...entry,
    ...(result ? { result } : {}),
    ...(isError ? { isError: true } : {}),
  }
}

export interface JsonlRecord {
  type?: string
  message?: {
    content?: Array<{
      type: string
      id?: string
      name?: string
      input?: Record<string, unknown>
      text?: string
      tool_use_id?: string
      content?: unknown
      is_error?: boolean
    }>
  }
}

/** Grok Build child-session chat_history.jsonl line (not Claude agent-*.jsonl). */
export interface GrokChatHistoryRecord {
  type?: string
  content?: string | Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }>
  tool_calls?: Array<{ id?: string; name?: string; arguments?: string | Record<string, unknown> }>
  tool_call_id?: string
  is_error?: boolean
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function isGrokChatHistoryRecord(rec: Record<string, unknown>): boolean {
  if (rec.type === 'tool_result' && typeof rec.tool_call_id === 'string') return true
  if (rec.type === 'assistant' && Array.isArray(rec.tool_calls)) return true
  // Grok assistant lines use top-level string content + optional tool_calls; Claude uses message.content[].
  if (rec.type === 'assistant' && typeof rec.content === 'string' && rec.message == null) return true
  return false
}

/**
 * Maps Grok child-session chat_history.jsonl into the same JsonlEntry stream the
 * Workflow/Subagent full views already render (tool rows + text activity).
 * Tool entries carry normalized names + full input/result for ToolBlock parity
 * with the main Grok session UI.
 */
export function entriesFromGrokChatHistory(records: GrokChatHistoryRecord[]): { entries: JsonlEntry[]; resultText?: string; toolCount: number } {
  const entries: JsonlEntry[] = []
  const toolIndexById = new Map<string, number>()
  let lastTextIndex = -1
  let toolCount = 0
  for (const record of records) {
    if (record.type === 'assistant') {
      if (typeof record.content === 'string' && record.content.trim()) {
        lastTextIndex = entries.length
        entries.push({ type: 'activity', text: record.content })
      } else if (Array.isArray(record.content)) {
        for (const block of record.content) {
          if (block?.type === 'text' && block.text) {
            lastTextIndex = entries.length
            entries.push({ type: 'activity', text: block.text })
          }
        }
      }
      for (const tc of record.tool_calls ?? []) {
        const name = typeof tc.name === 'string' && tc.name ? tc.name : 'tool'
        const input = parseToolArguments(tc.arguments)
        const id = typeof tc.id === 'string' && tc.id ? tc.id : undefined
        toolCount += 1
        const entry = makeToolEntry(name, input, id)
        if (entry.type === 'tool' && id) toolIndexById.set(id, entries.length)
        entries.push(entry)
      }
      continue
    }
    if (record.type === 'tool_result' && typeof record.tool_call_id === 'string') {
      attachToolResult(entries, toolIndexById, record.tool_call_id, record.content, record.is_error === true)
    }
  }
  const resultText = lastTextIndex >= 0 ? (entries[lastTextIndex] as { type: 'activity'; text: string }).text : undefined
  return { entries, resultText, toolCount }
}

/**
 * Maps subagent transcript records into interleaved activity entries. Shared by
 * the live tail parser (parseJsonlOutput) and the authoritative SDK-backed read
 * (getSubagentMessages), so both surfaces render identical activity.
 */
export function entriesFromRecords(records: JsonlRecord[]): { entries: JsonlEntry[]; resultText?: string } {
  const entries: JsonlEntry[] = []
  const toolIndexById = new Map<string, number>()
  let lastTextIndex = -1
  for (const record of records) {
    if (record.type === 'user' && Array.isArray(record.message?.content)) {
      for (const block of record.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          attachToolResult(entries, toolIndexById, block.tool_use_id, block.content ?? block.text, block.is_error === true)
        }
      }
      continue
    }
    if (record.type !== 'assistant' || !record.message?.content) continue
    for (const block of record.message.content) {
      if (block.type === 'tool_use' && block.name === STRUCTURED_OUTPUT_TOOL) {
        entries.push({ type: 'structured', data: block.input ?? {} })
      } else if (block.type === 'tool_use' && block.name) {
        const id = typeof block.id === 'string' && block.id ? block.id : undefined
        const entry = makeToolEntry(block.name, block.input ?? {}, id)
        if (entry.type === 'tool' && id) toolIndexById.set(id, entries.length)
        entries.push(entry)
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
  const records: Array<Record<string, unknown>> = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    try { records.push(JSON.parse(line) as Record<string, unknown>) } catch {
      if (i === 0) return { entries: [] }
      continue
    }
  }
  // Grok Build child sessions use chat_history.jsonl (assistant.tool_calls + tool_result).
  if (records.some(isGrokChatHistoryRecord)) {
    const { entries, resultText } = entriesFromGrokChatHistory(records as GrokChatHistoryRecord[])
    return { entries, resultText }
  }
  return entriesFromRecords(records as JsonlRecord[])
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

/**
 * Extract Grok/Claude subagent id from a spawn tool_result ack (plain text or JSON-ish).
 * Used to resolve provisional taskProgress keys keyed by subagent_id.
 */
export function parseSubagentIdFromText(text: string | undefined | null): string | undefined {
  if (!text) return undefined
  const fromLabel = text.match(/subagent_id:\s*(\S+)/i)?.[1]
  if (fromLabel) return fromLabel.replace(/[,;]+$/, '')
  const fromTaskIds = text.match(/task_ids?\s*=\s*\[\s*"([^"]+)"/i)?.[1]
  if (fromTaskIds) return fromTaskIds
  // JSON spawn result
  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
      const id = o.subagent_id ?? o.subagentId ?? o.task_id ?? o.taskId
      if (typeof id === 'string' && id) return id
    }
  } catch { /* ignore */ }
  return undefined
}

/**
 * Grok background spawn ack. Prefer the explicit phrase; bare `subagent_id:` alone
 * is too easy to false-positive (docs, TaskOutput echo).
 */
export function looksLikeBackgroundSubagentAck(text: string | undefined | null): boolean {
  if (!text) return false
  if (/started in background/i.test(text)) return true
  return /subagent_id:\s*\S+/i.test(text) && /\bbackground\b/i.test(text)
}

/**
 * Resolve live taskProgress for a subagent launch chip.
 * Prefer the established toolUseId key; fall back to provisional taskId key
 * (Grok progress often lands under subagent_id before tool_result correlates).
 */
export function resolveTaskProgressEntry<T extends { taskId?: string }>(
  taskProgress: Record<string, T>,
  toolUseId: string,
  taskIdHint?: string | null,
): T | undefined {
  const byTool = taskProgress[toolUseId]
  if (byTool) return byTool
  const id = taskIdHint?.trim()
  if (!id) return undefined
  if (taskProgress[id]) return taskProgress[id]
  for (const entry of Object.values(taskProgress)) {
    if (entry.taskId === id) return entry
  }
  return undefined
}

/** Parse Task/Agent tool input to extract display info. */
export function parseTaskInput(input: string): ParsedTaskInput {
  const params = parseToolInput(input, 'Task')
  const labeled = applyDescriptionPersonaLabel(
    String(params.description ?? ''),
    String(params.subagent_type ?? ''),
  )
  return {
    name: String(params.name ?? ''),
    teamName: String(params.team_name ?? ''),
    description: labeled.description,
    subagentType: labeled.subagentType,
    prompt: String(params.prompt ?? ''),
    model: params.model ? String(params.model) : undefined,
    runInBackground: params.run_in_background === true || params.background === true,
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
    if (b.type === 'tool_use' && isSubagentToolName(b.toolName)) agentParent.set(b.toolUseId, blockParentToolUseId(b))
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
      if (block.type === 'tool_use' && isSubagentToolName(block.toolName)) {
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
    if (b.type === 'tool_use' && isSubagentToolName(b.toolName)) agentParent.set(b.toolUseId, blockParentToolUseId(b))
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
