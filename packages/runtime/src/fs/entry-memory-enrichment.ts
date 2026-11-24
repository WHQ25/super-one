import {
  withMemorySummary,
  type MemoryFamily,
  type MemorySummaryPayload,
} from '@superone/shared/interaction-memory'
import { InteractionMemoryStore } from './interaction-memory'
import { deriveProjectMemoryKey, normalizeMemoryDomain } from './memory-target'

export interface EntryMemoryTarget {
  family: MemoryFamily
  targetKey: string
  args: { domain?: string; platform?: string; appId?: string }
}

export interface EntryMemoryEnrichOptions {
  sessionId: string
  toolName: string
  args: Record<string, unknown>
  store: InteractionMemoryStore
  projectPath?: string
  fallbackPlatform?: string
}

const MAX_TRACKED_SESSIONS = 500

export class EntryMemoryTracker {
  private readonly seenBySession = new Map<string, Set<string>>()

  hasSeen(sessionId: string, key: string): boolean {
    return this.seenBySession.get(sessionId)?.has(key) ?? false
  }

  markSeen(sessionId: string, key: string): void {
    let set = this.seenBySession.get(sessionId)
    if (!set) {
      if (this.seenBySession.size >= MAX_TRACKED_SESSIONS) {
        const oldest = this.seenBySession.keys().next().value
        if (oldest !== undefined) this.seenBySession.delete(oldest)
      }
      set = new Set<string>()
      this.seenBySession.set(sessionId, set)
    }
    set.add(key)
  }

  clearSession(sessionId: string): void {
    this.seenBySession.delete(sessionId)
  }
}

export const defaultEntryMemoryTracker = new EntryMemoryTracker()

function firstText(reply: { content: Array<{ type: string; text?: string }> }): string | null {
  for (const block of reply.content) {
    if (block.type === 'text' && typeof block.text === 'string') return block.text
  }
  return null
}

function parseScalarLine(raw: string, key: string): string | undefined {
  const match = raw.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'))
  if (!match) return undefined
  const val = match[1]!.trim()
  if (!val || val === 'null' || val === 'undefined') return undefined
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    try {
      return String(JSON.parse(val))
    } catch {
      return val.slice(1, -1)
    }
  }
  return val
}

function extractFields(reply: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const raw = firstText(reply)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
  }
  const fields: Record<string, unknown> = {}
  for (const key of ['url', 'bundleId', 'appId', 'platform', 'app']) {
    const val = parseScalarLine(raw, key)
    if (val !== undefined) fields[key] = val
  }
  return fields
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function resolveEntryMemoryTarget(
  toolName: string,
  args: Record<string, unknown>,
  reply: { content: Array<{ type: string; text?: string }>; isError?: boolean },
  fallbackPlatform?: string,
): EntryMemoryTarget | null {
  if (reply.isError) return null
  const fields = extractFields(reply)

  const action = str(args.action)
  if (
    toolName === 'browser_open'
    || toolName === 'browser_navigate'
    || (toolName === 'browser_tabs' && (action === 'open' || action === 'navigate'))
  ) {
    const rawUrl = str(fields.url) ?? str(args.url)
    if (!rawUrl) return null
    try {
      const domain = normalizeMemoryDomain(rawUrl)
      return { family: 'browser', targetKey: domain, args: { domain } }
    } catch {
      return null
    }
  }

  if (toolName === 'computer_apps' && (action === 'launch' || action === 'focus')) {
    const platform = str(fields.platform) ?? fallbackPlatform
    const appId = str(fields.bundleId) ?? str(fields.appId) ?? str(args.app)
    if (!platform || !appId) return null
    return { family: 'computer', targetKey: `${platform}/${appId}`, args: { platform, appId } }
  }

  if (toolName === 'device_boot' || toolName === 'device_request_control') {
    const deviceObj = fields.device && typeof fields.device === 'object' && !Array.isArray(fields.device)
      ? fields.device as Record<string, unknown>
      : null
    const platform = str(deviceObj?.platform) ?? str(fields.platform)
    if (!platform) return null
    const appId = str(fields.appId) ?? str(args.appId)
    const targetKey = appId ? `${platform}/${appId}` : platform
    return { family: 'device', targetKey, args: { platform, ...(appId ? { appId } : {}) } }
  }

  return null
}

export async function enrichEntryReplyWithMemory<T extends { content: Array<{ type: string; text?: string }>; isError?: boolean }>(
  reply: T,
  opts: EntryMemoryEnrichOptions,
  tracker: EntryMemoryTracker = defaultEntryMemoryTracker,
): Promise<T> {
  const target = resolveEntryMemoryTarget(opts.toolName, opts.args, reply, opts.fallbackPlatform)
  if (!target) return reply

  const projectKey = deriveProjectMemoryKey(opts.projectPath)
  const dedupeKey = `${projectKey ?? 'global'}:${target.family}:${target.targetKey}`
  if (tracker.hasSeen(opts.sessionId, dedupeKey)) return reply

  const scopedStore = opts.store.withContext({ projectKey })
  const topics = await scopedStore.summarizeForEntry(target.family, target.args)
  if (topics.length === 0) return reply

  tracker.markSeen(opts.sessionId, dedupeKey)
  const payload: MemorySummaryPayload = {
    family: target.family,
    target: target.targetKey,
    topics,
    hint: `Read relevant topics with ${target.family}_memory_read before proceeding. Scope: project (current project) or global (cross-project).`,
  }
  return withMemorySummary(reply, payload)
}
