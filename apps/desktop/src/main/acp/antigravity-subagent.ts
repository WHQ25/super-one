import type { AgentEvent } from '@superone/shared/agent-types'
import { isSubagentToolName } from '@superone/shared/tool-ui'
import {
  createBackgroundTaskTrackerState,
  disposeBackgroundTaskTracker,
  noteBackgroundTaskMappedEvents,
  pruneStaleUnboundBackgroundTasks,
} from './antigravity-background-task'
import { resolveAntigravityBrainRoots } from './antigravity-profile'
import {
  evaluateWakeupReplayDrop,
  resetWakeupReplayState,
} from './antigravity-wakeup-emitter'
import {
  ensurePollingTimer,
  isEffectiveWakeupPending,
  noteForegroundTurnEndedOnState,
  settleWakeupWaiters,
  stopPollingTimer,
  syncSessionSubagents,
  type AntigravityIdleWakeupHooks,
  type SessionSubagentState,
} from './antigravity-wakeup-coordinator'

export * from './antigravity-subagent-transcript'
export * from './antigravity-background-task'
export type { AntigravityIdleWakeupHooks }

const DEFAULT_NO_WAKEUP_TIMEOUT_MS = 5_000
const DEFAULT_WAKEUP_RESPONSE_TIMEOUT_MS = 120_000
const DEFAULT_INTERACTION_STALL_TIMEOUT_MS = 1_500

const sessionStates = new Map<string, SessionSubagentState>()

function getOrCreateSessionState(
  parentSessionId: string,
  messageId: string,
  emitEvent: (event: AgentEvent) => void,
  customBrainRoots?: string[],
  idleHooks?: AntigravityIdleWakeupHooks,
): SessionSubagentState {
  let state = sessionStates.get(parentSessionId)
  if (!state) {
    const bgTasks = createBackgroundTaskTrackerState()
    state = {
      parentSessionId,
      brainRoots: customBrainRoots ?? resolveAntigravityBrainRoots(),
      emitEvent,
      ...(idleHooks ? { idleHooks } : {}),
      boundConversationIds: new Set(),
      trackedByToolUseId: new Map(),
      bgTasks,
      wakeupMessageId: messageId,
      idleWakeupMessageId: null,
      subagentWakeupPending: false,
      backgroundWatch: false,
      parentTurnEnded: false,
      foregroundEndStepIndex: null,
      activeWakeupMinSpawnStepIndex: null,
      allWorkCompletedAtMs: null,
      awaitingToolSinceMs: null,
      noWakeupTimeoutMs: DEFAULT_NO_WAKEUP_TIMEOUT_MS,
      wakeupResponseTimeoutMs: DEFAULT_WAKEUP_RESPONSE_TIMEOUT_MS,
      interactionStallTimeoutMs: DEFAULT_INTERACTION_STALL_TIMEOUT_MS,
      hasExplicitStallTimeout: false,
      emittedWakeupStepIndices: new Set(),
      emittedWakeupToolUseIds: new Set(),
      emittedWakeupToolResultIds: new Set(),
      replayedBackgroundToolIds: new Set(),
      unflushedWakeupReplay: false,
      stalledWakeupToolReplay: false,
      unlockedPostStallStream: false,
      streamedPreUserPostStall: false,
      onWakeupToolUseEmitted: (toolUseId, targetMsgId) => {
        const bgEntry = bgTasks.tasksByToolUseId.get(toolUseId)
        if (bgEntry) bgEntry.messageId = targetMsgId
      },
      wakeupWaiters: [],
      timer: null,
      timerIntervalMs: 0,
    }
    sessionStates.set(parentSessionId, state)
    return state
  }
  if (!state.parentTurnEnded && state.wakeupMessageId !== messageId) {
    state.idleWakeupMessageId = null
    pruneStaleUnboundBackgroundTasks(state.bgTasks)
    if (!isEffectiveWakeupPending(state)) {
      state.activeWakeupMinSpawnStepIndex = null
    }
  }
  state.emitEvent = emitEvent
  state.wakeupMessageId = messageId
  if (customBrainRoots) state.brainRoots = customBrainRoots
  if (idleHooks) state.idleHooks = idleHooks
  return state
}

export function noteAntigravitySubagentEvents(
  parentSessionId: string,
  messageId: string,
  mappedEvents: ReadonlyArray<AgentEvent>,
  emitEvent: (event: AgentEvent) => void,
  customBrainRoots?: string[],
  idleHooks?: AntigravityIdleWakeupHooks,
): void {
  const hasRelevantEvent = mappedEvents.some(
    (ev) =>
      ev.type === 'content_delta' &&
      ((ev.delta.type === 'tool_use' &&
        (isSubagentToolName(ev.delta.toolName) ||
          ev.delta.toolName === 'Bash' ||
          ev.delta.toolName.toLowerCase() === 'schedule')) ||
        ev.delta.type === 'tool_result'),
  )
  if (!hasRelevantEvent && !sessionStates.has(parentSessionId)) return

  const state = getOrCreateSessionState(
    parentSessionId,
    messageId,
    emitEvent,
    customBrainRoots,
    idleHooks,
  )

  let notedSubagent = false
  for (const event of mappedEvents) {
    if (event.type !== 'content_delta' || event.delta.type !== 'tool_use') continue
    if (!isSubagentToolName(event.delta.toolName)) continue

    notedSubagent = true
    if (!isEffectiveWakeupPending(state)) {
      state.activeWakeupMinSpawnStepIndex = null
    }
    state.subagentWakeupPending = true
    state.parentTurnEnded = false
    state.allWorkCompletedAtMs = null

    if (state.trackedByToolUseId.has(event.delta.toolUseId)) continue

    let description = 'Subagent'
    try {
      const parsedIn = JSON.parse(event.delta.input) as Record<string, unknown>
      if (typeof parsedIn.description === 'string' && parsedIn.description.trim()) {
        description = parsedIn.description.trim()
      } else if (typeof parsedIn.subagent_type === 'string' && parsedIn.subagent_type.trim()) {
        description = parsedIn.subagent_type.trim()
      }
    } catch {
      void 0
    }

    state.trackedByToolUseId.set(event.delta.toolUseId, {
      toolUseId: event.delta.toolUseId,
      messageId,
      description,
      startedAtMs: Date.now(),
      lastRawLength: 0,
      completed: false,
    })

    emitEvent({
      type: 'task_started',
      taskId: '',
      toolUseId: event.delta.toolUseId,
      description,
      isBackgrounded: true,
    })
  }

  const notedBg = noteBackgroundTaskMappedEvents(state.bgTasks, messageId, mappedEvents, state.emitEvent)
  if (notedSubagent || notedBg || isEffectiveWakeupPending(state)) {
    syncSessionSubagents(state)
  }
}

export function markAntigravityForegroundTurnEnded(parentSessionId: string): void {
  const state = sessionStates.get(parentSessionId)
  if (!state) return
  noteForegroundTurnEndedOnState(state)
}

export function hasPendingAntigravitySubagentWakeup(parentSessionId: string): boolean {
  const state = sessionStates.get(parentSessionId)
  if (!state) return false
  syncSessionSubagents(state)
  const anyActiveSubagent = [...state.trackedByToolUseId.values()].some((e) => !e.completed)
  return anyActiveSubagent || isEffectiveWakeupPending(state)
}

export function waitForAntigravitySubagentWakeup(
  parentSessionId: string,
  opts?: {
    noWakeupTimeoutMs?: number
    wakeupResponseTimeoutMs?: number
    interactionStallTimeoutMs?: number
  },
): Promise<'completed' | 'cancelled'> {
  const state = sessionStates.get(parentSessionId)
  if (!state) return Promise.resolve('completed')
  syncSessionSubagents(state)
  const anyActiveSubagent = [...state.trackedByToolUseId.values()].some((e) => !e.completed)
  if (!anyActiveSubagent && !isEffectiveWakeupPending(state)) {
    return Promise.resolve('completed')
  }
  if (typeof opts?.noWakeupTimeoutMs === 'number' && opts.noWakeupTimeoutMs >= 0) {
    state.noWakeupTimeoutMs = opts.noWakeupTimeoutMs
  }
  if (typeof opts?.wakeupResponseTimeoutMs === 'number' && opts.wakeupResponseTimeoutMs >= 0) {
    state.wakeupResponseTimeoutMs = opts.wakeupResponseTimeoutMs
  }
  if (typeof opts?.interactionStallTimeoutMs === 'number' && opts.interactionStallTimeoutMs >= 0) {
    state.interactionStallTimeoutMs = opts.interactionStallTimeoutMs
    state.hasExplicitStallTimeout = true
  }
  state.parentTurnEnded = true
  return new Promise<'completed' | 'cancelled'>((resolve) => {
    state.wakeupWaiters.push(resolve)
    syncSessionSubagents(state)
  })
}

export function cancelAntigravitySubagentWakeupWait(parentSessionId: string): boolean {
  const state = sessionStates.get(parentSessionId)
  if (!state) return false
  const hadWaiters = state.wakeupWaiters.length > 0 || isEffectiveWakeupPending(state)
  for (const entry of state.trackedByToolUseId.values()) {
    if (!entry.completed && entry.conversationId) {
      state.emitEvent({
        type: 'task_notification',
        toolUseId: entry.toolUseId,
        taskId: entry.conversationId,
        taskStatus: 'stopped',
        outputFile: entry.outputFile ?? '',
        summary: entry.description,
      })
    }
    entry.completed = true
  }
  stopPollingTimer(state)
  settleWakeupWaiters(state, 'cancelled')
  return hadWaiters
}

export function resumeAntigravityTurnOnSteer(parentSessionId: string): void {
  const state = sessionStates.get(parentSessionId)
  if (!state) return
  state.parentTurnEnded = false
  state.foregroundEndStepIndex = null
  for (const resolve of state.wakeupWaiters.splice(0, state.wakeupWaiters.length)) resolve('completed')
  ensurePollingTimer(state)
}

export function hasUnflushedAntigravityWakeupReplay(parentSessionId: string): boolean {
  return sessionStates.get(parentSessionId)?.unflushedWakeupReplay === true
}

export function shouldDropAntigravityPreUserReplay(
  parentSessionId: string,
  update: { sessionUpdate: string; toolCallId?: string },
): boolean {
  return evaluateWakeupReplayDrop(sessionStates.get(parentSessionId), update)
}

export function clearUnflushedAntigravityWakeupReplay(parentSessionId: string): boolean {
  return resetWakeupReplayState(sessionStates.get(parentSessionId))
}

function disposeSessionState(state: SessionSubagentState): void {
  stopPollingTimer(state)
  disposeBackgroundTaskTracker(state.bgTasks)
  settleWakeupWaiters(state, 'cancelled')
}

export function disposeAntigravitySubagentTracker(parentSessionId?: string): void {
  if (parentSessionId) {
    const state = sessionStates.get(parentSessionId)
    if (state) disposeSessionState(state)
    sessionStates.delete(parentSessionId)
    return
  }
  for (const state of sessionStates.values()) disposeSessionState(state)
  sessionStates.clear()
}
