import type { CodexCollabAgentState, CodexCollabAgentStatus, CodexCollabTool, CodexCollabToolCallItem, CodexThreadItem } from '@superone/shared/agent-types'
import { mergeCodexTurnProvenance } from '@superone/shared/codex-metadata'
import { readCodexTurnProvenance } from './protocol-v162'

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const string = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => Boolean(string(entry))) : []

function tool(value: unknown): CodexCollabTool | undefined {
  switch (value) {
    case 'spawnAgent': case 'spawn_agent': return 'spawnAgent'
    case 'sendInput': case 'send_input': return 'sendInput'
    case 'wait': case 'wait_agent': return 'wait'
    case 'closeAgent': case 'close_agent': return 'closeAgent'
    case 'resumeAgent': case 'resume_agent': return 'resumeAgent'
    default: return undefined
  }
}

function status(value: unknown): CodexCollabAgentStatus | undefined {
  switch (value) {
    case 'pendingInit': case 'pending_init': return 'pendingInit'
    case 'running': case 'completed': case 'shutdown': return value
    case 'errored': case 'error': return 'errored'
    case 'notFound': case 'not_found': return 'notFound'
    default: return undefined
  }
}

/** Shared by desktop and nodes. Spawn fields are requested, never resolved values. */
export function mapCodexCollabItem(rec: Record<string, unknown>, previous?: CodexThreadItem): CodexCollabToolCallItem | null {
  const prior = previous?.type === 'collab_tool_call' ? previous : undefined
  const id = string(rec.id) ?? prior?.id
  if (!id) return null
  const candidates = [...strings(rec.receiverThreadIds ?? rec.receiver_thread_ids), string(rec.receiverThreadId ?? rec.receiver_thread_id), string(rec.newThreadId ?? rec.new_thread_id)]
  const receivers = [...new Set(candidates.filter((entry): entry is string => Boolean(entry)))]
  const receiverThreadIds = receivers.length ? receivers : prior?.receiverThreadIds ?? []
  const agentsStates: Record<string, CodexCollabAgentState> = { ...prior?.agentsStates }
  const rawStates = record(rec.agentsStates ?? rec.agents_states)
  const rawStatus = rec.agentStatus ?? rec.agent_status
  const rawAgent = record(rawStatus)
  const apply = (agentId: string, state: Record<string, unknown>) => {
    const previousState = prior?.agentsStates[agentId]
    agentsStates[agentId] = { ...previousState, status: status(state.status) ?? previousState?.status ?? 'running',
      ...(state.message != null ? { message: string(state.message) } : {}) }
  }
  if (rawStates) for (const [agentId, value] of Object.entries(rawStates)) {
    const state = record(value)
    if (state) apply(agentId, state)
  }
  if (!rawStates && rawStatus != null) for (const agentId of receiverThreadIds) apply(agentId, { ...rawAgent, status: rawAgent?.status ?? rawStatus })
  const resolvedTool = tool(rec.tool) ?? prior?.tool ?? 'spawnAgent'
  const model = string(rec.model), reasoningEffort = string(rec.reasoningEffort ?? rec.reasoning_effort)
  if (resolvedTool === 'spawnAgent' && (model || reasoningEffort)) for (const agentId of receiverThreadIds) {
    const state = agentsStates[agentId] ?? { status: 'pendingInit' as const }
    agentsStates[agentId] = { ...state, requestedConfiguration: { ...state.requestedConfiguration,
      ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}) } }
  }
  const senderThreadId = string(rec.senderThreadId ?? rec.sender_thread_id) ?? prior?.senderThreadId
  const prompt = string(rec.prompt) ?? prior?.prompt
  return { id, type: 'collab_tool_call', tool: resolvedTool,
    status: rec.status === 'completed' ? 'completed' : rec.status === 'failed' ? 'failed' : 'in_progress',
    receiverThreadIds, agentsStates, ...(senderThreadId ? { senderThreadId } : {}), ...(prompt ? { prompt } : {}),
    ...(prior?.childItems ? { childItems: prior.childItems } : {}) }
}

export function withCodexChildTurn(item: CodexCollabToolCallItem, threadId: string, raw: unknown): CodexCollabToolCallItem {
  const provenance = readCodexTurnProvenance(raw, threadId)
  if (!provenance) return item
  const state = item.agentsStates[threadId] ?? { status: 'pendingInit' as const }
  const turn = mergeCodexTurnProvenance(state.turns?.[provenance.turnId], provenance)
  const previous = state.turns?.[turn.turnId]
  if (previous?.threadId === turn.threadId && previous.rootTurnId === turn.rootTurnId) return item
  return { ...item, agentsStates: { ...item.agentsStates, [threadId]: { ...state, turns: { ...state.turns, [turn.turnId]: turn } } } }
}
