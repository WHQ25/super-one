/**
 * Pure helpers for rendering SuperOne chat transcripts for session archive MCP tools.
 * Views keep tool calls out of conversational text; tools are indexed separately.
 */

import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

const INTERNAL_TAG_RE =
  /<(?:command-name|task-notification|local-command-caveat|local-command-stdout)[\s\S]*?(?:<\/(?:command-name|task-notification|local-command-caveat|local-command-stdout)>|$)/gi

export type SessionArchiveView = 'meta' | 'user' | 'assistant' | 'text' | 'tools' | 'tool_detail'

export interface ToolIndexEntry {
  toolUseId: string
  toolName: string
  messageId: string
  target?: string
  status?: string
  isError?: boolean
}

export interface ToolDetail {
  toolUseId: string
  toolName: string
  messageId: string
  input: string
  status?: string
  resultSummary?: string
  resultIsError?: boolean
  resultOutputPath?: string
}

function stripInternalTags(text: string): string {
  return text.replace(INTERNAL_TAG_RE, '').trim()
}

/** True when the block is a tool-use (native tool_use or remote typed tool). */
export function isToolUseBlock(block: ContentBlock): block is ContentBlock & {
  toolName: string
  toolUseId: string
  input: string
  status?: string
  toolFilePath?: string
  toolSummary?: string
} {
  return (
    typeof block === 'object'
    && block !== null
    && 'toolName' in block
    && 'toolUseId' in block
    && typeof (block as { toolName?: unknown }).toolName === 'string'
    && typeof (block as { toolUseId?: unknown }).toolUseId === 'string'
  )
}

export function countTools(message: ChatMessage): number {
  return message.content.filter(isToolUseBlock).length
}

export function extractMessageText(message: ChatMessage, opts?: { includeThinking?: boolean }): string {
  const parts: string[] = []
  for (const block of message.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      const t = stripInternalTags(block.text)
      if (t) parts.push(t)
    } else if (opts?.includeThinking && block.type === 'thinking' && typeof block.thinking === 'string') {
      const t = block.thinking.trim()
      if (t) parts.push(t)
    } else if (block.type === 'codex_plan' && typeof block.text === 'string') {
      const t = block.text.trim()
      if (t) parts.push(t)
    }
  }
  return parts.join('\n\n')
}

function toolTarget(block: ContentBlock & { toolName: string; input: string; toolFilePath?: string; toolSummary?: string }): string | undefined {
  if (block.toolFilePath?.trim()) return block.toolFilePath.trim()
  if (block.toolSummary?.trim()) return block.toolSummary.trim()
  const raw = block.input
  if (!raw) return undefined
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    for (const key of ['file_path', 'filePath', 'path', 'command', 'pattern', 'query', 'url', 'glob']) {
      const v = o[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  } catch {
    // non-JSON input
  }
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  return oneLine || undefined
}

export function extractToolIndex(message: ChatMessage): ToolIndexEntry[] {
  const entries: ToolIndexEntry[] = []
  for (const block of message.content) {
    if (!isToolUseBlock(block)) continue
    const target = toolTarget(block)
    entries.push({
      toolUseId: block.toolUseId,
      toolName: block.toolName,
      messageId: message.id,
      ...(target ? { target } : {}),
      ...(block.status ? { status: block.status } : {}),
    })
  }
  // Attach error flags from matching results when present.
  for (const block of message.content) {
    if (block.type !== 'tool_result' && block.type !== 'bash_result' && block.type !== 'todo_result') continue
    const hit = entries.find((e) => e.toolUseId === block.toolUseId)
    if (hit && 'isError' in block && block.isError) hit.isError = true
  }
  return entries
}

export function findToolDetail(messages: ChatMessage[], toolUseId: string): ToolDetail | null {
  for (const message of messages) {
    for (const block of message.content) {
      if (!isToolUseBlock(block) || block.toolUseId !== toolUseId) continue
      let resultSummary: string | undefined
      let resultIsError: boolean | undefined
      let resultOutputPath: string | undefined
      for (const other of message.content) {
        if (
          (other.type === 'tool_result' || other.type === 'bash_result' || other.type === 'todo_result')
          && other.toolUseId === toolUseId
        ) {
          resultSummary = other.summary
          if ('isError' in other) resultIsError = other.isError
          if ('outputPath' in other && typeof other.outputPath === 'string') resultOutputPath = other.outputPath
        }
      }
      // Result may be on a later/sibling message — scan whole transcript.
      if (resultSummary === undefined) {
        for (const m of messages) {
          for (const other of m.content) {
            if (
              (other.type === 'tool_result' || other.type === 'bash_result' || other.type === 'todo_result')
              && other.toolUseId === toolUseId
            ) {
              resultSummary = other.summary
              if ('isError' in other) resultIsError = other.isError
              if ('outputPath' in other && typeof other.outputPath === 'string') resultOutputPath = other.outputPath
            }
          }
        }
      }
      return {
        toolUseId: block.toolUseId,
        toolName: block.toolName,
        messageId: message.id,
        input: block.input ?? '',
        ...(block.status ? { status: block.status } : {}),
        ...(resultSummary !== undefined ? { resultSummary } : {}),
        ...(resultIsError !== undefined ? { resultIsError } : {}),
        ...(resultOutputPath ? { resultOutputPath } : {}),
      }
    }
  }
  return null
}

export interface PageResult<T> {
  items: T[]
  /** Exclusive end index into the full source list for the next older page; null if no older. */
  cursor: number | null
  hasMore: boolean
  total: number
  /** Inclusive start index of this page in the full source list. */
  startIndex: number
  endIndex: number
}

/**
 * Paginate a list. Default: newest page (tail).
 * With messageId: page ending at that message (or around-window on the full list).
 * Indices are into `items` as passed (already role-filtered when desired).
 */
export function pageItems<T extends { id: string }>(
  items: T[],
  opts: { limit: number; cursor?: number | null; messageId?: string; around?: number },
): PageResult<T> {
  const total = items.length
  if (total === 0) {
    return { items: [], cursor: null, hasMore: false, total: 0, startIndex: 0, endIndex: 0 }
  }

  if (opts.messageId) {
    const idx = items.findIndex((m) => m.id === opts.messageId)
    if (idx < 0) {
      return { items: [], cursor: null, hasMore: false, total, startIndex: 0, endIndex: 0 }
    }
    if (opts.around != null) {
      const start = Math.max(0, idx - opts.around)
      const end = Math.min(total, idx + opts.around + 1)
      return {
        items: items.slice(start, end),
        cursor: start > 0 ? start : null,
        hasMore: start > 0,
        total,
        startIndex: start,
        endIndex: end,
      }
    }
    const end = idx + 1
    const start = Math.max(0, end - opts.limit)
    return {
      items: items.slice(start, end),
      cursor: start > 0 ? start : null,
      hasMore: start > 0,
      total,
      startIndex: start,
      endIndex: end,
    }
  }

  const end = opts.cursor ?? total
  const clampedEnd = Math.max(0, Math.min(total, end))
  const start = Math.max(0, clampedEnd - opts.limit)
  return {
    items: items.slice(start, clampedEnd),
    cursor: start > 0 ? start : null,
    hasMore: start > 0,
    total,
    startIndex: start,
    endIndex: clampedEnd,
  }
}

export function formatTextMessages(
  messages: ChatMessage[],
  opts?: { includeThinking?: boolean; withToolCount?: boolean },
): string {
  const lines: string[] = []
  for (const msg of messages) {
    const text = extractMessageText(msg, { includeThinking: opts?.includeThinking })
    const toolCount = opts?.withToolCount ? countTools(msg) : 0
    const meta =
      opts?.withToolCount && msg.role === 'assistant'
        ? ` · tools:${toolCount}`
        : ''
    lines.push(`## [${msg.id}] ${msg.role} · ${msg.createdAt}${meta}`)
    lines.push(text || '_(empty)_')
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

export function formatToolIndex(entries: ToolIndexEntry[]): string {
  if (entries.length === 0) return '_(no tools)_'
  const byMessage = new Map<string, ToolIndexEntry[]>()
  for (const e of entries) {
    const list = byMessage.get(e.messageId) ?? []
    list.push(e)
    byMessage.set(e.messageId, list)
  }
  const lines: string[] = []
  for (const [messageId, tools] of byMessage) {
    lines.push(`## message ${messageId} · ${tools.length} tool${tools.length === 1 ? '' : 's'}`)
    for (const t of tools) {
      const target = t.target ? `  ${t.target}` : ''
      const err = t.isError ? '  error' : ''
      const status = t.status && t.status !== 'complete' ? `  (${t.status})` : ''
      lines.push(`- ${t.toolName}${target}${status}${err}`)
      lines.push(`  toolUseId: ${t.toolUseId}`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/** Full-text search haystack for a message (user/assistant text only). */
export function messageSearchText(message: ChatMessage): string {
  return extractMessageText(message)
}
