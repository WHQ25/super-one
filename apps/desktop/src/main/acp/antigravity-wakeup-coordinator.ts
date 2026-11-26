import { readFileSync } from 'node:fs'
import type { AgentEvent, PermissionMode } from '@superone/shared/agent-types'
import {
  clearSettledWakeupBackgroundTasks,
  reconcileForegroundCompletedBackgroundTasks,
  syncBackgroundTasks,
  type BackgroundTaskTrackerState,
} from './antigravity-background-task'
import { resolveAntigravityForegroundEndStepIndex } from './antigravity-background-task-transcript'
import {
  extractParentSubagentTranscriptState,
  extractParentWakeupProgress,
  type ParentWakeupProgress,
  type SpawnedSubagentRef,
} from './antigravity-subagent-transcript'
import {
  emitWakeupProgressSteps,
  findAntigravityTranscriptPath,
  flushRemainingWakeupToolResults,
  resolveWakeupStallTimeoutMs,
  settleUnboundSwarmWorkersOnWakeup,
  syncTrackedSubagentEntries,
  type TrackedSubagent,
  type WakeupEmitContext,
} from './antigravity-wakeup-emitter'
import { hasUnreadAntigravityWakeupInboxMessage } from './antigravity-wakeup-inbox'

const POLL_INTERVAL_MS = 250
const IDLE_POLL_INTERVAL_MS = 1_000

export interface AntigravityIdleWakeupHooks {
  isPromptActive: () => boolean
  ensureMessage: () => string
  completeMessage: () => void
  permissionProfile?: () => 'standard' | 'auto' | 'bypass'
  permissionMode?: () => PermissionMode
  resumeInteractionStream?: (messageId: string) => boolean
}

export interface SessionSubagentState extends WakeupEmitContext {
  parentSessionId: string
  idleHooks?: AntigravityIdleWakeupHooks
  bgTasks: BackgroundTaskTrackerState
  wakeupMessageId: string
  idleWakeupMessageId: string | null
  backgroundWatch: boolean
  parentTurnEnded: boolean
  foregroundEndStepIndex: number | null
  lastParentRawLength: number
  lastWakeupActivityAtMs: number | null
  resumedInteractionStepIndex: number | null
  awaitingToolSinceMs: number | null
  noWakeupTimeoutMs: number
  wakeupResponseTimeoutMs: number
  interactionStallTimeoutMs: number
  hasExplicitStallTimeout: boolean
  wakeupWaiters: Array<(outcome: 'completed' | 'cancelled') => void>
  timer: ReturnType<typeof setInterval> | null
  timerIntervalMs: number
  boundConversationIds: Set<string>
  trackedByToolUseId: Map<string, TrackedSubagent>
  emitEvent: (event: AgentEvent) => void
}

export function isEffectiveWakeupPending(state: SessionSubagentState): boolean {
  if (state.subagentWakeupPending) return true
  for (const entry of state.bgTasks.tasksByToolUseId.values()) {
    if (entry.wakeupRequired) return true
  }
  return false
}

export function settleWakeupWaiters(
  state: SessionSubagentState,
  outcome: 'completed' | 'cancelled',
): void {
  state.subagentWakeupPending = false
  for (const entry of state.trackedByToolUseId.values()) {
    if (entry.completed) entry.wakeupRequired = false
  }
  state.backgroundWatch = false
  state.parentTurnEnded = false
  state.foregroundEndStepIndex = null
  state.activeWakeupMinSpawnStepIndex = null
  state.allWorkCompletedAtMs = null
  state.lastWakeupActivityAtMs = null
  state.resumedInteractionStepIndex = null
  state.awaitingToolSinceMs = null
  state.hasExplicitStallTimeout = false
  state.wireWakeupStreamed = false
  clearSettledWakeupBackgroundTasks(state.bgTasks, state.emitEvent, state.brainRoots)
  const waiters = state.wakeupWaiters.splice(0, state.wakeupWaiters.length)
  for (const resolve of waiters) {
    resolve(outcome)
  }
}

function releaseForegroundForBackgroundWatch(state: SessionSubagentState): void {
  state.idleWakeupMessageId = null
  if (state.foregroundEndStepIndex !== null) {
    if (
      state.bgTasks.idleWatchStepIndex === null ||
      state.foregroundEndStepIndex > state.bgTasks.idleWatchStepIndex
    ) {
      state.bgTasks.idleWatchStepIndex = state.foregroundEndStepIndex
    }
    state.foregroundEndStepIndex = null
  } else {
    const step = state.bgTasks.idleWatchStepIndex ?? state.activeWakeupMinSpawnStepIndex
    if (
      typeof step === 'number' &&
      (state.bgTasks.idleWatchStepIndex === null || step < state.bgTasks.idleWatchStepIndex)
    ) {
      state.bgTasks.idleWatchStepIndex = step
    }
  }
  state.backgroundWatch = true
  state.parentTurnEnded = false
  const waiters = state.wakeupWaiters.splice(0, state.wakeupWaiters.length)
  for (const resolve of waiters) resolve('completed')
}

function wakeupHasUnseenSteps(
  state: SessionSubagentState,
  wakeup: ParentWakeupProgress,
): boolean {
  return wakeup.steps.some(
    (step) =>
      !state.emittedWakeupStepIndices.has(step.stepIndex) ||
      step.toolCalls.some(
        (call) =>
          (call.hasResult && !call.resultPending && !state.emittedWakeupToolResultIds.has(call.toolUseId)) ||
          (Boolean(call.resultPending) && !state.emittedWakeupToolUseIds.has(call.toolUseId)),
      ),
  )
}

function tryResumeWakeupInteraction(
  state: SessionSubagentState,
  hooks: AntigravityIdleWakeupHooks,
  pendingStepIdx: number,
): boolean {
  if (!hooks.resumeInteractionStream || state.resumedInteractionStepIndex === pendingStepIdx) return false
  const targetMsgId = state.idleWakeupMessageId ?? hooks.ensureMessage()
  state.idleWakeupMessageId = targetMsgId
  state.resumedInteractionStepIndex = pendingStepIdx
  return hooks.resumeInteractionStream(targetMsgId)
}

function emitBackgroundWatch(
  state: SessionSubagentState,
  parentRaw: string,
  now: number,
  anyActive: boolean,
  hasUnreadInbox: boolean,
): void {
  const hooks = state.idleHooks
  if (!hooks) return
  const afterStepIndex = state.bgTasks.idleWatchStepIndex ?? state.activeWakeupMinSpawnStepIndex ?? 0
  const wakeup = extractParentWakeupProgress(parentRaw, afterStepIndex)
  let stillRunning = anyActive
  if (wakeupHasUnseenSteps(state, wakeup)) {
    state.lastWakeupActivityAtMs = now
    const targetMsgId = state.idleWakeupMessageId ?? hooks.ensureMessage()
    state.idleWakeupMessageId = targetMsgId
    if (emitWakeupProgressSteps(state, wakeup, targetMsgId, now)) stillRunning = true
  }
  if (wakeup.awaitingToolExecution) {
    if (!state.wireWakeupStreamed) {
      state.unflushedWakeupReplay = true
      state.stalledWakeupToolReplay = true
      state.unlockedPostStallStream = false
    }
    if (state.awaitingToolSinceMs === null) state.awaitingToolSinceMs = now
    if (!stillRunning) {
      const isAskQuestion =
        wakeup.pendingToolRawName === 'ask_question' ||
        wakeup.pendingToolName === 'AskUserQuestion'
      const pendingStepIdx = wakeup.steps[wakeup.steps.length - 1]?.stepIndex ?? -1
      if (isAskQuestion && tryResumeWakeupInteraction(state, hooks, pendingStepIdx)) return
      const stallMs = resolveWakeupStallTimeoutMs(
        wakeup,
        hooks.permissionProfile?.() ?? 'standard',
        state.interactionStallTimeoutMs,
        state.wakeupResponseTimeoutMs,
        state.hasExplicitStallTimeout,
        hooks.permissionMode?.(),
      )
      if (now - state.awaitingToolSinceMs >= stallMs) {
        if (!state.hasExplicitStallTimeout && tryResumeWakeupInteraction(state, hooks, pendingStepIdx)) return
        if (state.idleWakeupMessageId) hooks.completeMessage()
        state.idleWakeupMessageId = null
        settleWakeupWaiters(state, 'completed')
      }
    }
    return
  }
  state.awaitingToolSinceMs = null
  state.resumedInteractionStepIndex = null
  state.stalledWakeupToolReplay = false

  if (stillRunning || hasUnreadInbox) {
    if (wakeup.completed && state.idleWakeupMessageId) {
      const targetMsgId = state.idleWakeupMessageId
      if (!state.wireWakeupStreamed) flushRemainingWakeupToolResults(state, wakeup, targetMsgId)
      const lastStep = wakeup.steps[wakeup.steps.length - 1]
      if (lastStep) state.bgTasks.idleWatchStepIndex = lastStep.stepIndex
      state.idleWakeupMessageId = null
      hooks.completeMessage()
    }
    return
  }

  const elapsedSinceDone = state.allWorkCompletedAtMs === null ? 0 : now - state.allWorkCompletedAtMs
  const activityAnchor = state.lastWakeupActivityAtMs ?? state.allWorkCompletedAtMs
  const elapsedSinceActivity = activityAnchor === null ? 0 : now - activityAnchor
  const noWakeupTimedOut = !wakeup.sawSystemMessage && !hasUnreadInbox && elapsedSinceDone >= state.noWakeupTimeoutMs
  const plannerStalled =
    wakeup.sawSystemMessage &&
    !wakeup.completed &&
    elapsedSinceActivity >= state.wakeupResponseTimeoutMs
  if (!wakeup.completed && !plannerStalled && !noWakeupTimedOut) return
  const targetMsgId = state.idleWakeupMessageId
  if (targetMsgId && !state.wireWakeupStreamed) {
    flushRemainingWakeupToolResults(state, wakeup, targetMsgId)
  }
  if (wakeup.completed) {
    const lastStep = wakeup.steps[wakeup.steps.length - 1]
    if (lastStep) state.bgTasks.idleWatchStepIndex = lastStep.stepIndex
  } else if (plannerStalled) {
    state.unflushedWakeupReplay = true
    state.stalledWakeupToolReplay = true
    state.unlockedPostStallStream = false
  }
  state.idleWakeupMessageId = null
  if (targetMsgId) hooks.completeMessage()
  settleWakeupWaiters(state, 'completed')
}

export function syncSessionSubagents(state: SessionSubagentState): void {
  const now = Date.now()
  if (state.idleHooks?.isPromptActive()) {
    state.idleWakeupMessageId = null
  }
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

  if (parentRaw.length > 0 && parentRaw.length !== state.lastParentRawLength) {
    state.lastParentRawLength = parentRaw.length
    state.lastWakeupActivityAtMs = now
  }

  syncTrackedSubagentEntries(state, spawnedRefs, now, {
    ...(killedAllAtStepIndex !== undefined ? { killedAllAtStepIndex } : {}),
    ...(killedSwarmNames ? { killedSwarmNames } : {}),
  })
  const swarmAfterStep =
    state.foregroundEndStepIndex ??
    state.bgTasks.idleWatchStepIndex ??
    state.activeWakeupMinSpawnStepIndex ??
    0
  settleUnboundSwarmWorkersOnWakeup(state, parentRaw, swarmAfterStep, now)

  const hasUnreadInbox = hasUnreadAntigravityWakeupInboxMessage(state.parentSessionId, state.brainRoots)
  const anyActiveSubagentBefore = [...state.trackedByToolUseId.values()].some((e) => !e.completed)
  const bgSummary = parentRaw
    ? syncBackgroundTasks(state.bgTasks, parentRaw, state.parentTurnEnded, state.emitEvent, {
        fallbackMessageId: state.idleWakeupMessageId ?? state.wakeupMessageId,
        keepIdleWatch: state.backgroundWatch || state.parentTurnEnded || anyActiveSubagentBefore || hasUnreadInbox,
        brainRoots: state.brainRoots,
      })
    : {
        anyActiveNonDaemon: false,
        anyWakeupRequired: isEffectiveWakeupPending(state) && !state.subagentWakeupPending,
        minWakeupSpawnStepIndex: null,
        emittedCompletionFromTranscript: false,
        emittedCompletedToolUseIds: [] as string[],
        hasActiveIdleWatch: state.bgTasks.idleWatchStepIndex !== null,
      }

  if (bgSummary.emittedCompletionFromTranscript) {
    state.lastWakeupActivityAtMs = now
    if (state.parentTurnEnded && !state.wireWakeupStreamed) state.unflushedWakeupReplay = true
    for (const id of bgSummary.emittedCompletedToolUseIds) {
      state.emittedWakeupToolUseIds.add(id)
      state.emittedWakeupToolResultIds.add(id)
      if (state.parentTurnEnded || state.backgroundWatch) {
        state.replayedBackgroundToolIds.add(id)
      }
    }
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
    state.lastWakeupActivityAtMs = null
  } else if ((state.trackedByToolUseId.size > 0 || wakeupPending || state.backgroundWatch) && state.allWorkCompletedAtMs === null) {
    state.allWorkCompletedAtMs = now
    if (state.lastWakeupActivityAtMs === null) state.lastWakeupActivityAtMs = now
  }

  if (
    wakeupPending &&
    anyActive &&
    state.idleHooks &&
    (state.parentTurnEnded || (!state.backgroundWatch && !state.idleHooks.isPromptActive()))
  ) {
    releaseForegroundForBackgroundWatch(state)
  }

  if (
    state.backgroundWatch &&
    !state.parentTurnEnded &&
    state.idleHooks &&
    !state.idleHooks.isPromptActive() &&
    parentRaw
  ) {
    emitBackgroundWatch(state, parentRaw, now, anyActive, hasUnreadInbox)
  } else if (state.parentTurnEnded && !wakeupPending && !hasUnreadInbox) {
    settleWakeupWaiters(state, 'completed')
  } else if ((wakeupPending || hasUnreadInbox) && state.parentTurnEnded) {
    const afterStepIndex =
      state.foregroundEndStepIndex ??
      state.activeWakeupMinSpawnStepIndex ??
      (spawnedRefs.length > 0 ? spawnedRefs[spawnedRefs.length - 1]!.stepIndex : 0)
    const wakeup = extractParentWakeupProgress(parentRaw, afterStepIndex)
    if (emitWakeupProgressSteps(state, wakeup, state.wakeupMessageId, now)) {
      anyActive = true
    }

    if (!anyActive && !hasUnreadInbox && wakeup.completed) {
      state.stalledWakeupToolReplay = false
      flushRemainingWakeupToolResults(state, wakeup, state.wakeupMessageId)
      settleWakeupWaiters(state, 'completed')
    } else if (!anyActive && wakeup.awaitingToolExecution) {
      if (state.awaitingToolSinceMs === null) state.awaitingToolSinceMs = now
      const stallMs = resolveWakeupStallTimeoutMs(
        wakeup,
        state.idleHooks?.permissionProfile?.() ?? 'standard',
        state.interactionStallTimeoutMs,
        state.wakeupResponseTimeoutMs,
        state.hasExplicitStallTimeout,
        state.idleHooks?.permissionMode?.(),
      )
      if (now - state.awaitingToolSinceMs >= stallMs) {
        state.unflushedWakeupReplay = true
        state.stalledWakeupToolReplay = true
        state.unlockedPostStallStream = false
        settleWakeupWaiters(state, 'completed')
      }
    } else {
      state.awaitingToolSinceMs = null
      if (!anyActive && state.allWorkCompletedAtMs !== null) {
        const elapsedSinceDone = now - state.allWorkCompletedAtMs
        const activityAnchor = state.lastWakeupActivityAtMs ?? state.allWorkCompletedAtMs
        const elapsedSinceActivity = now - activityAnchor
        if (!wakeup.sawSystemMessage && !hasUnreadInbox && elapsedSinceDone >= state.noWakeupTimeoutMs) {
          settleWakeupWaiters(state, 'completed')
        } else if (wakeup.sawSystemMessage && elapsedSinceActivity >= state.wakeupResponseTimeoutMs) {
          settleWakeupWaiters(state, 'completed')
        }
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
    if (wakeupHasUnseenSteps(state, idleWakeup)) {
      const targetMsgId = state.idleWakeupMessageId ?? state.idleHooks.ensureMessage()
      state.idleWakeupMessageId = targetMsgId
      emitWakeupProgressSteps(state, idleWakeup, targetMsgId, now)
      if (idleWakeup.completed) {
        state.stalledWakeupToolReplay = false
        flushRemainingWakeupToolResults(state, idleWakeup, targetMsgId)
        const lastStep = idleWakeup.steps[idleWakeup.steps.length - 1]
        if (lastStep) state.bgTasks.idleWatchStepIndex = lastStep.stepIndex
        state.idleWakeupMessageId = null
        state.idleHooks.completeMessage()
      }
    }
  }

  ensurePollingTimer(state, hasUnreadInbox)
}

export function noteForegroundTurnEndedOnState(state: SessionSubagentState): void {
  state.idleWakeupMessageId = null
  state.wireWakeupStreamed = false
  const parentTranscriptPath = findAntigravityTranscriptPath(state.parentSessionId, state.brainRoots, true)
  if (!parentTranscriptPath) return
  let parentRaw = ''
  try {
    parentRaw = readFileSync(parentTranscriptPath, 'utf8')
  } catch {
    return
  }
  if (!parentRaw) return
  const anyActiveSubagent = [...state.trackedByToolUseId.values()].some((e) => !e.completed)
  const hasUnreadInbox = hasUnreadAntigravityWakeupInboxMessage(state.parentSessionId, state.brainRoots)
  syncBackgroundTasks(state.bgTasks, parentRaw, false, state.emitEvent, {
    fallbackMessageId: state.wakeupMessageId,
    keepIdleWatch: state.backgroundWatch || anyActiveSubagent || hasUnreadInbox,
    brainRoots: state.brainRoots,
  })
  const endStep = resolveAntigravityForegroundEndStepIndex(parentRaw)
  if (endStep !== null) {
    state.foregroundEndStepIndex = endStep
    reconcileForegroundCompletedBackgroundTasks(state.bgTasks, endStep)
    if (state.bgTasks.idleWatchStepIndex === null || endStep > state.bgTasks.idleWatchStepIndex) {
      state.bgTasks.idleWatchStepIndex = endStep
    }
  }
}

function desiredPollingIntervalMs(state: SessionSubagentState, hasUnreadInbox = false): number | null {
  const anyActiveSubagent = [...state.trackedByToolUseId.values()].some((e) => !e.completed)
  const anyActiveBg = [...state.bgTasks.tasksByToolUseId.values()].some(
    (e) => (Boolean(e.taskId) && e.wakeupRequired && !e.completed) || (!e.completed && e.toolName === 'Workflow'),
  )
  const wakeupPending = isEffectiveWakeupPending(state)
  if (
    state.backgroundWatch ||
    anyActiveSubagent ||
    anyActiveBg ||
    (wakeupPending && state.parentTurnEnded) ||
    (hasUnreadInbox && (state.parentTurnEnded || state.idleHooks !== undefined))
  ) {
    return POLL_INTERVAL_MS
  }
  if (state.bgTasks.idleWatchStepIndex !== null && state.idleHooks) {
    return IDLE_POLL_INTERVAL_MS
  }
  return null
}

export function stopPollingTimer(state: SessionSubagentState): void {
  if (!state.timer) return
  clearInterval(state.timer)
  state.timer = null
  state.timerIntervalMs = 0
}

export function ensurePollingTimer(state: SessionSubagentState, hasUnreadInbox = false): void {
  const desiredMs = desiredPollingIntervalMs(state, hasUnreadInbox)
  if (desiredMs === null) {
    stopPollingTimer(state)
    return
  }
  if (state.timer && state.timerIntervalMs === desiredMs) return
  if (state.timer) clearInterval(state.timer)
  state.timerIntervalMs = desiredMs
  state.timer = setInterval(() => syncSessionSubagents(state), desiredMs)
  state.timer.unref?.()
}
