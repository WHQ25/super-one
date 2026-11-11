import type { AgentEvent } from '@superone/shared/agent-types'
import { unwatchBashOutput, watchBashOutput } from '../bash-output-watcher'
import {
  extractBackgroundTaskLaunchFromText,
  extractCompletedBackgroundTasksFromTranscript,
  extractSpawnedBackgroundTasksFromTranscript,
} from './antigravity-background-task-transcript'
import { extractParentWakeupProgress } from './antigravity-wakeup-transcript'

export interface TrackedBackgroundTask {
  toolUseId: string
  messageId: string
  toolName: string
  rawInputJson: string
  toolSummary?: string
  command?: string
  description: string
  isDaemon: boolean
  startedAtMs: number
  taskId?: string
  spawnStepIndex?: number
  logFile?: string
  watchingLog: boolean
  emittedTaskStarted: boolean
  wireCompleted: boolean
  completed: boolean
  wakeupRequired: boolean
}

export interface BackgroundTaskTrackerState {
  boundTaskIds: Set<string>
  tasksByToolUseId: Map<string, TrackedBackgroundTask>
  idleWatchStepIndex: number | null
}

export interface BackgroundTaskSyncSummary {
  anyActiveNonDaemon: boolean
  anyWakeupRequired: boolean
  minWakeupSpawnStepIndex: number | null
  emittedCompletionFromTranscript: boolean
  hasActiveIdleWatch: boolean
}

export function createBackgroundTaskTrackerState(): BackgroundTaskTrackerState {
  return {
    boundTaskIds: new Set(),
    tasksByToolUseId: new Map(),
    idleWatchStepIndex: null,
  }
}

function isTrackedBackgroundCandidateTool(toolName: string): boolean {
  return toolName === 'Bash' || toolName.toLowerCase() === 'schedule'
}

export function noteBackgroundTaskMappedEvents(
  tracker: BackgroundTaskTrackerState,
  messageId: string,
  mappedEvents: ReadonlyArray<AgentEvent>,
  emitEvent: (event: AgentEvent) => void,
): boolean {
  let touched = false
  for (const event of mappedEvents) {
    if (event.type !== 'content_delta') continue

    if (event.delta.type === 'tool_use') {
      if (!isTrackedBackgroundCandidateTool(event.delta.toolName)) continue
      touched = true
      let command: string | undefined
      let description = event.delta.toolSummary || event.delta.toolName
      let isDaemon = false
      try {
        const parsed = JSON.parse(event.delta.input) as Record<string, unknown>
        if (typeof parsed.command === 'string' && parsed.command.trim()) {
          command = parsed.command.trim()
        } else if (typeof parsed.CommandLine === 'string' && parsed.CommandLine.trim()) {
          command = parsed.CommandLine.trim()
        }
        if (typeof parsed.description === 'string' && parsed.description.trim()) {
          description = parsed.description.trim()
        } else if (typeof parsed.Prompt === 'string' && parsed.Prompt.trim()) {
          description = parsed.Prompt.trim().slice(0, 120)
        } else if (command) {
          description = command.slice(0, 120)
        }
        isDaemon =
          parsed.run_in_background === true ||
          parsed.IsDaemon === true ||
          parsed.is_daemon === true
      } catch {
        void 0
      }

      const existing = tracker.tasksByToolUseId.get(event.delta.toolUseId)
      if (!existing) {
        tracker.tasksByToolUseId.set(event.delta.toolUseId, {
          toolUseId: event.delta.toolUseId,
          messageId,
          toolName: event.delta.toolName,
          rawInputJson: event.delta.input,
          ...(event.delta.toolSummary ? { toolSummary: event.delta.toolSummary } : {}),
          ...(command ? { command } : {}),
          description,
          isDaemon,
          startedAtMs: Date.now(),
          watchingLog: false,
          emittedTaskStarted: false,
          wireCompleted: false,
          completed: false,
          wakeupRequired: false,
        })
      } else {
        existing.rawInputJson = event.delta.input
        if (event.delta.toolSummary) existing.toolSummary = event.delta.toolSummary
        if (command) existing.command = command
        if (description) existing.description = description
        if (isDaemon) existing.isDaemon = true
      }
      continue
    }

    if (event.delta.type === 'tool_result') {
      const entry = tracker.tasksByToolUseId.get(event.delta.toolUseId)
      if (!entry) continue
      touched = true
      const launch = extractBackgroundTaskLaunchFromText(event.delta.summary ?? '')
      if (launch) {
        entry.taskId = launch.taskId
        tracker.boundTaskIds.add(launch.taskId)
        if (launch.logFile) entry.logFile = launch.logFile
        if (entry.isDaemon) {
          entry.completed = true
          entry.wakeupRequired = false
        } else {
          entry.wakeupRequired = true
          entry.wireCompleted = false
          entry.completed = false
        }
        continue
      }

      if (entry.toolName.toLowerCase() === 'schedule' && !entry.isDaemon) {
        entry.wireCompleted = true
        continue
      }

      entry.wireCompleted = true
      entry.completed = true
      entry.wakeupRequired = false
      if (entry.watchingLog) {
        unwatchBashOutput(entry.toolUseId)
        entry.watchingLog = false
      }
      if (entry.emittedTaskStarted && entry.taskId) {
        emitEvent({
          type: 'task_notification',
          toolUseId: entry.toolUseId,
          taskId: entry.taskId,
          taskStatus: event.delta.isError ? 'failed' : 'completed',
          outputFile: entry.logFile ?? '',
          summary: entry.description,
        })
      }
    }
  }
  return touched
}

export function syncBackgroundTasks(
  tracker: BackgroundTaskTrackerState,
  parentRaw: string,
  now: number,
  maxTrackDurationMs: number,
  parentTurnEnded: boolean,
  emitEvent: (event: AgentEvent) => void,
): BackgroundTaskSyncSummary {
  const { lastUserStepIndex, tasks: spawnedTasks } = extractSpawnedBackgroundTasksFromTranscript(parentRaw)
  const completedMap = extractCompletedBackgroundTasksFromTranscript(parentRaw, lastUserStepIndex)
  let emittedCompletionFromTranscript = false

  for (const ref of spawnedTasks) {
    if (ref.isDaemon && !ref.cancelledInTurn && !completedMap.has(ref.taskId)) {
      if (tracker.idleWatchStepIndex === null || ref.stepIndex < tracker.idleWatchStepIndex) {
        tracker.idleWatchStepIndex = ref.stepIndex
      }
    }
  }

  const currentTurnTasks = spawnedTasks.filter(
    (ref) => ref.stepIndex > lastUserStepIndex && !tracker.boundTaskIds.has(ref.taskId),
  )

  for (const entry of tracker.tasksByToolUseId.values()) {
    if (entry.completed && !entry.wakeupRequired) continue
    if (entry.taskId) continue
    const isSchedule = entry.toolName.toLowerCase() === 'schedule'
    if (entry.wireCompleted && !isSchedule) continue

    const expectedRawTool = isSchedule ? 'schedule' : 'run_command'
    let matchIdx = currentTurnTasks.findIndex(
      (ref) =>
        ref.toolName === expectedRawTool &&
        (!entry.command || !ref.command || entry.command === ref.command),
    )
    if (matchIdx < 0) {
      matchIdx = currentTurnTasks.findIndex((ref) => ref.toolName === expectedRawTool)
    }
    if (matchIdx < 0) continue

    const [match] = currentTurnTasks.splice(matchIdx, 1)
    if (!match) continue

    tracker.boundTaskIds.add(match.taskId)
    entry.taskId = match.taskId
    entry.spawnStepIndex = match.stepIndex
    if (match.logFile) entry.logFile = match.logFile
    if (match.isDaemon) entry.isDaemon = true

    if (match.cancelledInTurn) {
      entry.completed = true
      entry.wakeupRequired = false
      continue
    }

    if (entry.isDaemon) {
      entry.completed = true
      entry.wakeupRequired = false
      if (tracker.idleWatchStepIndex === null || match.stepIndex < tracker.idleWatchStepIndex) {
        tracker.idleWatchStepIndex = match.stepIndex
      }
      continue
    }

    if (isSchedule && completedMap.has(match.taskId) && !parentTurnEnded) {
      const preCheck = extractParentWakeupProgress(parentRaw, match.stepIndex)
      if (preCheck.completed) {
        entry.completed = true
        entry.wakeupRequired = false
        continue
      }
    }

    entry.wakeupRequired = true
    if (entry.toolName === 'Bash' && !entry.emittedTaskStarted) {
      entry.emittedTaskStarted = true
      emitEvent({
        type: 'task_started',
        taskType: 'local_bash',
        toolUseId: entry.toolUseId,
        taskId: entry.taskId,
        description: entry.description,
        ...(entry.logFile ? { outputFile: entry.logFile } : {}),
        isBackgrounded: true,
      })
    }
    if (entry.toolName === 'Bash' && entry.logFile && !entry.watchingLog) {
      entry.watchingLog = true
      watchBashOutput(entry.toolUseId, entry.logFile)
    }
  }

  for (const entry of tracker.tasksByToolUseId.values()) {
    if (!entry.taskId || entry.completed) continue
    if (now - entry.startedAtMs > maxTrackDurationMs) {
      if (entry.watchingLog) {
        unwatchBashOutput(entry.toolUseId)
        entry.watchingLog = false
      }
      entry.completed = true
      continue
    }

    const completedResult = completedMap.get(entry.taskId)
    if (!completedResult) continue

    entry.completed = true
    if (entry.watchingLog) {
      unwatchBashOutput(entry.toolUseId)
      entry.watchingLog = false
    }
    if (completedResult.priority === 'low') {
      entry.wakeupRequired = false
    }
    if (!entry.wireCompleted && entry.toolName === 'Bash') {
      emittedCompletionFromTranscript = true
      emitEvent({
        type: 'content_delta',
        messageId: entry.messageId,
        delta: {
          type: 'tool_use',
          toolUseId: entry.toolUseId,
          toolName: entry.toolName,
          input: entry.rawInputJson,
          status: 'complete',
          ...(entry.toolSummary ? { toolSummary: entry.toolSummary } : {}),
        },
      })
      emitEvent({
        type: 'content_delta',
        messageId: entry.messageId,
        delta: {
          type: 'tool_result',
          toolUseId: entry.toolUseId,
          summary: completedResult.outputSummary,
          ...(entry.logFile ? { outputPath: entry.logFile } : {}),
          isError: completedResult.isError,
        },
      })
    }
    if (entry.emittedTaskStarted) {
      emitEvent({
        type: 'task_notification',
        toolUseId: entry.toolUseId,
        taskId: entry.taskId,
        taskStatus: completedResult.isError ? 'failed' : 'completed',
        outputFile: entry.logFile ?? '',
        summary: entry.description,
      })
    }
  }

  let anyActiveNonDaemon = false
  let anyWakeupRequired = false
  let minWakeupSpawnStepIndex: number | null = null

  for (const entry of tracker.tasksByToolUseId.values()) {
    if (!entry.wakeupRequired) continue
    anyWakeupRequired = true
    if (!entry.completed) {
      anyActiveNonDaemon = true
    }
    if (
      typeof entry.spawnStepIndex === 'number' &&
      (minWakeupSpawnStepIndex === null || entry.spawnStepIndex < minWakeupSpawnStepIndex)
    ) {
      minWakeupSpawnStepIndex = entry.spawnStepIndex
    }
  }

  const hasActiveDaemonInTranscript = spawnedTasks.some(
    (ref) => ref.isDaemon && !ref.cancelledInTurn && !completedMap.has(ref.taskId),
  )
  if (!hasActiveDaemonInTranscript && tracker.idleWatchStepIndex !== null) {
    const idleCheck = extractParentWakeupProgress(parentRaw, tracker.idleWatchStepIndex)
    if (!idleCheck.sawSystemMessage) {
      tracker.idleWatchStepIndex = null
    }
  }

  return {
    anyActiveNonDaemon,
    anyWakeupRequired,
    minWakeupSpawnStepIndex,
    emittedCompletionFromTranscript,
    hasActiveIdleWatch: tracker.idleWatchStepIndex !== null,
  }
}

export function clearSettledWakeupBackgroundTasks(tracker: BackgroundTaskTrackerState): void {
  for (const entry of tracker.tasksByToolUseId.values()) {
    if (entry.watchingLog) {
      unwatchBashOutput(entry.toolUseId)
      entry.watchingLog = false
    }
    entry.completed = true
    entry.wakeupRequired = false
  }
}

export function pruneStaleUnboundBackgroundTasks(tracker: BackgroundTaskTrackerState): void {
  for (const [id, entry] of tracker.tasksByToolUseId.entries()) {
    if (!entry.taskId && !entry.wakeupRequired) {
      if (entry.watchingLog) unwatchBashOutput(entry.toolUseId)
      tracker.tasksByToolUseId.delete(id)
    }
  }
}

export function disposeBackgroundTaskTracker(tracker: BackgroundTaskTrackerState): void {
  for (const entry of tracker.tasksByToolUseId.values()) {
    if (entry.watchingLog) {
      unwatchBashOutput(entry.toolUseId)
      entry.watchingLog = false
    }
  }
  tracker.tasksByToolUseId.clear()
  tracker.boundTaskIds.clear()
  tracker.idleWatchStepIndex = null
}
