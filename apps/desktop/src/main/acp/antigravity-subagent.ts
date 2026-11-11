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
  extractParentWakeupProgress,
  extractSpawnedSubagentsFromParentTranscript,
  type SpawnedSubagentRef,
} from './antigravity-subagent-transcript'
import {
  emitWakeupProgressSteps,
  findAntigravityTranscriptPath,
  flushRemainingWakeupToolResults,
  syncTrackedSubagentEntries,
  type TrackedSubagent,
} from './antigravity-wakeup-emitter'

export * from './antigravity-subagent-transcript'
export * from './antigravity-background-task'

const POLL_INTERVAL_MS = 250
const IDLE_POLL_INTERVAL_MS = 1_000
const MAX_TRACK_DURATION_MS = 10 * 60 * 1000
const DEFAULT_NO_WAKEUP_TIMEOUT_MS = 5_000
const DEFAULT_WAKEUP_RESPONSE_TIMEOUT_MS = 120_000

export interface AntigravityIdleWakeupHooks {
  isPromptActive: () => boolean
  ensureMessage: () => string
  completeMessage: () => void
}

interface SessionSubagentState {
  parentSessionId: string
  brainRoots: string[]
  emitEvent: (event: AgentEvent) => void
  idleHooks?: AntigravityIdleWakeupHooks
  boundConversationIds: Set<string>
  trackedByToolUseId: Map<string, TrackedSubagent>
  bgTasks: BackgroundTaskTrackerState
  wakeupMessageId: string
  idleWakeupMessageId: string | null
  subagentWakeupPending: boolean
  parentTurnEnded: boolean
  activeWakeupMinSpawnStepIndex: number | null
  allWorkCompletedAtMs: number | null
  noWakeupTimeoutMs: number
  wakeupResponseTimeoutMs: number
  emittedWakeupStepIndices: Set<number>
  emittedWakeupToolResultIds: Set<string>
  unflushedWakeupReplay: boolean
  wakeupWaiters: Array<(outcome: 'completed' | 'cancelled') => void>
  timer: ReturnType<typeof setInterval> | null
  timerIntervalMs: number
}

const sessionStates = new Map<string, SessionSubagentState>()

function isEffectiveWakeupPending(state: SessionSubagentState): boolean {
  if (state.subagentWakeupPending) return true
  for (const entry of state.bgTasks.tasksByToolUseId.values()) {
    if (entry.wakeupRequired) return true
  }
  return false
}

function settleWakeupWaiters(state: SessionSubagentState, outcome: 'completed' | 'cancelled'): void {
  state.subagentWakeupPending = false
  state.parentTurnEnded = false
  state.activeWakeupMinSpawnStepIndex = null
  state.allWorkCompletedAtMs = null
  clearSettledWakeupBackgroundTasks(state.bgTasks)
  const waiters = state.wakeupWaiters.splice(0, state.wakeupWaiters.length)
  for (const resolve of waiters) {
    resolve(outcome)
  }
}

function syncSessionSubagents(state: SessionSubagentState): void {
  const now = Date.now()
  const parentTranscriptPath = findAntigravityTranscriptPath(state.parentSessionId, state.brainRoots, true)
  let parentRaw = ''
  let spawnedRefs: SpawnedSubagentRef[] = []
  if (parentTranscriptPath) {
    try {
      parentRaw = readFileSync(parentTranscriptPath, 'utf8')
      if (state.trackedByToolUseId.size > 0) {
        spawnedRefs = extractSpawnedSubagentsFromParentTranscript(parentRaw)
      }
    } catch {
      void 0
    }
  }

  syncTrackedSubagentEntries(state, spawnedRefs, now, MAX_TRACK_DURATION_MS)

  const bgSummary = parentRaw
    ? syncBackgroundTasks(
        state.bgTasks,
        parentRaw,
        now,
        MAX_TRACK_DURATION_MS,
        state.parentTurnEnded,
        state.emitEvent,
      )
    : {
        anyActiveNonDaemon: false,
        anyWakeupRequired: isEffectiveWakeupPending(state) && !state.subagentWakeupPending,
        minWakeupSpawnStepIndex: null,
        emittedCompletionFromTranscript: false,
        hasActiveIdleWatch: state.bgTasks.idleWatchStepIndex !== null,
      }

  if (bgSummary.emittedCompletionFromTranscript && state.parentTurnEnded) {
    state.unflushedWakeupReplay = true
  }
  if (
    bgSummary.minWakeupSpawnStepIndex !== null &&
    (state.activeWakeupMinSpawnStepIndex === null ||
      bgSummary.minWakeupSpawnStepIndex < state.activeWakeupMinSpawnStepIndex)
  ) {
    state.activeWakeupMinSpawnStepIndex = bgSummary.minWakeupSpawnStepIndex
  }

  const anyActiveSubagent = [...state.trackedByToolUseId.values()].some((e) => !e.completed)
  let anyActive = anyActiveSubagent || bgSummary.anyActiveNonDaemon
  const wakeupPending = state.subagentWakeupPending || bgSummary.anyWakeupRequired

  if (anyActive) {
    state.allWorkCompletedAtMs = null
  } else if ((state.trackedByToolUseId.size > 0 || wakeupPending) && state.allWorkCompletedAtMs === null) {
    state.allWorkCompletedAtMs = now
  }

  if (state.parentTurnEnded && !wakeupPending) {
    settleWakeupWaiters(state, 'completed')
  } else if (wakeupPending && state.parentTurnEnded) {
    const afterStepIndex =
      state.activeWakeupMinSpawnStepIndex ??
      (spawnedRefs.length > 0 ? spawnedRefs[spawnedRefs.length - 1]!.stepIndex : 0)
    const wakeup = extractParentWakeupProgress(parentRaw, afterStepIndex)
    if (emitWakeupProgressSteps(state, wakeup, state.wakeupMessageId, now)) {
      anyActive = true
    }

    if (!anyActive && wakeup.completed) {
      flushRemainingWakeupToolResults(state, wakeup, state.wakeupMessageId)
      settleWakeupWaiters(state, 'completed')
    } else if (!anyActive && state.allWorkCompletedAtMs !== null) {
      const elapsedSinceDone = now - state.allWorkCompletedAtMs
      if (!wakeup.sawSystemMessage && elapsedSinceDone >= state.noWakeupTimeoutMs) {
        settleWakeupWaiters(state, 'completed')
      } else if (wakeup.sawSystemMessage && elapsedSinceDone >= state.wakeupResponseTimeoutMs) {
        settleWakeupWaiters(state, 'completed')
      }
    }
  } else if (
    !wakeupPending &&
    !state.parentTurnEnded &&
    state.bgTasks.idleWatchStepIndex !== null &&
    state.idleHooks &&
    !state.idleHooks.isPromptActive() &&
    parentRaw
  ) {
    const idleWakeup = extractParentWakeupProgress(parentRaw, state.bgTasks.idleWatchStepIndex)
    const hasNewStepWork = idleWakeup.steps.some(
      (s) =>
        !state.emittedWakeupStepIndices.has(s.stepIndex) ||
        s.toolCalls.some(
          (tc) => tc.hasResult && !tc.resultPending && !state.emittedWakeupToolResultIds.has(tc.toolUseId),
        ),
    )
    if (hasNewStepWork) {
      const targetMsgId = state.idleWakeupMessageId ?? state.idleHooks.ensureMessage()
      state.idleWakeupMessageId = targetMsgId
      emitWakeupProgressSteps(state, idleWakeup, targetMsgId, now)
      if (idleWakeup.completed) {
        flushRemainingWakeupToolResults(state, idleWakeup, targetMsgId)
        const lastStep = idleWakeup.steps[idleWakeup.steps.length - 1]
        if (lastStep) state.bgTasks.idleWatchStepIndex = lastStep.stepIndex
        state.idleWakeupMessageId = null
        state.idleHooks.completeMessage()
      }
    }
  }

  ensurePollingTimer(state)
}

function desiredPollingIntervalMs(state: SessionSubagentState): number | null {
  const anyActiveSubagent = [...state.trackedByToolUseId.values()].some((e) => !e.completed)
  const anyActiveBg = [...state.bgTasks.tasksByToolUseId.values()].some(
    (e) => Boolean(e.taskId) && e.wakeupRequired && !e.completed,
  )
  const wakeupPending = isEffectiveWakeupPending(state)
  if (anyActiveSubagent || anyActiveBg || (wakeupPending && state.parentTurnEnded)) {
    return POLL_INTERVAL_MS
  }
  if (state.bgTasks.idleWatchStepIndex !== null && state.idleHooks) {
    return IDLE_POLL_INTERVAL_MS
  }
  return null
}

function ensurePollingTimer(state: SessionSubagentState): void {
  const desiredMs = desiredPollingIntervalMs(state)
  if (desiredMs === null) {
    if (state.timer) {
      clearInterval(state.timer)
      state.timer = null
      state.timerIntervalMs = 0
    }
    return
  }
  if (state.timer && state.timerIntervalMs === desiredMs) return
  if (state.timer) clearInterval(state.timer)
  state.timerIntervalMs = desiredMs
  state.timer = setInterval(() => {
    syncSessionSubagents(state)
  }, desiredMs)
  state.timer.unref?.()
}

function getOrCreateSessionState(
  parentSessionId: string,
  messageId: string,
  emitEvent: (event: AgentEvent) => void,
  customBrainRoots?: string[],
  idleHooks?: AntigravityIdleWakeupHooks,
): SessionSubagentState {
  let state = sessionStates.get(parentSessionId)
  if (!state) {
    state = {
      parentSessionId,
      brainRoots: customBrainRoots ?? resolveAntigravityBrainRoots(),
      emitEvent,
      ...(idleHooks ? { idleHooks } : {}),
      boundConversationIds: new Set(),
      trackedByToolUseId: new Map(),
      bgTasks: createBackgroundTaskTrackerState(),
      wakeupMessageId: messageId,
      idleWakeupMessageId: null,
      subagentWakeupPending: false,
      parentTurnEnded: false,
      activeWakeupMinSpawnStepIndex: null,
      allWorkCompletedAtMs: null,
      noWakeupTimeoutMs: DEFAULT_NO_WAKEUP_TIMEOUT_MS,
      wakeupResponseTimeoutMs: DEFAULT_WAKEUP_RESPONSE_TIMEOUT_MS,
      emittedWakeupStepIndices: new Set(),
      emittedWakeupToolResultIds: new Set(),
      unflushedWakeupReplay: false,
      wakeupWaiters: [],
      timer: null,
      timerIntervalMs: 0,
    }
    sessionStates.set(parentSessionId, state)
    return state
  }
  if (!state.parentTurnEnded && state.wakeupMessageId !== messageId) {
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

export function hasPendingAntigravitySubagentWakeup(parentSessionId: string): boolean {
  const state = sessionStates.get(parentSessionId)
  if (!state) return false
  syncSessionSubagents(state)
  const anyActiveSubagent = [...state.trackedByToolUseId.values()].some((e) => !e.completed)
  return anyActiveSubagent || isEffectiveWakeupPending(state)
}

export function waitForAntigravitySubagentWakeup(
  parentSessionId: string,
  opts?: { noWakeupTimeoutMs?: number; wakeupResponseTimeoutMs?: number },
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
    entry.completed = true
  }
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
    state.timerIntervalMs = 0
  }
  settleWakeupWaiters(state, 'cancelled')
  return hadWaiters
}

export function hasUnflushedAntigravityWakeupReplay(parentSessionId: string): boolean {
  return sessionStates.get(parentSessionId)?.unflushedWakeupReplay === true
}

export function clearUnflushedAntigravityWakeupReplay(parentSessionId: string): void {
  const state = sessionStates.get(parentSessionId)
  if (state) state.unflushedWakeupReplay = false
}

export function disposeAntigravitySubagentTracker(parentSessionId?: string): void {
  if (parentSessionId) {
    const state = sessionStates.get(parentSessionId)
    if (state) {
      if (state.timer) clearInterval(state.timer)
      disposeBackgroundTaskTracker(state.bgTasks)
      settleWakeupWaiters(state, 'cancelled')
    }
    sessionStates.delete(parentSessionId)
    return
  }
  for (const state of sessionStates.values()) {
    if (state.timer) clearInterval(state.timer)
    disposeBackgroundTaskTracker(state.bgTasks)
    settleWakeupWaiters(state, 'cancelled')
  }
  sessionStates.clear()
}
