/** Provider identities are scoped by the containing session/environment. */
import type { CodexThreadItem } from './agent-types'

export interface CodexTurnProvenance {
  threadId: string
  turnId: string
  rootTurnId?: string | null
}

export interface CodexRequestedTurnProvenance {
  /** Request values only: turn/start can add input to an existing turn. */
  parentTurnId?: string
  rootTurnId?: string
}

export interface CodexSubagentConfiguration {
  model?: string
  /** Preserve future provider values without substituting a known effort. */
  reasoningEffort?: string
}

export interface CodexSubagentActivity {
  id: string
  sourceThreadId: string
  sourceTurnId?: string
  agentThreadId: string
  agentPath: string
  kind: 'started' | 'interacted' | 'interrupted' | 'completed'
  model?: string
  reasoningEffort?: string
}

export interface CodexSubagentMetadata {
  /** Resolved creation values, separate from requested spawn configuration. */
  creationConfiguration?: CodexSubagentConfiguration
  requestedConfiguration?: CodexSubagentConfiguration
  turns?: Record<string, CodexTurnProvenance>
  activities: CodexSubagentActivity[]
}

export function mergeCodexTurnProvenance(
  previous: CodexTurnProvenance | undefined,
  next: CodexTurnProvenance,
): CodexTurnProvenance {
  if (!previous || previous.threadId !== next.threadId || previous.turnId !== next.turnId) return next
  return { ...previous, ...next, ...(previous.rootTurnId && !next.rootTurnId ? { rootTurnId: previous.rootTurnId } : {}) }
}

/** Sparse terminal/interaction records cannot erase a known creation value. */
export function applyCodexSubagentActivity(
  previous: Record<string, CodexSubagentMetadata> | undefined,
  activity: CodexSubagentActivity,
): Record<string, CodexSubagentMetadata> {
  const prior = previous?.[activity.agentThreadId]
  const activities = [...(prior?.activities ?? [])]
  const index = activities.findIndex(entry => entry.id === activity.id && entry.sourceThreadId === activity.sourceThreadId)
  const old = activities[index]
  const merged = index >= 0 ? { ...old, ...activity,
    ...(old.model && !activity.model ? { model: old.model } : {}),
    ...(old.reasoningEffort && !activity.reasoningEffort ? { reasoningEffort: old.reasoningEffort } : {}) } : activity
  if (index >= 0) activities[index] = merged
  else activities.push(merged)
  const creation = activity.kind === 'started'
    ? { ...prior?.creationConfiguration, ...(merged.model ? { model: merged.model } : {}), ...(merged.reasoningEffort ? { reasoningEffort: merged.reasoningEffort } : {}) }
    : prior?.creationConfiguration
  return {
    ...previous,
    [activity.agentThreadId]: {
      ...prior,
      activities,
      ...(creation && Object.keys(creation).length ? { creationConfiguration: creation } : {}),
    },
  }
}

/** Completion snapshots can omit records already delivered by live events. */
export function mergeCodexSubagentMetadata(
  previous: Record<string, CodexSubagentMetadata> | undefined,
  next: Record<string, CodexSubagentMetadata> | undefined,
): Record<string, CodexSubagentMetadata> | undefined {
  if (!next) return previous
  let result = previous
  for (const [threadId, metadata] of Object.entries(next)) {
    if (!metadata || typeof metadata !== 'object') continue
    for (const activity of metadata.activities ?? []) result = applyCodexSubagentActivity(result, activity)
    const current = result?.[threadId] ?? { activities: [] }
    result = { ...result, [threadId]: { ...current,
      ...(metadata.requestedConfiguration || current.requestedConfiguration ? { requestedConfiguration: { ...metadata.requestedConfiguration, ...current.requestedConfiguration } } : {}),
      ...(metadata.turns || current.turns ? { turns: { ...metadata.turns, ...current.turns } } : {}),
      ...(metadata.creationConfiguration || current.creationConfiguration ? { creationConfiguration: { ...metadata.creationConfiguration, ...current.creationConfiguration } } : {}) } }
  }
  return result
}

/** Compact index survives projections that intentionally omit agent card state. */
export function collectCodexCollabMetadata(
  items: readonly CodexThreadItem[],
  previous?: Record<string, CodexSubagentMetadata>,
): Record<string, CodexSubagentMetadata> | undefined {
  let result = previous
  for (const item of items) {
    if (item.type !== 'collab_tool_call') continue
    for (const [threadId, state] of Object.entries(item.agentsStates)) {
      if (!state.requestedConfiguration && !state.turns) continue
      const prior = result?.[threadId] ?? { activities: [] }
      const turns = { ...prior.turns }
      for (const [turnId, turn] of Object.entries(state.turns ?? {})) turns[turnId] = mergeCodexTurnProvenance(turns[turnId], turn)
      result = { ...result, [threadId]: { ...prior,
        ...(state.requestedConfiguration ? { requestedConfiguration: { ...prior.requestedConfiguration, ...state.requestedConfiguration } } : {}),
        ...(Object.keys(turns).length ? { turns } : {}) } }
    }
    for (const children of Object.values(item.childItems ?? {})) result = collectCodexCollabMetadata(children, result)
  }
  return result
}
