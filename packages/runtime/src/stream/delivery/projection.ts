import { compactToolHeader } from './tool-header'
import { detailSnapshotBody, TOOL_CHUNK_CHARS, type ToolBodyAddress } from '@superone/shared/transcript-window/tool-body'
import type { DetailUpdate } from '@superone/shared/environment/detail'
import { compactMediaToolResult, revealTodoResults } from './remote-content'
import { codexToolDetail, nestedCodexItem, deferTool, isFileMutationChild, projectCodexTool, projectTool, taskFileChanges, toolDetail } from './progressive-tools'
import type { AgentEvent, BashEditDiff, ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { bashEditFileChanges, summarizeBashEditDiff } from '@superone/shared/bash-edit-diff'
import { isSubagentToolName } from '@superone/shared/tool-ui'

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

function projectBashEditDiff(diff: BashEditDiff): BashEditDiff {
  const summary = summarizeBashEditDiff(diff)
  const changedFiles = [...new Set([...diff.files.map(file => file.filePath), ...(diff.changedFiles ?? [])])]
  // File names and totals belong in the collapsed row; hunks arrive through
  // toolDetail only when the row is opened.
  return { ...diff, files: [], moreFiles: summary.files, changedFiles, summary, fileChanges: bashEditFileChanges(diff) }
}

export function projectProgressiveMessage(message: ChatMessage): ChatMessage {
  return projectToolHeaders(message, false)
}

/** session.load readers still reduce the original input and result shapes. */
export function projectToolHeaders(message: ChatMessage, windowHeaders: boolean): ChatMessage {
  const deferredTools = new Map(message.content.flatMap(block => 'toolName' in block && deferTool(block.toolName) ? [[block.toolUseId, block] as const] : []))
  const containerIds = new Set(message.content.flatMap(block => isChildContainer(block) ? [block.toolUseId] : []))
  const content = message.content.map((block, index): ContentBlock => {
    if (block.type === 'thinking') return { ...block, thinking: '', remoteDetail: reference(message.id, 'thinking', index) }
    if ('toolName' in block) return isSubagentToolName(block.toolName)
      ? projectContainer(message, block) : projectTool(block, reference(message.id, 'tool', block.toolUseId), windowHeaders)
    if (block.type !== 'tool_result' || block.app) return block
    const call = deferredTools.get(block.toolUseId)
    if (!call) return block
    const denied = windowHeaders && block.summary.startsWith('[denied] ')
    const header = windowHeaders && !denied && !block.isError && !block.isTimedOut ? compactToolHeader(call.toolName, block.summary, call.input) : undefined
    return {
      type: 'tool_result',
      toolUseId: block.toolUseId,
      // A screenshot path and a dedicated header both affect the collapsed row.
      summary: denied ? '[denied] ' : header ?? compactMediaToolResult(block.summary) ?? '',
      ...(windowHeaders && block.isTimedOut ? { isTimedOut: true } : {}),
      isError: block.isError,
      ...(block.exitCode !== undefined ? { exitCode: block.exitCode } : {}),
      parentToolUseId: block.parentToolUseId,
      ...(call.toolName === 'Bash' && block.bashEditDiff ? { bashEditDiff: projectBashEditDiff(block.bashEditDiff) } : {}),
    }
  }).filter(block => !('parentToolUseId' in block) || !block.parentToolUseId || !containerIds.has(block.parentToolUseId))
  const codex = message.metadata?.codex
  return {
    ...message, content,
    ...(codex ? { metadata: { ...message.metadata, codex: { ...codex, items: codex.items.map(item => item.type === 'reasoning'
      ? { ...item, text: '', remoteDetail: reference(message.id, 'reasoning', item.id) } : projectCodexTool(item, reference(message.id, 'item', item.id), windowHeaders)) } } } : {}),
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
type DetailSubscription = {
  ref: string; text: string; revision: number; packetChars: number
  initial?: { address: ToolBodyAddress; text: string }
}

/** Live detail packets are split so one never outgrows a relay frame. */
const DETAIL_PACKET_CHARS = 64_000
/** Expanded rows one connection may hold in one session. */
const MAX_DETAILS = 64

/**
 * One connection's summarized sessions and the rows it expanded in them. View
 * state belongs to the connection: two frontends on one session each see
 * their own projection and details; persisted transcripts stay complete.
 */
export class DetailViews {
  private readonly sessions = new Map<string, { details: Map<string, DetailSubscription> }>()

  /** Summarize `sessionId` for this connection; without `preserve` it is the only one. */
  open(sessionId: string, preserve = false): void {
    if (!preserve) this.sessions.clear()
    if (!this.sessions.has(sessionId)) this.sessions.set(sessionId, { details: new Map() })
  }

  /** Stop summarizing one session, or all. */
  close(sessionId?: string): void {
    if (sessionId) this.sessions.delete(sessionId)
    else this.sessions.clear()
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }
  hasDetails(sessionId: string): boolean { return (this.sessions.get(sessionId)?.details.size ?? 0) > 0 }

  subscribe(sessionId: string, subscriptionId: string, ref: string, message: ChatMessage, chunkedSnapshot = false): DetailUpdate {
    const view = this.sessions.get(sessionId)
    if (!view) throw new Error('Session subscription expired')
    if (view.details.size >= MAX_DETAILS && !view.details.has(subscriptionId)) throw new Error('Too many expanded details')
    const text = detailText(message, ref)
    const initial = chunkedSnapshot ? detailSnapshotBody(ref, text) : undefined
    view.details.set(subscriptionId, { ref, text, revision: 0, initial, packetChars: chunkedSnapshot ? TOOL_CHUNK_CHARS : DETAIL_PACKET_CHARS })
    return initial
      ? { subscriptionId, revision: 0, offset: 0, text: initial.envelope, body: initial.address }
      : { subscriptionId, revision: 0, offset: 0, text }
  }

  /** Read the immutable opening revision while subsequent updates advance the live text. */
  initialChunk(sessionId: string, subscriptionId: string, address: Pick<ToolBodyAddress, 'messageId' | 'toolUseId' | 'type' | 'digest'>, offset: number): string | undefined {
    const initial = this.sessions.get(sessionId)?.details.get(subscriptionId)?.initial
    if (initial && initial.address.messageId === address.messageId && initial.address.toolUseId === address.toolUseId
      && initial.address.type === address.type && initial.address.digest === address.digest && offset < initial.text.length) {
      return initial.text.slice(offset, offset + TOOL_CHUNK_CHARS)
    }
    return undefined
  }

  unsubscribe(sessionId: string, subscriptionId: string): void {
    this.sessions.get(sessionId)?.details.delete(subscriptionId)
  }

  /** `remote_detail` packets for the expanded rows `messages` changed. */
  updates(sessionId: string, messages: readonly ChatMessage[]): AgentEvent[] {
    const view = this.sessions.get(sessionId)
    if (!view?.details.size) return []
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
        const chunk = text.slice(offset, offset + detail.packetChars)
        updates.push({ type: 'remote_detail', sessionId, subscriptionId, revision: ++detail.revision, offset, text: chunk })
        offset += chunk.length
      } while (offset < text.length)
    }
    return updates
  }
}

/** The top-level subagent card a nested block belongs to, if it is under one. */
function shellContainerOf(message: ChatMessage, parentId: string): Extract<ContentBlock, { toolName: string }> | undefined {
  const byId = new Map(message.content.flatMap(block => 'toolName' in block ? [[block.toolUseId, block] as const] : []))
  let block = byId.get(parentId)
  while (block?.parentToolUseId) block = byId.get(block.parentToolUseId)
  return block && isChildContainer(block) ? block : undefined
}

/** Strip all entry points, including completion metadata and reconnect snapshots. */
export function projectProgressiveEvent(event: AgentEvent, messages: readonly ChatMessage[], windowHeaders = false): AgentEvent | null {
  // Streamed output only changes an expanded row's detail (sent by `DetailViews`);
  // the collapsed shell is identical, so the delta itself is not worth a frame.
  if (event.type === 'content_delta' && 'toolName' in event.delta && event.delta.outputDelta !== undefined && deferTool(event.delta.toolName)) return null
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
  return { ...projectEvent(event, messages, windowHeaders), remoteView: 'summary' }
}
function projectEvent(event: AgentEvent, messages: readonly ChatMessage[], windowHeaders: boolean): AgentEvent {
  if (event.type === 'message_start' || event.type === 'user_message_appended') {
    return { ...event, message: projectToolHeaders(event.message, windowHeaders) }
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
    const index = message?.content.findLastIndex(block => block.type === 'thinking' && (block.parentToolUseId ?? null) === (delta.parentToolUseId ?? null)
      && (delta.id === undefined || block.id === delta.id)) ?? -1
    return { ...event, delta: { ...delta, thinking: '', ...(index >= 0 ? { remoteDetail: reference(event.messageId, 'thinking', index) } : {}) } }
  }
  if (event.type === 'content_delta' && 'toolName' in event.delta) {
    return { ...event, delta: projectTool(event.delta, reference(event.messageId, 'tool', event.delta.toolUseId), windowHeaders) }
  }
  if (event.type === 'content_delta' && event.delta.type === 'tool_result' && message) {
    const toolUseId = event.delta.toolUseId
    const revealed = revealTodoResults(message)
    const projected = projectToolHeaders(revealed, windowHeaders).content.find(block =>
      (block.type === 'tool_result' || block.type === 'todo_result') && block.toolUseId === toolUseId)
    if (projected) return { ...event, delta: projected }
  }
  if ('metadata' in event && event.metadata?.codex) {
    const projected = projectToolHeaders({ id: String(messageId), role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude', content: [], metadata: event.metadata }, windowHeaders)
    return { ...event, metadata: projected.metadata }
  }
  return event
}
