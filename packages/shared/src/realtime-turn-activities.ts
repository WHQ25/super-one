import type {
  AgentStatus,
  ChatMessage,
  CodexPlanApprovalState,
  RealtimeTimelineSegment,
} from './agent-types'
import { transcriptRow } from './transcript-rows'
import type { RealtimeConversationTurn } from './realtime-transcript'

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
  /** ISO timestamp the latest backing turn started at; null once it settles. */
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

type TimelineOrder = 'provider' | 'local'

function orderOfSegment(segment: RealtimeTimelineSegment, order: TimelineOrder): number | null {
  return (order === 'provider' ? segment.position : segment.localOrder) ?? null
}

function orderOfMessage(message: ChatMessage, order: TimelineOrder): number | null {
  return order === 'provider'
    ? message.metadata?.codexTimeline?.position ?? null
    : message.metadata?.codexTimeline?.localOrder ?? message._lastAppliedSeq ?? null
}

function backingTurnId(message: ChatMessage): string | undefined {
  return message.metadata?.codexTimeline?.turnId ?? message.metadata?.codex?.turnId
}

function turnStart(turn: RealtimeConversationTurn, order: TimelineOrder): number | null {
  const segments = [...(turn.user ? [turn.user] : []), ...turn.assistant]
  const orders = segments.map(segment => orderOfSegment(segment, order)).filter((value): value is number => value !== null)
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
  const starts = {
    local: turns.map(turn => turnStart(turn, 'local')),
    provider: turns.map(turn => turnStart(turn, 'provider')),
  }
  const messagesByTurn: ChatMessage[][] = turns.map(() => [])
  for (const message of delegated) {
    // Local stamps keep the activity attached after reconciliation. Otherwise use
    // provider positions, without comparing the two scales or unstamped history.
    for (const scale of ['local', 'provider'] as const) {
      const order = orderOfMessage(message, scale)
      if (order === null) continue
      const index = starts[scale].findLastIndex(start => start !== null && start <= order)
      if (index < 0) continue
      messagesByTurn[index].push(message)
      break
    }
  }
  const result = new Map<string, RealtimeTurnActivity>()
  // Compaction/summary rows are notifications, not a new turn taking ownership
  // of the current session's status or pending decision.
  const latestTurn = input.messages.findLast((message) => transcriptRow(message, input.messages).kind === 'turn')

  turns.forEach((turn, index) => {
    const messages = messagesByTurn[index]
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
    const latestMessage = messages.at(-1)!
    const latestTurnId = backingTurnId(latestMessage)
    // A range can contain older completed turns and gaps between them. Time only
    // its latest turn, retaining the first assistant row across steered segments.
    const openedAt = latestTurnId
      ? messages.find(message => message.role === 'assistant' && backingTurnId(message) === latestTurnId)?.createdAt ?? latestMessage.createdAt
      : latestMessage.createdAt
    result.set(turn.id, {
      kind: activityKind(messages),
      status,
      durationMs: durationMs > 0 ? durationMs : null,
      workingSince: status === 'working' && openedAt && !Number.isNaN(Date.parse(openedAt)) ? openedAt : null,
      messageIds: messages.map((message) => message.id),
      turnIds: [...new Set(messages.flatMap((message) => {
        const turnId = backingTurnId(message)
        return turnId ? [turnId] : []
      }))],
      summary: messageSummary(messages),
      plan: latestPlan(messages),
      isTail,
    })
  })
  return result
}
