import { cleanAntigravityStepContent } from '@superone/shared/antigravity-chunks'
import { normalizeTranscriptTool } from '@superone/shared/tool-ui'
import {
  accumulateAntigravityTurnStep,
  createAntigravityTurnTokenState,
  recordAntigravityPreTurnStep,
} from './antigravity-db-proto'
import { unwrapAntigravityToolOutputText } from './antigravity-protocol'
import {
  CANCELLED_TASK_OUTPUT_RE,
  COMMAND_EXIT_CODE_RE,
  extractBackgroundTaskLaunchFromText,
  parseAntigravityTranscriptRecords,
  parseSystemMessageTaskResult,
  summarizeAntigravityTranscriptToolCall,
  unwrapAntigravityTranscriptArgs,
} from './antigravity-background-task-transcript'

export interface ParentWakeupToolCall {
  toolUseId: string
  rawName: string
  toolName: string
  input: Record<string, unknown>
  summary: string
  backgroundTaskId?: string
  hasResult?: boolean
  resultPending?: boolean
  resultSummary?: string
  isError?: boolean
}

export interface ParentWakeupPlannerStep {
  stepIndex: number
  thinking: string
  content: string
  startedAt: number
  endedAt: number
  toolCalls: ParentWakeupToolCall[]
  failed: boolean
}

export interface ParentWakeupProgress {
  sawSystemMessage: boolean
  completed: boolean
  steps: ParentWakeupPlannerStep[]
  turnInputTokens: number
  turnOutputTokens: number
  turnCacheReadTokens: number
  turnContextTokens: number
}

function parseGoDurationMs(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  const trimmed = raw.trim()
  const msOnly = /^(\d+(?:\.\d+)?)ms$/.exec(trimmed)
  if (msOnly?.[1]) {
    const ms = Number.parseFloat(msOnly[1])
    return Number.isFinite(ms) && ms > 0 ? Math.max(1, Math.round(ms)) : undefined
  }
  const minSec = /^(?:(\d+)m)?(\d+(?:\.\d+)?)s$/.exec(trimmed)
  if (minSec?.[2]) {
    const mins = minSec[1] ? Number.parseInt(minSec[1], 10) : 0
    const secs = Number.parseFloat(minSec[2])
    const totalMs = (mins * 60 + secs) * 1000
    return Number.isFinite(totalMs) && totalMs > 0 ? Math.max(1, Math.round(totalMs)) : undefined
  }
  return undefined
}

export function extractParentWakeupProgress(
  raw: string,
  afterStepIndex: number,
): ParentWakeupProgress {
  const records = parseAntigravityTranscriptRecords(raw)
  let turnStartStepIndex = -1
  let nextUserStepIndex = Number.POSITIVE_INFINITY
  for (const { stepIndex, rec } of records) {
    if (rec.type !== 'USER_INPUT') continue
    if (stepIndex <= afterStepIndex) {
      if (stepIndex > turnStartStepIndex) turnStartStepIndex = stepIndex
    } else if (stepIndex < nextUserStepIndex) {
      nextUserStepIndex = stepIndex
    }
  }

  const tokenState = createAntigravityTurnTokenState()
  let sawSystemMessage = false
  const steps: ParentWakeupPlannerStep[] = []
  let lastWakeupStep: ParentWakeupPlannerStep | null = null
  let pendingToolResultIdx = 0
  let lastPostSystemRecordType: string | null = null
  let lastPostSystemPlannerDone = false
  const pendingWakeupTaskCalls = new Map<string, ParentWakeupToolCall>()
  const minWakeupStepIndex = Math.max(turnStartStepIndex, afterStepIndex)

  for (const { stepIndex, rec } of records) {
    if (stepIndex >= nextUserStepIndex) break
    if (stepIndex <= turnStartStepIndex) {
      if (rec.type === 'PLANNER_RESPONSE' && (rec.status === 'DONE' || rec.status === 'ERROR')) {
        const rawIn = typeof rec.input_tokens === 'number' && Number.isFinite(rec.input_tokens) ? rec.input_tokens : 0
        const outTok = typeof rec.output_tokens === 'number' && Number.isFinite(rec.output_tokens) ? rec.output_tokens : 0
        const cacheRead =
          typeof rec.cache_read_tokens === 'number' && Number.isFinite(rec.cache_read_tokens)
            ? rec.cache_read_tokens
            : 0
        recordAntigravityPreTurnStep(tokenState, rawIn, cacheRead, outTok)
      }
      continue
    }

    if (rec.type === 'PLANNER_RESPONSE' && (rec.status === 'DONE' || rec.status === 'ERROR')) {
      const rawIn = typeof rec.input_tokens === 'number' && Number.isFinite(rec.input_tokens) ? rec.input_tokens : 0
      const outTok = typeof rec.output_tokens === 'number' && Number.isFinite(rec.output_tokens) ? rec.output_tokens : 0
      const cacheRead =
        typeof rec.cache_read_tokens === 'number' && Number.isFinite(rec.cache_read_tokens)
          ? rec.cache_read_tokens
          : 0
      accumulateAntigravityTurnStep(tokenState, rawIn, cacheRead, outTok)
    }

    if (stepIndex <= minWakeupStepIndex) continue

    const contentStr = typeof rec.content === 'string' ? rec.content : ''
    const isSystemMsg = rec.type === 'SYSTEM_MESSAGE' || contentStr.includes('<SYSTEM_MESSAGE>')
    if (isSystemMsg) {
      const taskResult = parseSystemMessageTaskResult(contentStr, stepIndex)
      if (taskResult) {
        const waitingCall = pendingWakeupTaskCalls.get(taskResult.taskId)
        if (waitingCall) {
          pendingWakeupTaskCalls.delete(taskResult.taskId)
          waitingCall.resultPending = false
          waitingCall.hasResult = true
          waitingCall.resultSummary = taskResult.outputSummary
          waitingCall.isError = taskResult.isError
        }
      }
      if (taskResult?.priority !== 'low') {
        sawSystemMessage = true
        lastPostSystemRecordType = 'SYSTEM_MESSAGE'
        lastPostSystemPlannerDone = false
      }
      continue
    }

    if (!sawSystemMessage) continue

    if (rec.type === 'PLANNER_RESPONSE') {
      lastPostSystemRecordType = 'PLANNER_RESPONSE'
      const isDone = rec.status === 'DONE' || rec.status === 'ERROR'
      if (!isDone) {
        lastPostSystemPlannerDone = false
        continue
      }
      const thinking = typeof rec.thinking === 'string' ? rec.thinking.trim() : ''
      const content = typeof rec.content === 'string' ? cleanAntigravityStepContent(rec.content) : ''
      const completedAtMs = typeof rec.created_at === 'string' ? Date.parse(rec.created_at) : Number.NaN
      const endedAt = Number.isFinite(completedAtMs) ? completedAtMs : Date.now()
      const durationMs = parseGoDurationMs(rec.thinking_duration) ?? 1000
      const startedAt = Math.max(0, endedAt - Math.max(1000, durationMs))

      const rawCalls = Array.isArray(rec.tool_calls) ? rec.tool_calls : []
      const toolCalls: ParentWakeupToolCall[] = []
      for (let cIdx = 0; cIdx < rawCalls.length; cIdx += 1) {
        const tc = rawCalls[cIdx]
        if (!tc || typeof tc !== 'object') continue
        const tcObj = tc as Record<string, unknown>
        const rawName = typeof tcObj.name === 'string' && tcObj.name ? tcObj.name : 'tool'
        const args = unwrapAntigravityTranscriptArgs(tcObj.args)
        const normalized = normalizeTranscriptTool(rawName, args)
        const toolUseId =
          typeof tcObj.id === 'string' && tcObj.id.trim()
            ? tcObj.id.trim()
            : `agy_wakeup_tool_${stepIndex}_${cIdx}`
        toolCalls.push({
          toolUseId,
          rawName,
          toolName: normalized.toolName,
          input: normalized.input,
          summary: summarizeAntigravityTranscriptToolCall(normalized.toolName, normalized.input),
          hasResult: false,
          resultPending: false,
        })
      }

      const stepObj: ParentWakeupPlannerStep = {
        stepIndex,
        thinking,
        content,
        startedAt,
        endedAt,
        toolCalls,
        failed: rec.status === 'ERROR',
      }
      steps.push(stepObj)
      lastWakeupStep = stepObj
      pendingToolResultIdx = 0
      lastPostSystemPlannerDone = toolCalls.length === 0
      continue
    }

    if (rec.type === 'GENERIC' && lastWakeupStep && pendingToolResultIdx < lastWakeupStep.toolCalls.length) {
      lastPostSystemRecordType = 'GENERIC'
      lastPostSystemPlannerDone = false
      const targetCall = lastWakeupStep.toolCalls[pendingToolResultIdx]
      pendingToolResultIdx += 1
      if (!targetCall) continue

      const cancelledMatch = CANCELLED_TASK_OUTPUT_RE.exec(contentStr)
      if (cancelledMatch?.[1]) {
        const waitingCall = pendingWakeupTaskCalls.get(cancelledMatch[1].trim())
        if (waitingCall) {
          pendingWakeupTaskCalls.delete(cancelledMatch[1].trim())
          waitingCall.resultPending = false
          waitingCall.hasResult = true
          waitingCall.resultSummary = 'Tool execution was canceled'
          waitingCall.isError = true
        }
      }

      const bgLaunch = extractBackgroundTaskLaunchFromText(contentStr)
      if (bgLaunch) {
        targetCall.backgroundTaskId = bgLaunch.taskId
        const isDaemon = targetCall.input.run_in_background === true || targetCall.input.IsDaemon === true
        if (!isDaemon) {
          targetCall.resultPending = true
          pendingWakeupTaskCalls.set(bgLaunch.taskId, targetCall)
          continue
        }
      }

      const exitMatch = COMMAND_EXIT_CODE_RE.exec(contentStr)
      const exitCode = exitMatch?.[1] !== undefined ? Number.parseInt(exitMatch[1], 10) : 0
      const rawOut = contentStr ? unwrapAntigravityToolOutputText(contentStr).trim() : ''
      targetCall.hasResult = true
      targetCall.resultPending = false
      targetCall.resultSummary = rawOut || 'done'
      targetCall.isError = rec.status === 'ERROR' || (Number.isFinite(exitCode) && exitCode !== 0)
    }
  }

  const completed =
    sawSystemMessage &&
    steps.length > 0 &&
    pendingWakeupTaskCalls.size === 0 &&
    lastPostSystemRecordType === 'PLANNER_RESPONSE' &&
    lastPostSystemPlannerDone

  return {
    sawSystemMessage,
    completed,
    steps,
    turnInputTokens: tokenState.inputTokens,
    turnOutputTokens: tokenState.outputTokens,
    turnCacheReadTokens: tokenState.cacheReadTokens,
    turnContextTokens: tokenState.contextTokens,
  }
}
