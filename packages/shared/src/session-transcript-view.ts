/**
 * Pure helpers for rendering SuperOne chat transcripts for session archive MCP tools.
 * Views keep tool calls out of conversational text; tools are indexed separately.
 */

import type { ChatMessage, ContentBlock } from './agent-types'

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

function extractBlockText(block: ContentBlock, includeThinking = false): string {
  if (block.type === 'text' && typeof block.text === 'string') return stripInternalTags(block.text)
  if (includeThinking && block.type === 'thinking' && typeof block.thinking === 'string') return block.thinking.trim()
  if (block.type === 'codex_plan' && typeof block.text === 'string') return block.text.trim()
  return ''
}

export function extractMessageText(message: ChatMessage, opts?: { includeThinking?: boolean }): string {
  return message.content.map((block) => extractBlockText(block, opts?.includeThinking)).filter(Boolean).join('\n\n')
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

export type SessionTextView = 'user' | 'assistant' | 'text'

export interface TranscriptTextBlock {
  message: ChatMessage
  text: string
  /** Position and total among this message's non-empty visible text blocks. */
  index: number
  total: number
}

/**
 * Text-view cursors always index the role-filtered visible block list.
 * messageId anchors at its last visible block, or at its insertion boundary
 * when the message has no blocks in this view. around counts blocks, and never
 * overrides limit. A supplied cursor continues the older page without re-anchoring.
 */
export function pageTextBlocks(
  messages: ChatMessage[],
  opts: {
    view: SessionTextView
    limit: number
    cursor?: number | null
    messageId?: string
    around?: number
    includeThinking?: boolean
  },
): PageResult<TranscriptTextBlock> {
  const items: TranscriptTextBlock[] = []
  let anchor: { start: number; end: number } | undefined
  for (const message of messages) {
    const start = items.length
    if (opts.view === 'text' || message.role === opts.view) {
      const texts = message.content.map((block) => extractBlockText(block, opts.includeThinking)).filter(Boolean)
      texts.forEach((text, index) => items.push({ message, text, index, total: texts.length }))
    }
    if (message.id === opts.messageId) anchor = { start, end: items.length }
  }

  const total = items.length
  const cursor = typeof opts.cursor === 'number' && Number.isFinite(opts.cursor) ? Math.floor(opts.cursor) : null
  let end = Math.max(0, Math.min(total, cursor ?? anchor?.end ?? total))
  let start = Math.max(0, end - opts.limit)
  if (opts.messageId && cursor === null) {
    if (!anchor) return { items: [], cursor: null, hasMore: false, total, startIndex: 0, endIndex: 0 }
    if (typeof opts.around === 'number' && Number.isFinite(opts.around)) {
      const around = Math.max(0, Math.floor(opts.around))
      const hasBlock = anchor.end > anchor.start
      const center = anchor.end - (hasBlock ? 1 : 0)
      const windowStart = Math.max(0, center - around)
      const windowEnd = Math.min(total, anchor.end + around)
      start = Math.max(windowStart, center - Math.floor((opts.limit - (hasBlock ? 1 : 0)) / 2))
      end = Math.min(windowEnd, start + opts.limit)
      start = Math.max(windowStart, end - opts.limit)
    }
  }
  return { items: items.slice(start, end), cursor: start > 0 ? start : null, hasMore: start > 0, total, startIndex: start, endIndex: end }
}

function formatMessageHeader(message: ChatMessage, withToolCount = false): string {
  const meta = withToolCount && message.role === 'assistant' ? ` · tools:${countTools(message)}` : ''
  return `## [${message.id}] ${message.role} · ${message.createdAt}${meta}`
}

export function formatTextBlocks(blocks: TranscriptTextBlock[], opts?: { withToolCount?: boolean }): string {
  const lines: string[] = []
  for (let i = 0; i < blocks.length;) {
    const first = blocks[i]!
    let end = i + 1
    while (end < blocks.length && blocks[end]!.message.id === first.message.id) end++
    const last = blocks[end - 1]!
    lines.push(`${formatMessageHeader(first.message, opts?.withToolCount)} · textBlocks:${first.index + 1}-${last.index + 1}/${first.total}`)
    for (; i < end; i++) lines.push(blocks[i]!.text, '')
  }
  return lines.join('\n').trimEnd()
}

export function formatTextMessages(
  messages: ChatMessage[],
  opts?: { includeThinking?: boolean; withToolCount?: boolean },
): string {
  const lines: string[] = []
  for (const msg of messages) {
    const text = extractMessageText(msg, { includeThinking: opts?.includeThinking })
    lines.push(formatMessageHeader(msg, opts?.withToolCount))
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
