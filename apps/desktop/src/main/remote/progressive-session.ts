import { compactMediaToolResult } from '../remote-content'
import { codexToolDetail, nestedCodexItem, deferTool, isFileMutationChild, projectCodexTool, projectTool, taskFileChanges, toolDetail } from './progressive-tools'
import type { AgentEvent, ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { isSubagentToolName } from '@superone/shared/tool-ui'

/** View preferences are device-scoped; persisted transcripts remain complete. */
const views = new Map<string, { sessionId: string; details: Map<string, DetailSubscription> }>()
type DetailSubscription = { ref: string; text: string; revision: number }

export function setProgressiveSession(deviceId: string, sessionId?: string): void {
  views.delete(deviceId)
  if (sessionId) views.set(deviceId, { sessionId, details: new Map() })
}
export function isProgressiveSession(deviceId: string, sessionId: string): boolean {
  return views.get(deviceId)?.sessionId === sessionId
}
const reference = (messageId: string, kind: string, key: string | number) => JSON.stringify([messageId, kind, key])

/**
 * Only a subagent card owns its children: the phone fetches them with the card's
 * detail on expand. A forked Skill (`/code-review`) also parents its blocks, but
 * the desktop renders those inline, so they stream to the phone like any other row.
 */
function isChildContainer(block: ContentBlock): block is Extract<ContentBlock, { toolName: string }> {
  return 'toolName' in block && isSubagentToolName(block.toolName)
}

/**
 * The container's shell plus the one fact its dropped children owe the turn:
 * which files the subagent edited (`taskFileChanges`), so the phone's diff
 * stat counts them like the desktop does.
 */
function projectContainer(message: ChatMessage, block: Extract<ContentBlock, { toolName: string }>, changes = taskFileChanges(message, block.toolUseId)): ContentBlock {
  const projected = projectTool(block, reference(message.id, 'tool', block.toolUseId))
  return changes.length > 0 ? { ...projected, taskFileChanges: changes } as ContentBlock : projected
}

export function projectProgressiveMessage(message: ChatMessage): ChatMessage {
  const deferredIds = new Set(message.content.flatMap(block => 'toolName' in block && deferTool(block.toolName) ? [block.toolUseId] : []))
  const containerIds = new Set(message.content.flatMap(block => isChildContainer(block) ? [block.toolUseId] : []))
  const content = message.content.map((block, index): ContentBlock => block.type === 'thinking'
    ? { ...block, thinking: '', remoteDetail: reference(message.id, 'thinking', index) }
    : 'toolName' in block
      ? (isSubagentToolName(block.toolName) ? projectContainer(message, block) : projectTool(block, reference(message.id, 'tool', block.toolUseId)))
    : block.type === 'tool_result' && deferredIds.has(block.toolUseId)
      ? {
        type: 'tool_result',
        toolUseId: block.toolUseId,
        // Screenshots are the visible UI of the row, same bargain as widget/media
        // tools: keep the path in the summary so expand can load the image.
        summary: compactMediaToolResult(block.summary) ?? '',
        isError: block.isError,
        parentToolUseId: block.parentToolUseId,
      } : block).filter(block => !('parentToolUseId' in block) || !block.parentToolUseId || !containerIds.has(block.parentToolUseId))
  const codex = message.metadata?.codex
  return {
    ...message, content,
    ...(codex ? { metadata: { ...message.metadata, codex: { ...codex, items: codex.items.map(item => item.type === 'reasoning'
      ? { ...item, text: '', remoteDetail: reference(message.id, 'reasoning', item.id) } : projectCodexTool(item, reference(message.id, 'item', item.id))) } } } : {}),
  }
}

export function detailMessageId(ref: string): string {
  const parts: unknown = JSON.parse(ref)
  if (!Array.isArray(parts) || parts.length !== 3 || typeof parts[0] !== 'string') throw new Error('Invalid detail reference')
  return parts[0]
}
function detailText(message: ChatMessage, ref: string): string {
  const [messageId, kind, key] = JSON.parse(ref)
  if (messageId !== message.id) throw new Error('Detail not found')
  if (kind === 'tool' && typeof key === 'string') return toolDetail(message, key)
  if ((kind === 'item' || kind === 'nested-item') && typeof key === 'string') {
    const item = kind === 'nested-item' ? nestedCodexItem(message, key) : message.metadata?.codex?.items.find(item => item.id === key)
    if (item) return codexToolDetail(item, ref)
  }
  if (kind === 'thinking' && Number.isInteger(key) && key >= 0) {
    const block = message.content[key]
    if (block?.type === 'thinking') return block.thinking
  }
  if (kind === 'reasoning' && typeof key === 'string') {
    const item = message.metadata?.codex?.items.find(item => item.id === key)
    if (item?.type === 'reasoning') return item.text
  }
  throw new Error('Detail not found')
}
export function subscribeDetail(deviceId: string, sessionId: string, subscriptionId: string, ref: string, message: ChatMessage) {
  const view = views.get(deviceId)
  if (!view || view.sessionId !== sessionId) throw new Error('Session subscription expired')
  if (view.details.size >= 64 && !view.details.has(subscriptionId)) throw new Error('Too many expanded details')
  const text = detailText(message, ref)
  view.details.set(subscriptionId, { ref, text, revision: 0 })
  return { subscriptionId, revision: 0, offset: 0, text }
}
export function unsubscribeDetail(deviceId: string, sessionId: string, subscriptionId: string): void {
  const view = views.get(deviceId)
  if (view?.sessionId === sessionId) view.details.delete(subscriptionId)
}
export function detailUpdates(deviceId: string, sessionId: string, messages: readonly ChatMessage[]): AgentEvent[] {
  const view = views.get(deviceId)
  if (view?.sessionId !== sessionId || !view.details.size) return []
  const updates: AgentEvent[] = []
  for (const [subscriptionId, detail] of view.details) {
    const message = messages.find(message => message.id === detailMessageId(detail.ref))
    if (!message) continue
    let text: string
    try { text = detailText(message, detail.ref) } catch { continue }
    if (text === detail.text) continue
    // Prefix replacement also handles tool JSON: an appended output changes the
    // closing quote/braces, so testing startsWith(previous) would resend it all.
    let offset = 0
    const shared = Math.min(text.length, detail.text.length)
    while (offset < shared && text.charCodeAt(offset) === detail.text.charCodeAt(offset)) offset++
    detail.text = text
    do {
      const chunk = text.slice(offset, offset + 64_000)
      updates.push({ type: 'remote_detail', sessionId, subscriptionId, revision: ++detail.revision, offset, text: chunk })
      offset += chunk.length
    } while (offset < text.length)
  }
  return updates
}

/** The top-level subagent card a nested block belongs to, if it is under one. */
function shellContainerOf(message: ChatMessage, parentId: string): Extract<ContentBlock, { toolName: string }> | undefined {
  const byId = new Map(message.content.flatMap(block => 'toolName' in block ? [[block.toolUseId, block] as const] : []))
  let block = byId.get(parentId)
  while (block?.parentToolUseId) block = byId.get(block.parentToolUseId)
  return block && isChildContainer(block) ? block : undefined
}

/** Strip all entry points, including completion metadata and reconnect snapshots. */
export function projectProgressiveEvent(event: AgentEvent, messages: readonly ChatMessage[]): AgentEvent | null {
  if (event.type === 'content_delta' && 'parentToolUseId' in event.delta && event.delta.parentToolUseId) {
    const parentId = event.delta.parentToolUseId
    const message = messages.find(message => message.id === event.messageId)
    const container = message && shellContainerOf(message, parentId)
    if (container) {
      // The child itself stays behind the card's detail, but a file edit moves
      // the card's `taskFileChanges` — resend the shell in its place. The
      // snapshot is already reduced, so the aggregate includes this delta.
      const toolUseId = 'toolUseId' in event.delta ? event.delta.toolUseId : ''
      if (toolUseId && isFileMutationChild(message, toolUseId)) {
        // Sent explicitly (even empty) so a denied edit clears the rows it added.
        const changes = taskFileChanges(message, container.toolUseId)
        const delta = { ...projectContainer(message, container, changes), taskFileChanges: changes } as ContentBlock
        return { type: 'content_delta', messageId: event.messageId, delta, remoteView: 'summary' }
      }
      return null
    }
    if (messages.some(message => message.content.some(block => isChildContainer(block) && block.toolUseId === parentId))) return null
  }
  return { ...projectEvent(event, messages), remoteView: 'summary' }
}
function projectEvent(event: AgentEvent, messages: readonly ChatMessage[]): AgentEvent {
  if (event.type === 'message_start' || event.type === 'user_message_appended') {
    return { ...event, message: projectProgressiveMessage(event.message) }
  }
  // A nested agent's launch block stays behind its parent card's detail, so the
  // phone never holds it; left alone, its reducer would take the blockless task
  // for a slash-command subagent and synthesize a card at the top of the turn.
  if (event.type === 'task_started' && event.toolUseId && messages.some(message => message.content.some(block => 'toolName' in block && block.toolUseId === event.toolUseId))) {
    return { ...event, skipTranscript: true }
  }
  // Workflow agent rows stay: they are the card's Agents list (label, tool count,
  // tokens, state), not transcript text, and the phone has no other source for them.
  if (event.type === 'task_progress') return { ...event, activityText: undefined, toolEntries: undefined }
  if (event.type === 'task_notification') return { ...event, resultText: undefined, toolEntries: undefined, outputFile: '' }
  const messageId = 'messageId' in event ? event.messageId : undefined
  const message = messages.find(message => message.id === messageId)
  if (event.type === 'content_delta' && event.delta.type === 'thinking') {
    const delta = event.delta
    const index = message?.content.findLastIndex(block => block.type === 'thinking' && (block.parentToolUseId ?? null) === (delta.parentToolUseId ?? null)) ?? -1
    return { ...event, delta: { ...delta, thinking: '', ...(index >= 0 ? { remoteDetail: reference(event.messageId, 'thinking', index) } : {}) } }
  }
  if (event.type === 'content_delta' && 'toolName' in event.delta) {
    return { ...event, delta: projectTool(event.delta, reference(event.messageId, 'tool', event.delta.toolUseId)) }
  }
  if (event.type === 'content_delta' && event.delta.type === 'tool_result' && message) {
    const projected = projectProgressiveMessage(message).content.find(block => block.type === 'tool_result' && block.toolUseId === (event.delta as { toolUseId: string }).toolUseId)
    if (projected) return { ...event, delta: projected }
  }
  if (event.type === 'codex_item_delta' && event.item.type === 'reasoning') {
    return { ...event, item: { ...event.item, text: '', remoteDetail: reference(event.messageId, 'reasoning', event.item.id) } }
  }
  if (event.type === 'codex_item_patch' && event.patch.type === 'reasoning') {
    return { ...event, patch: { ...event.patch, textDelta: '' } }
  }
  if (event.type === 'codex_item_delta') return { ...event, item: projectCodexTool(event.item, reference(event.messageId, 'item', event.item.id)) }
  if (event.type === 'codex_item_patch' && event.patch.type === 'command_execution') return { ...event, patch: { ...event.patch, aggregatedOutputDelta: '' } }
  if ('metadata' in event && event.metadata?.codex) {
    const projected = projectProgressiveMessage({ id: String(messageId), role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude', content: [], metadata: event.metadata })
    return { ...event, metadata: projected.metadata }
  }
  return event
}
