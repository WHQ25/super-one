import { homedir } from 'os'
import { join } from 'path'
import { readdirSync, readFileSync, statSync } from 'fs'
import type { ChatMessage, ContentBlock, LoadSessionMessagesResult, SessionHistoryEntry } from '../shared/agent-types'
import { getSessionTitles } from './session-titles'

function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, '-')
}

/** Strip XML-like internal tags from text; discard entirely if it starts with a command tag. */
function stripInternalTags(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('<command-name>')) return ''
  return trimmed
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .trim()
}

function extractUserText(msgContent: unknown): string {
  let text = ''
  if (typeof msgContent === 'string') text = msgContent
  else if (Array.isArray(msgContent)) {
    text = (msgContent.find((b: { type: string }) => b.type === 'text')?.text as string) ?? ''
  }
  return stripInternalTags(text)
}

/**
 * Read Claude Code native session files from ~/.claude/projects/{encoded-cwd}/*.jsonl
 * Extract sessionId (filename), first user message (title), git branch, message count, and file mtime.
 */
export function listSessions(cwd: string): SessionHistoryEntry[] {
  const dir = join(homedir(), '.claude', 'projects', encodeCwd(cwd))

  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return []
  }

  const entries: SessionHistoryEntry[] = []

  for (const file of files) {
    const filePath = join(dir, file)
    const sessionId = file.replace('.jsonl', '')

    try {
      const stat = statSync(filePath)
      const lines = readFileSync(filePath, 'utf-8').split('\n')

      let title = ''
      let gitBranch: string | undefined
      let messageCount = 0

      for (const line of lines) {
        if (!line) continue
        try {
          const obj = JSON.parse(line)
          if (obj.type === 'user' || obj.type === 'assistant') messageCount++
          if (obj.type !== 'user') continue

          // Extract git branch from first user message that has it
          if (!gitBranch && obj.gitBranch) gitBranch = obj.gitBranch

          // Extract title from first user message with meaningful text
          if (!title) {
            const text = extractUserText(obj.message?.content)
            if (text) title = text.length > 100 ? text.slice(0, 100) + '…' : text
          }
        } catch {
          continue
        }
      }

      // Skip sessions with no messages or no meaningful title (e.g. only internal tags)
      if (messageCount === 0 || !title) continue

      entries.push({
        sessionId,
        title,
        lastActiveAt: stat.mtime.toISOString(),
        gitBranch,
        messageCount,
      })
    } catch {
      continue
    }
  }

  // Apply custom title overrides
  const titleOverrides = getSessionTitles()
  for (const entry of entries) {
    if (titleOverrides[entry.sessionId]) {
      entry.title = titleOverrides[entry.sessionId]
    }
  }

  return entries.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
}

// --- Session message loading with cache ---

const messageCache = new Map<string, ChatMessage[]>()

export function clearSessionMessageCache(): void {
  messageCache.clear()
}

/**
 * Convert JSONL content blocks to our ContentBlock format.
 */
function convertAssistantContent(raw: unknown[]): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const item of raw) {
    const obj = item as Record<string, unknown>
    if (obj.type === 'text' && typeof obj.text === 'string') {
      blocks.push({ type: 'text', text: obj.text })
    } else if (obj.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        toolUseId: (obj.id as string) || '',
        toolName: (obj.name as string) || '',
        input: typeof obj.input === 'string' ? obj.input : JSON.stringify(obj.input ?? {}),
        status: 'complete',
      })
    }
  }
  return blocks
}

function convertToolResultContent(raw: unknown[]): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const item of raw) {
    const obj = item as Record<string, unknown>
    if (obj.type === 'tool_result') {
      const content = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content ?? '')
      const summary = content.length > 200 ? content.slice(0, 200) + '…' : content
      blocks.push({
        type: 'tool_result',
        toolUseId: (obj.tool_use_id as string) || '',
        summary,
      })
    }
  }
  return blocks
}

function isToolResultEntry(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.length > 0 && (content[0] as Record<string, unknown>).type === 'tool_result'
}

function parseSessionMessages(cwd: string, sessionId: string): ChatMessage[] {
  const dir = join(homedir(), '.claude', 'projects', encodeCwd(cwd))
  const filePath = join(dir, `${sessionId}.jsonl`)
  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n')

  const messages: ChatMessage[] = []
  // Track assistant messages by provider message ID to merge content deltas
  let currentAssistant: ChatMessage | null = null

  for (const line of lines) {
    if (!line) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }

    // Skip non-message entries and sidechains
    if (obj.isSidechain) continue
    if (obj.type !== 'user' && obj.type !== 'assistant') continue

    const msg = obj.message as Record<string, unknown> | undefined
    if (!msg) continue
    const content = msg.content

    if (obj.type === 'user') {
      if (isToolResultEntry(content)) {
        // Tool result → merge into current assistant message
        if (currentAssistant) {
          const toolBlocks = convertToolResultContent(content as unknown[])
          currentAssistant.content = [...currentAssistant.content, ...toolBlocks]
        }
      } else {
        // Text user message → new user ChatMessage
        currentAssistant = null
        const text = extractUserText(content)
        if (!text) continue
        messages.push({
          id: (obj.uuid as string) || `user_${Date.now()}_${messages.length}`,
          role: 'user',
          status: 'complete',
          content: [{ type: 'text', text }],
          createdAt: (obj.timestamp as string) || new Date().toISOString(),
          providerId: 'history',
        })
      }
    } else if (obj.type === 'assistant') {
      const msgId = msg.id as string | undefined
      const contentArr = Array.isArray(content) ? content : []
      const converted = convertAssistantContent(contentArr as unknown[])
      if (converted.length === 0) continue

      if (currentAssistant && msgId && currentAssistant.providerId === msgId) {
        // Same provider message ID → merge content
        currentAssistant.content = [...currentAssistant.content, ...converted]
      } else {
        // New assistant message
        currentAssistant = {
          id: (obj.uuid as string) || `asst_${Date.now()}_${messages.length}`,
          role: 'assistant',
          status: 'complete',
          content: converted,
          createdAt: (obj.timestamp as string) || new Date().toISOString(),
          providerId: msgId || 'unknown',
        }
        messages.push(currentAssistant)
      }
    }
  }

  return messages
}

/**
 * Load paginated session messages from JSONL file.
 * Returns the last `limit` messages if no cursor, or `limit` messages before cursor.
 */
export function loadSessionMessages(
  cwd: string,
  sessionId: string,
  limit: number,
  cursor?: number
): LoadSessionMessagesResult {
  let all = messageCache.get(sessionId)
  if (!all) {
    try {
      all = parseSessionMessages(cwd, sessionId)
      messageCache.set(sessionId, all)
    } catch {
      return { messages: [], cursor: null, hasMore: false }
    }
  }

  const endIndex = cursor ?? all.length
  const startIndex = Math.max(0, endIndex - limit)
  const messages = all.slice(startIndex, endIndex)
  const hasMore = startIndex > 0

  return {
    messages,
    cursor: hasMore ? startIndex : null,
    hasMore,
  }
}
