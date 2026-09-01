import type { AgentStatus, ChatMessage, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import type { RealtimeConversationTurn } from './realtime-conversation-turns'

export type RealtimeTurnActivityStatus = 'working' | 'completed' | 'needs-decision' | 'failed'
export type RealtimeTurnActivityKind = 'codex' | 'workflow' | 'command' | 'files' | 'search'

export interface RealtimeTurnActivity {
  kind: RealtimeTurnActivityKind
  status: RealtimeTurnActivityStatus
  durationMs: number | null
  messageIds: string[]
  turnIds: string[]
  summary: string | null
}

function orderOfSegment(segment: RealtimeTimelineSegment): number | null {
  return segment.position ?? segment.localOrder ?? null
}

function orderOfMessage(message: ChatMessage): number | null {
  return message.metadata?.codexTimeline?.position
    ?? message.metadata?.codexTimeline?.localOrder
    ?? message._lastAppliedSeq
    ?? null
}

function turnStart(turn: RealtimeConversationTurn): number | null {
  const segments = [...(turn.user ? [turn.user] : []), ...turn.assistant]
  const orders = segments.map(orderOfSegment).filter((value): value is number => value !== null)
  return orders.length > 0 ? Math.min(...orders) : null
}

function activityKind(messages: readonly ChatMessage[]): RealtimeTurnActivityKind {
  const items = messages.flatMap((message) => message.metadata?.codex?.items ?? [])
  if (items.some((item) => item.type === 'collab_tool_call')) return 'workflow'
  if (items.some((item) => item.type === 'command_execution')) return 'command'
  if (items.some((item) => item.type === 'file_change')) return 'files'
  if (items.some((item) => item.type === 'web_search')) return 'search'
  return 'codex'
}

function messageSummary(messages: readonly ChatMessage[]): string | null {
  const finalResponse = [...messages].reverse().map((message) => {
    const metadataText = message.metadata?.codex?.finalResponse?.trim()
    if (metadataText) return metadataText
    return message.content
      .filter((block): block is Extract<ChatMessage['content'][number], { type: 'text' }> => block.type === 'text')
      .map((block) => block.text.trim())
      .filter(Boolean)
      .join(' ')
  }).find(Boolean)
  if (!finalResponse) return null
  return finalResponse.length > 140 ? `${finalResponse.slice(0, 137).trimEnd()}…` : finalResponse
}

/**
 * Associate delegated Codex turns with the voice turn whose order interval contains
 * them. Multiple backing turns inside one interval become one activity range.
 */
export function mapRealtimeTurnActivities(input: {
  turns: readonly RealtimeConversationTurn[]
  messages: readonly ChatMessage[]
  sessionStatus: AgentStatus
  needsDecision: boolean
}): Map<string, RealtimeTurnActivity> {
  const { turns, sessionStatus, needsDecision } = input
  const delegated = input.messages.filter((message) => (
    message.metadata?.codexTimeline?.provenance === 'realtime-delegated'
  ))
  const starts = turns.map(turnStart)
  const result = new Map<string, RealtimeTurnActivity>()

  turns.forEach((turn, index) => {
    const start = starts[index]
    const next = starts[index + 1]
    if (start === null) return
    const messages = delegated.filter((message) => {
      const order = orderOfMessage(message)
      return order !== null && order >= start && (next === null || next === undefined || order < next)
    })
    if (messages.length === 0) return
    const isTail = messages.at(-1) === delegated.at(-1)
    const failed = messages.some((message) => message.status === 'error')
    const working = messages.some((message) => message.status === 'streaming')
      || (isTail && (sessionStatus === 'streaming' || sessionStatus === 'background'))
    const status: RealtimeTurnActivityStatus = isTail && needsDecision
      ? 'needs-decision'
      : failed || (isTail && sessionStatus === 'error')
        ? 'failed'
        : working
          ? 'working'
          : 'completed'
    const durationMs = messages.reduce((total, message) => total + (message.metadata?.codex?.durationMs ?? 0), 0)
    result.set(turn.id, {
      kind: activityKind(messages),
      status,
      durationMs: durationMs > 0 ? durationMs : null,
      messageIds: messages.map((message) => message.id),
      turnIds: [...new Set(messages.flatMap((message) => {
        const turnId = message.metadata?.codexTimeline?.turnId ?? message.metadata?.codex?.turnId
        return turnId ? [turnId] : []
      }))],
      summary: messageSummary(messages),
    })
  })
  return result
}
