import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent } from '@superone/shared/agent-types'
import { isSubagentToolName } from '@superone/shared/tool-ui'
import { resolveAntigravityBrainRoots } from './antigravity-profile'
import {
  extractParentWakeupProgress,
  extractSpawnedSubagentsFromParentTranscript,
  parseAntigravitySubagentTranscript,
  type SpawnedSubagentRef,
} from './antigravity-subagent-transcript'

export * from './antigravity-subagent-transcript'

const POLL_INTERVAL_MS = 250
const MAX_TRACK_DURATION_MS = 10 * 60 * 1000
const DEFAULT_NO_WAKEUP_TIMEOUT_MS = 5_000
const DEFAULT_WAKEUP_RESPONSE_TIMEOUT_MS = 120_000

interface TrackedSubagent {
  toolUseId: string
  messageId: string
  description: string
  startedAtMs: number
  conversationId?: string
  outputFile?: string
  spawnStepIndex?: number
  lastRawLength: number
  emittedSavedImages?: boolean
  completed: boolean
}

interface SessionSubagentState {
  parentSessionId: string
  brainRoots: string[]
  emitEvent: (event: AgentEvent) => void
  boundConversationIds: Set<string>
  trackedByToolUseId: Map<string, TrackedSubagent>
  wakeupMessageId: string
  wakeupPending: boolean
  parentTurnEnded: boolean
  activeWakeupMinSpawnStepIndex: number | null
  allSubagentsCompletedAtMs: number | null
  noWakeupTimeoutMs: number
  wakeupResponseTimeoutMs: number
  emittedWakeupStepIndices: Set<number>
  unflushedWakeupReplay: boolean
  wakeupWaiters: Array<(outcome: 'completed' | 'cancelled') => void>
  timer: ReturnType<typeof setInterval> | null
}

const sessionStates = new Map<string, SessionSubagentState>()

function findTranscriptPath(sessionId: string, brainRoots: string[], preferFull = false): string | null {
  const filenames = preferFull ? ['transcript_full.jsonl', 'transcript.jsonl'] : ['transcript.jsonl', 'transcript_full.jsonl']
  for (const root of brainRoots) {
    for (const filename of filenames) {
      const candidate = join(root, sessionId, '.system_generated', 'logs', filename)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function settleWakeupWaiters(state: SessionSubagentState, outcome: 'completed' | 'cancelled'): void {
  state.wakeupPending = false
  state.parentTurnEnded = false
  state.allSubagentsCompletedAtMs = null
  const waiters = state.wakeupWaiters.splice(0, state.wakeupWaiters.length)
  for (const resolve of waiters) {
    resolve(outcome)
  }
}

function syncSessionSubagents(state: SessionSubagentState): void {
  const now = Date.now()
  const parentTranscriptPath = findTranscriptPath(state.parentSessionId, state.brainRoots, true)
  let parentRaw = ''
  let spawnedRefs: SpawnedSubagentRef[] = []
  if (parentTranscriptPath) {
    try {
      parentRaw = readFileSync(parentTranscriptPath, 'utf8')
      spawnedRefs = extractSpawnedSubagentsFromParentTranscript(parentRaw)
    } catch {
      void 0
    }
  }

  for (const entry of state.trackedByToolUseId.values()) {
    if (entry.completed) continue
    if (now - entry.startedAtMs > MAX_TRACK_DURATION_MS) {
      entry.completed = true
      continue
    }

    if (!entry.conversationId && spawnedRefs.length > 0) {
      const match = spawnedRefs.find(
        (ref) =>
          !state.boundConversationIds.has(ref.conversationId) &&
          (ref.createdAtMs === undefined || ref.createdAtMs >= entry.startedAtMs - 15_000),
      )
      if (match) {
        state.boundConversationIds.add(match.conversationId)
        entry.conversationId = match.conversationId
        entry.spawnStepIndex = match.stepIndex
        if (
          state.activeWakeupMinSpawnStepIndex === null ||
          match.stepIndex < state.activeWakeupMinSpawnStepIndex
        ) {
          state.activeWakeupMinSpawnStepIndex = match.stepIndex
        }
        entry.outputFile =
          match.outputFile ||
          findTranscriptPath(match.conversationId, state.brainRoots) ||
          join(state.brainRoots[0] ?? '', match.conversationId, '.system_generated', 'logs', 'transcript.jsonl')
        state.emitEvent({
          type: 'task_started',
          toolUseId: entry.toolUseId,
          taskId: entry.conversationId,
          description: entry.description,
          ...(entry.outputFile ? { outputFile: entry.outputFile } : {}),
          isBackgrounded: true,
        })
      }
    }

    if (!entry.outputFile || !existsSync(entry.outputFile)) continue

    let raw = ''
    try {
      raw = readFileSync(entry.outputFile, 'utf8')
    } catch {
      continue
    }
    if (!raw || raw.length === entry.lastRawLength) continue
    entry.lastRawLength = raw.length

    const parsed = parseAntigravitySubagentTranscript(raw)
    const durationMs = parsed.durationMs > 0 ? parsed.durationMs : Math.max(0, now - entry.startedAtMs)

    if (parsed.inputTokens > 0 || parsed.outputTokens > 0) {
      state.emitEvent({
        type: 'subagent_usage',
        messageId: entry.messageId,
        parentToolUseId: entry.toolUseId,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
      })
    }

    const taskId = entry.conversationId ?? entry.toolUseId

    state.emitEvent({
      type: 'task_progress',
      toolUseId: entry.toolUseId,
      taskId,
      description: entry.description,
      ...(parsed.lastToolName ? { lastToolName: parsed.lastToolName } : {}),
      ...(parsed.summary ? { summary: parsed.summary } : {}),
      outputFile: entry.outputFile,
      ...(parsed.toolEntries.length > 0 ? { toolEntries: parsed.toolEntries } : {}),
      usage: {
        totalTokens: parsed.totalTokens,
        toolUses: parsed.toolUses,
        durationMs,
      },
    })

    const formatSubagentSummary = (includeImages: boolean): string =>
      includeImages
        ? JSON.stringify({ subagent_id: taskId, output_file: entry.outputFile, status: 'generated', savedPaths: parsed.savedImagePaths, provider: 'antigravity' })
        : JSON.stringify({ subagent_id: taskId, output_file: entry.outputFile })

    if (!parsed.completed && !entry.emittedSavedImages && parsed.savedImagePaths.length > 0) {
      entry.emittedSavedImages = true
      state.emitEvent({
        type: 'content_delta',
        messageId: entry.messageId,
        delta: {
          type: 'tool_result',
          toolUseId: entry.toolUseId,
          summary: formatSubagentSummary(true),
          outputPath: entry.outputFile,
          isError: false,
        },
      })
    }

    if (parsed.completed) {
      entry.completed = true
      state.emitEvent({
        type: 'content_delta',
        messageId: entry.messageId,
        delta: {
          type: 'tool_result',
          toolUseId: entry.toolUseId,
          summary: formatSubagentSummary(parsed.savedImagePaths.length > 0),
          outputPath: entry.outputFile,
          isError: parsed.failed,
        },
      })
      state.emitEvent({
        type: 'task_notification',
        toolUseId: entry.toolUseId,
        taskId,
        taskStatus: parsed.failed ? 'failed' : 'completed',
        outputFile: entry.outputFile,
        ...(parsed.summary ? { summary: parsed.summary } : {}),
        ...(parsed.resultText ? { resultText: parsed.resultText } : {}),
        usage: {
          totalTokens: parsed.totalTokens,
          toolUses: parsed.toolUses,
          durationMs,
        },
      })
    }
  }

  let anyActive = [...state.trackedByToolUseId.values()].some((e) => !e.completed)
  if (!anyActive && state.trackedByToolUseId.size > 0 && state.allSubagentsCompletedAtMs === null) {
    state.allSubagentsCompletedAtMs = now
  }

  if (state.wakeupPending && state.parentTurnEnded) {
    const afterStepIndex =
      state.activeWakeupMinSpawnStepIndex ??
      (spawnedRefs.length > 0 ? spawnedRefs[spawnedRefs.length - 1]!.stepIndex : 0)
    const wakeup = extractParentWakeupProgress(parentRaw, afterStepIndex)

    for (const step of wakeup.steps) {
      if (state.emittedWakeupStepIndices.has(step.stepIndex)) continue
      state.emittedWakeupStepIndices.add(step.stepIndex)
      state.unflushedWakeupReplay = true

      if (step.thinking) {
        state.emitEvent({
          type: 'content_delta',
          messageId: state.wakeupMessageId,
          replace: true,
          delta: {
            type: 'thinking',
            id: `agy_wakeup_think_${step.stepIndex}`,
            thinking: step.thinking,
            startedAt: step.startedAt,
            endedAt: step.endedAt,
          },
        })
      }

      for (const tc of step.toolCalls) {
        state.emitEvent({
          type: 'content_delta',
          messageId: state.wakeupMessageId,
          delta: {
            type: 'tool_use',
            toolUseId: tc.toolUseId,
            toolName: tc.toolName,
            input: JSON.stringify(tc.input),
            status: 'complete',
            ...(tc.summary ? { toolSummary: tc.summary } : {}),
          },
        })
        if (isSubagentToolName(tc.toolName) && !state.trackedByToolUseId.has(tc.toolUseId)) {
          const desc =
            typeof tc.input.description === 'string' && tc.input.description.trim()
              ? tc.input.description.trim()
              : tc.summary || 'Subagent'
          state.trackedByToolUseId.set(tc.toolUseId, {
            toolUseId: tc.toolUseId,
            messageId: state.wakeupMessageId,
            description: desc,
            startedAtMs: now,
            lastRawLength: 0,
            completed: false,
          })
          state.allSubagentsCompletedAtMs = null
          anyActive = true
        } else {
          state.emitEvent({
            type: 'content_delta',
            messageId: state.wakeupMessageId,
            delta: {
              type: 'tool_result',
              toolUseId: tc.toolUseId,
              summary: tc.resultSummary ?? 'done',
              isError: Boolean(tc.isError),
            },
          })
        }
      }

      if (step.content) {
        state.emitEvent({
          type: 'content_delta',
          messageId: state.wakeupMessageId,
          replace: true,
          delta: {
            type: 'text',
            id: `agy_wakeup_text_${step.stepIndex}`,
            text: step.content,
          },
        })
      }

      if (wakeup.turnInputTokens > 0 || wakeup.turnOutputTokens > 0 || wakeup.turnCacheReadTokens > 0) {
        state.emitEvent({
          type: 'message_usage',
          messageId: state.wakeupMessageId,
          inputTokens: wakeup.turnInputTokens,
          outputTokens: wakeup.turnOutputTokens,
          ...(wakeup.turnCacheReadTokens > 0 ? { cacheReadTokens: wakeup.turnCacheReadTokens } : {}),
          ...(wakeup.turnContextTokens > 0 ? { contextTokens: wakeup.turnContextTokens } : {}),
        })
      }
    }

    if (!anyActive && wakeup.completed) {
      settleWakeupWaiters(state, 'completed')
    } else if (!anyActive && state.allSubagentsCompletedAtMs !== null) {
      const elapsedSinceSubagentsDone = now - state.allSubagentsCompletedAtMs
      if (!wakeup.sawSystemMessage && elapsedSinceSubagentsDone >= state.noWakeupTimeoutMs) {
        settleWakeupWaiters(state, 'completed')
      } else if (wakeup.sawSystemMessage && elapsedSinceSubagentsDone >= state.wakeupResponseTimeoutMs) {
        settleWakeupWaiters(state, 'completed')
      }
    }
  }

  const shouldKeepPolling = anyActive || (state.wakeupPending && state.parentTurnEnded)
  if (!shouldKeepPolling && state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
}

function ensurePollingTimer(state: SessionSubagentState): void {
  const anyActive = [...state.trackedByToolUseId.values()].some((e) => !e.completed)
  const shouldPoll = anyActive || (state.wakeupPending && state.parentTurnEnded)
  if (shouldPoll && !state.timer) {
    state.timer = setInterval(() => {
      syncSessionSubagents(state)
    }, POLL_INTERVAL_MS)
    state.timer.unref?.()
  }
}

export function noteAntigravitySubagentEvents(
  parentSessionId: string,
  messageId: string,
  mappedEvents: ReadonlyArray<AgentEvent>,
  emitEvent: (event: AgentEvent) => void,
  customBrainRoots?: string[],
): void {
  let state = sessionStates.get(parentSessionId)
  for (const event of mappedEvents) {
    if (event.type !== 'content_delta' || event.delta.type !== 'tool_use') continue
    if (!isSubagentToolName(event.delta.toolName)) continue

    if (!state) {
      state = {
        parentSessionId,
        brainRoots: customBrainRoots ?? resolveAntigravityBrainRoots(),
        emitEvent,
        boundConversationIds: new Set(),
        trackedByToolUseId: new Map(),
        wakeupMessageId: messageId,
        wakeupPending: true,
        parentTurnEnded: false,
        activeWakeupMinSpawnStepIndex: null,
        allSubagentsCompletedAtMs: null,
        noWakeupTimeoutMs: DEFAULT_NO_WAKEUP_TIMEOUT_MS,
        wakeupResponseTimeoutMs: DEFAULT_WAKEUP_RESPONSE_TIMEOUT_MS,
        emittedWakeupStepIndices: new Set(),
        unflushedWakeupReplay: false,
        wakeupWaiters: [],
        timer: null,
      }
      sessionStates.set(parentSessionId, state)
    } else {
      state.emitEvent = emitEvent
      state.wakeupMessageId = messageId
      if (!state.wakeupPending) {
        state.activeWakeupMinSpawnStepIndex = null
      }
      state.wakeupPending = true
      state.parentTurnEnded = false
      state.allSubagentsCompletedAtMs = null
      if (customBrainRoots) state.brainRoots = customBrainRoots
    }

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

  if (!state) return
  syncSessionSubagents(state)
  ensurePollingTimer(state)
}

export function hasPendingAntigravitySubagentWakeup(parentSessionId: string): boolean {
  const state = sessionStates.get(parentSessionId)
  if (!state) return false
  const anyActive = [...state.trackedByToolUseId.values()].some((e) => !e.completed)
  return anyActive || state.wakeupPending
}

export function waitForAntigravitySubagentWakeup(
  parentSessionId: string,
  opts?: { noWakeupTimeoutMs?: number; wakeupResponseTimeoutMs?: number },
): Promise<'completed' | 'cancelled'> {
  const state = sessionStates.get(parentSessionId)
  if (!state || (!state.wakeupPending && ![...state.trackedByToolUseId.values()].some((e) => !e.completed))) {
    return Promise.resolve('completed')
  }
  if (typeof opts?.noWakeupTimeoutMs === 'number' && opts.noWakeupTimeoutMs >= 0) {
    state.noWakeupTimeoutMs = opts.noWakeupTimeoutMs
  }
  if (typeof opts?.wakeupResponseTimeoutMs === 'number' && opts.wakeupResponseTimeoutMs >= 0) {
    state.wakeupResponseTimeoutMs = opts.wakeupResponseTimeoutMs
  }
  state.wakeupPending = true
  state.parentTurnEnded = true
  return new Promise<'completed' | 'cancelled'>((resolve) => {
    state.wakeupWaiters.push(resolve)
    syncSessionSubagents(state)
    ensurePollingTimer(state)
  })
}

export function cancelAntigravitySubagentWakeupWait(parentSessionId: string): boolean {
  const state = sessionStates.get(parentSessionId)
  if (!state) return false
  const hadWaiters = state.wakeupWaiters.length > 0 || state.wakeupPending
  for (const entry of state.trackedByToolUseId.values()) {
    entry.completed = true
  }
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
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
      settleWakeupWaiters(state, 'cancelled')
    }
    sessionStates.delete(parentSessionId)
    return
  }
  for (const state of sessionStates.values()) {
    if (state.timer) clearInterval(state.timer)
    settleWakeupWaiters(state, 'cancelled')
  }
  sessionStates.clear()
}
