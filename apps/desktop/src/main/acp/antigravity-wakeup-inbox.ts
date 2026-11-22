import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_INBOX_FILES = 256

export function hasUnreadAntigravityWakeupInboxMessage(
  sessionId: string,
  brainRoots: readonly string[],
): boolean {
  if (!sessionId) return false
  for (const root of brainRoots) {
    const messagesDir = join(root, sessionId, '.system_generated', 'messages')
    if (!existsSync(messagesDir)) continue
    let entries: string[]
    try {
      entries = readdirSync(messagesDir)
    } catch {
      continue
    }
    const messageFiles = entries
      .filter((name) => name.endsWith('.json') && name !== 'read.json')
      .slice(0, MAX_INBOX_FILES)
    if (messageFiles.length === 0) continue

    let readReceipts: Record<string, boolean> = {}
    const readPath = join(messagesDir, 'read.json')
    if (existsSync(readPath)) {
      try {
        const parsed = JSON.parse(readFileSync(readPath, 'utf8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          readReceipts = parsed as Record<string, boolean>
        }
      } catch {
        readReceipts = {}
      }
    }

    for (const filename of messageFiles) {
      const fileId = filename.slice(0, -'.json'.length)
      if (readReceipts[fileId] === true) continue
      try {
        const parsed = JSON.parse(readFileSync(join(messagesDir, filename), 'utf8')) as {
          id?: unknown
          priority?: unknown
        }
        const messageId = typeof parsed?.id === 'string' && parsed.id.trim() ? parsed.id.trim() : fileId
        if (readReceipts[messageId] === true) continue
        if (parsed?.priority === 'MESSAGE_PRIORITY_HIGH') return true
      } catch {
        continue
      }
    }
  }
  return false
}
