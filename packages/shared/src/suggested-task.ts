/**
 * Suggested tasks (`session_suggest_task`): a side issue the agent noticed,
 * shown as a card the user may later launch as its own session or dismiss.
 * Only the user decides a card; the agent cannot withdraw one.
 *
 * The tool result only names the card (`taskId`) and is never rewritten. What
 * happened to the card afterwards is a host fact patched onto the call's own
 * row — a `tool_use` block, or a Codex `mcp_tool_call` item — so it persists
 * with the transcript and reaches every surface that renders the row.
 */
import { parseMcpToolName } from './tool-ui'

export const SUGGEST_TASK_TOOL_NAME = 'session_suggest_task' as const

/** Outcome of a card. Absent while the card is pending. */
export type SuggestedTaskState =
  | { status: 'launched'; sessionId: string }
  | { status: 'dismissed' }

/** What the agent proposed, read back from the call's own input. */
export interface SuggestedTaskInput {
  title: string
  tldr: string
  prompt: string
  cwd?: string
}

/** Reply of the desktop launch / dismiss calls. */
export type SuggestedTaskActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }

export interface SuggestedTaskRecord {
  input: SuggestedTaskInput
  state?: SuggestedTaskState
}

type Row = Record<string, unknown>

/**
 * The card's id, read from its result. A pattern rather than a parse: a phone
 * receives results cut short, and a result may still be wrapped in an escaped
 * MCP envelope. The id leads the payload.
 */
export function suggestedTaskIdFromResult(result: string | null | undefined): string | null {
  return result?.match(/\\?"taskId\\?"\s*:\s*\\?"([0-9a-f-]{36})/i)?.[1] ?? null
}

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function isSuggestTool(toolName: unknown): boolean {
  if (typeof toolName !== 'string') return false
  const mcp = parseMcpToolName(toolName)
  return mcp?.serverName === 'superone' && mcp.mcpToolName === SUGGEST_TASK_TOOL_NAME
}

function codexItemResultText(item: Row): string {
  const content = record(item.result).content
  if (!Array.isArray(content)) return ''
  return content.map((part) => record(part).text).filter((text) => typeof text === 'string').join('\n')
}

function parseInput(raw: unknown): SuggestedTaskInput | null {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) } catch { return null }
  }
  const input = record(value)
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  if (!title || !prompt) return null
  const cwd = typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd.trim() : undefined
  return { title, tldr: typeof input.tldr === 'string' ? input.tldr.trim() : '', prompt, ...(cwd ? { cwd } : {}) }
}

/**
 * The card's row is matched by the `taskId` in its own result. A result reaches
 * this host in several envelopes (Claude's serialized MCP reply, Codex content
 * parts, ACP text), and the id is an opaque UUID, so containment is exact enough
 * and envelope-agnostic.
 */
interface Located {
  messageIndex: number
  /** `tool_use` block id, or the Codex item id. */
  rowId: string
  kind: 'block' | 'codex'
  row: Row
}

function contentOf(message: unknown): Row[] {
  const content = record(message).content
  return Array.isArray(content) ? content.map(record) : []
}

/** The `tool_use` with this id; its result may sit in a later message than the call. */
function locateToolUse(messages: readonly unknown[], toolUseId: unknown): Located | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const use = contentOf(messages[messageIndex]).find((row) => row.type === 'tool_use' && row.toolUseId === toolUseId)
    if (use) return isSuggestTool(use.toolName) ? { messageIndex, rowId: String(use.toolUseId), kind: 'block', row: use } : null
  }
  return null
}

function locate(messages: readonly unknown[], taskId: string): Located | null {
  if (!taskId) return null
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = record(messages[messageIndex])
    for (const block of contentOf(message)) {
      if (block.type !== 'tool_result' || typeof block.summary !== 'string' || !block.summary.includes(taskId)) continue
      const use = locateToolUse(messages, block.toolUseId)
      if (use) return use
    }
    const items = record(record(message.metadata).codex).items
    if (!Array.isArray(items)) continue
    for (const item of items.map(record)) {
      if (item.type !== 'mcp_tool_call' || !isSuggestTool(`mcp__${String(item.server)}__${String(item.tool)}`)) continue
      if (codexItemResultText(item).includes(taskId)) {
        return { messageIndex, rowId: String(item.id), kind: 'codex', row: item }
      }
    }
  }
  return null
}

export function findSuggestedTask(messages: readonly unknown[], taskId: string): SuggestedTaskRecord | null {
  const found = locate(messages, taskId)
  if (!found) return null
  const input = parseInput(found.kind === 'block' ? found.row.input : found.row.arguments)
  if (!input) return null
  const state = found.row.suggestedTask as SuggestedTaskState | undefined
  return { input, ...(state ? { state } : {}) }
}
/**
 * Record the card's outcome on its row. A card leaves `pending` once: an
 * update to a card that already has an outcome, or that is not found, returns
 * the same array.
 */
export function applySuggestedTaskUpdate<T>(messages: readonly T[], taskId: string, state: SuggestedTaskState): T[] {
  const found = locate(messages, taskId)
  if (!found || found.row.suggestedTask) return messages as T[]
  const patch = (row: unknown): unknown => {
    const value = record(row)
    const id = found.kind === 'block' ? value.toolUseId : value.id
    const matches = found.kind === 'block' ? value.type === 'tool_use' : value.type === 'mcp_tool_call'
    return matches && id === found.rowId ? { ...value, suggestedTask: state } : row
  }
  return messages.map((message, index) => {
    if (index !== found.messageIndex) return message
    const value = record(message)
    if (found.kind === 'block') {
      return { ...value, content: (value.content as unknown[]).map(patch) } as T
    }
    const metadata = record(value.metadata)
    const codex = record(metadata.codex)
    return { ...value, metadata: { ...metadata, codex: { ...codex, items: (codex.items as unknown[]).map(patch) } } } as T
  })
}
