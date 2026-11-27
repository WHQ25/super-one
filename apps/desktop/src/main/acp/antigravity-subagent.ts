import { readFileSync } from 'node:fs'
import type { AgentEvent } from '@superone/shared/agent-types'
import { isSubagentToolName } from '@superone/shared/tool-ui'
import {
  clearSettledWakeupBackgroundTasks,
  createBackgroundTaskTrackerState,
  disposeBackgroundTaskTracker,
  noteBackgroundTaskMappedEvents,
  pruneStaleUnboundBackgroundTasks,
  syncBackgroundTasks,
  type BackgroundTaskTrackerState,
} from './antigravity-background-task'
import { resolveAntigravityBrainRoots } from './antigravity-profile'
import {
  extractParentSubagentTranscriptState,
  type SpawnedSubagentRef,
} from './antigravity-subagent-transcript'
import {
  emitStoppedTrackedSubagent,
  findAntigravityTranscriptPath,
  syncTrackedSubagentEntries,
  type SubagentSyncContext,
  type TrackedSubagent,
} from './antigravity-wakeup-emitter'

export * from './antigravity-subagent-transcript'
export * from './antigravity-background-task'

const POLL_INTERVAL_MS = 250

interface SessionSubagentState extends SubagentSyncContext {
  parentSessionId: string
  bgTasks: BackgroundTaskTrackerState
  activeMessageId: string
  timer: ReturnType<typeof setInterval> | null
}

const sessionStates = new Map<string, SessionSubagentState>()

function stopPollingTimer(state: SessionSubagentState): void {
  if (!state.timer) return
  clearInterval(state.timer)
  state.timer = null
}

function syncSessionSubagents(state: SessionSubagentState): void {
  const now = Date.now()
  const parentTranscriptPath = findAntigravityTranscriptPath(state.parentSessionId, state.brainRoots, true)
  let parentRaw = ''
  let spawnedRefs: SpawnedSubagentRef[] = []
  let killedAllAtStepIndex: number | undefined
  let killedSwarmNames: ReadonlySet<string> | undefined
  if (parentTranscriptPath) {
    try {
      parentRaw = readFileSync(parentTranscriptPath, 'utf8')
      if (state.trackedByToolUseId.size > 0) {
        const subState = extractParentSubagentTranscriptState(parentRaw)
        spawnedRefs = subState.spawned
        killedAllAtStepIndex = subState.killedAllAtStepIndex
        killedSwarmNames = subState.killedSwarmNames
      }
    } catch {
      void 0
    }
  }

  syncTrackedSubagentEntries(state, spawnedRefs, now, {
    ...(killedAllAtStepIndex !== undefined ? { killedAllAtStepIndex } : {}),
    ...(killedSwarmNames ? { killedSwarmNames } : {}),
  })

  const bgSummary = parentRaw
    ? syncBackgroundTasks(state.bgTasks, parentRaw, state.emitEvent, {
        fallbackMessageId: state.activeMessageId,
        brainRoots: state.brainRoots,
      })
    : { anyActiveNonDaemon: false }

  const anyActiveSubagent = [...state.trackedByToolUseId.values()].some((e) => !e.completed)
  if (anyActiveSubagent || bgSummary.anyActiveNonDaemon) {
    if (!state.timer) {
      state.timer = setInterval(() => syncSessionSubagents(state), POLL_INTERVAL_MS)
      state.timer.unref?.()
    }
  } else {
    stopPollingTimer(state)
  }
}

function getOrCreateSessionState(
  parentSessionId: string,
  messageId: string,
  emitEvent: (event: AgentEvent) => void,
  customBrainRoots?: string[],
): SessionSubagentState {
  let state = sessionStates.get(parentSessionId)
  if (!state) {
    state = {
      parentSessionId,
      brainRoots: customBrainRoots ?? resolveAntigravityBrainRoots(),
      emitEvent,
      boundConversationIds: new Set(),
      trackedByToolUseId: new Map(),
      bgTasks: createBackgroundTaskTrackerState(),
      activeMessageId: messageId,
      timer: null,
    }
    sessionStates.set(parentSessionId, state)
    return state
  }
  if (state.activeMessageId !== messageId) {
    pruneStaleUnboundBackgroundTasks(state.bgTasks)
  }
  state.emitEvent = emitEvent
  state.activeMessageId = messageId
  if (customBrainRoots) state.brainRoots = customBrainRoots
  return state
}

export function noteAntigravitySubagentEvents(
  parentSessionId: string,
  messageId: string,
  mappedEvents: ReadonlyArray<AgentEvent>,
  emitEvent: (event: AgentEvent) => void,
  customBrainRoots?: string[],
): void {
  const hasRelevantEvent = mappedEvents.some(
    (ev) =>
      ev.type === 'content_delta' &&
      ((ev.delta.type === 'tool_use' &&
        (isSubagentToolName(ev.delta.toolName) ||
          ev.delta.toolName === 'Bash' ||
          ev.delta.toolName === 'Workflow' ||
          ev.delta.toolName.toLowerCase() === 'schedule')) ||
        ev.delta.type === 'tool_result'),
  )
  const existingState = sessionStates.get(parentSessionId)
  if (!hasRelevantEvent && !existingState) return

  const state = getOrCreateSessionState(parentSessionId, messageId, emitEvent, customBrainRoots)

  let notedSubagent = false
  for (const event of mappedEvents) {
    if (event.type !== 'content_delta' || event.delta.type !== 'tool_use') continue
    if (!isSubagentToolName(event.delta.toolName)) continue

    notedSubagent = true
    if (state.trackedByToolUseId.has(event.delta.toolUseId)) continue

    let description = 'Subagent'
    let isSwarmWorker = false
    let swarmName: string | undefined
    try {
      const parsedIn = JSON.parse(event.delta.input) as Record<string, unknown>
      if (typeof parsedIn.description === 'string' && parsedIn.description.trim()) {
        description = parsedIn.description.trim()
      } else if (typeof parsedIn.subagent_type === 'string' && parsedIn.subagent_type.trim()) {
        description = parsedIn.subagent_type.trim()
      }
      isSwarmWorker = parsedIn.isSwarmWorker === true
      if (isSwarmWorker) {
        const rawName =
          typeof parsedIn.name === 'string' && parsedIn.name.trim()
            ? parsedIn.name.trim()
            : typeof parsedIn.Name === 'string' && parsedIn.Name.trim()
              ? parsedIn.Name.trim()
              : typeof parsedIn.subagent_type === 'string' && parsedIn.subagent_type.trim()
                ? parsedIn.subagent_type.trim()
                : undefined
        swarmName = rawName
      }
    } catch {
      void 0
    }

    const entry: TrackedSubagent = {
      toolUseId: event.delta.toolUseId,
      messageId,
      description,
      startedAtMs: Date.now(),
      ...(isSwarmWorker ? { isSwarmWorker: true, ...(swarmName ? { swarmName } : {}) } : {}),
      lastRawLength: 0,
      completed: false,
    }
    state.trackedByToolUseId.set(event.delta.toolUseId, entry)

    emitEvent({
      type: 'task_started',
      taskId: '',
      toolUseId: event.delta.toolUseId,
      description,
      isBackgrounded: true,
    })
  }

  const notedBg = noteBackgroundTaskMappedEvents(
    state.bgTasks,
    messageId,
    mappedEvents,
    state.emitEvent,
    state.brainRoots,
  )
  const anyActiveSubagent = [...state.trackedByToolUseId.values()].some((e) => !e.completed)
  if (notedSubagent || notedBg || anyActiveSubagent) {
    syncSessionSubagents(state)
  }
}

export function markAntigravityForegroundTurnEnded(parentSessionId: string): void {
  const state = sessionStates.get(parentSessionId)
  if (!state) return
  syncSessionSubagents(state)
  clearSettledWakeupBackgroundTasks(state.bgTasks, state.emitEvent, state.brainRoots)
  stopPollingTimer(state)
}

export function cancelAntigravitySubagentWakeupWait(parentSessionId: string): boolean {
  const state = sessionStates.get(parentSessionId)
  if (!state) return false
  let hadActive = false
  for (const entry of state.trackedByToolUseId.values()) {
    if (!entry.completed) {
      hadActive = true
      emitStoppedTrackedSubagent(state, entry)
    }
  }
  clearSettledWakeupBackgroundTasks(state.bgTasks, state.emitEvent, state.brainRoots)
  stopPollingTimer(state)
  return hadActive
}

export function disposeAntigravitySubagentTracker(parentSessionId?: string): void {
  if (parentSessionId) {
    const state = sessionStates.get(parentSessionId)
    if (state) {
      stopPollingTimer(state)
      disposeBackgroundTaskTracker(state.bgTasks)
    }
    sessionStates.delete(parentSessionId)
    return
  }
  for (const state of sessionStates.values()) {
    stopPollingTimer(state)
    disposeBackgroundTaskTracker(state.bgTasks)
  }
  sessionStates.clear()
}
