import type {
  AgentStatus,
  ChatMessage,
  CodexPlanApprovalState,
  RealtimeTimelineSegment,
} from '@superone/shared/agent-types'
import { transcriptRow } from '@superone/chat-view/transcript-rows'
import type { RealtimeConversationTurn } from './realtime-conversation-turns'

export type RealtimeTurnActivityStatus = 'working' | 'completed' | 'needs-decision' | 'failed'
export type RealtimeTurnActivityKind = 'codex' | 'workflow' | 'command' | 'files' | 'search'

/** The plan a delegated turn ended on, so the voice view can answer it in place. */
export interface RealtimeTurnActivityPlan {
  text: string
  approval: CodexPlanApprovalState | null
}

export interface RealtimeTurnActivity {
  kind: RealtimeTurnActivityKind
  status: RealtimeTurnActivityStatus
  durationMs: number | null
  /** ISO timestamp the running range opened at; null once it settles. */
  workingSince: string | null
  messageIds: string[]
  turnIds: string[]
  summary: string | null
  plan: RealtimeTurnActivityPlan | null
  /** Whether the range is the session's latest turn and so owns its live status. */
  isTail: boolean
}

export type RealtimeTranscriptLayoutRow =
  | { kind: 'voice'; turnId: string }
  | { kind: 'activity'; turnId: string }

/**
 * The voice timeline is spoken turns only, each followed by the card for the Codex
 * work it delegated. Unfinished work stays at the live edge: realtime speech can
 * continue while that work runs, so pinning the card to its originating voice turn
 * would make newer speech appear below an older, still-running card.
 */
export function buildRealtimeTranscriptLayout(
  turns: readonly RealtimeConversationTurn[],
  activities: ReadonlyMap<string, RealtimeTurnActivity>,
): RealtimeTranscriptLayoutRow[] {
  const rows: RealtimeTranscriptLayoutRow[] = []
  const trailing: RealtimeTranscriptLayoutRow[] = []

  for (const turn of turns) {
    rows.push({ kind: 'voice', turnId: turn.id })
    const activity = activities.get(turn.id)
    if (!activity) continue
    const row = { kind: 'activity', turnId: turn.id } as const
    if (activity.status === 'working') trailing.push(row)
    else rows.push(row)
  }

  return [...rows, ...trailing]
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

function latestPlan(messages: readonly ChatMessage[]): RealtimeTurnActivityPlan | null {
  const last = messages.at(-1)
  const items = last?.metadata?.codex?.items ?? []
  const plan = items.findLast((item) => item.type === 'plan')
  if (!plan) return null
  return { text: plan.text, approval: last?.metadata?.codex?.planApproval ?? null }
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
  // Compaction/summary rows are notifications, not a new turn taking ownership
  // of the current session's status or pending decision.
  const latestTurn = input.messages.findLast((message) => transcriptRow(message, input.messages).kind === 'turn')

  turns.forEach((turn, index) => {
    const start = starts[index]
    const next = starts[index + 1]
    if (start === null) return
    const messages = delegated.filter((message) => {
      const order = orderOfMessage(message)
      return order !== null && order >= start && (next === null || next === undefined || order < next)
    })
    if (messages.length === 0) return
    // Session status belongs to the current thread turn, not the last voice task
    // forever. A later typed user row already ends this range's ownership, even
    // before its assistant response arrives.
    const isTail = messages.at(-1) === latestTurn
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
    const openedAt = messages[0]?.createdAt
    result.set(turn.id, {
      kind: activityKind(messages),
      status,
      durationMs: durationMs > 0 ? durationMs : null,
      workingSince: status === 'working' && openedAt && !Number.isNaN(Date.parse(openedAt)) ? openedAt : null,
      messageIds: messages.map((message) => message.id),
      turnIds: [...new Set(messages.flatMap((message) => {
        const turnId = message.metadata?.codexTimeline?.turnId ?? message.metadata?.codex?.turnId
        return turnId ? [turnId] : []
      }))],
      summary: messageSummary(messages),
      plan: latestPlan(messages),
      isTail,
    })
  })
  return result
}
