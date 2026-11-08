import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentEvent } from '@superone/shared/agent-types'
import { cleanAntigravityStepContent } from '@superone/shared/antigravity-chunks'
import { isSubagentToolName, normalizeTranscriptTool } from '@superone/shared/tool-ui'
import { resolveAntigravityBrainRoots } from './antigravity-profile'
import { unwrapAntigravityToolOutputText } from './antigravity-protocol'

const STEP_TIMESTAMP_HEADER_RE = /^(?:Created At:\s*[^\r\n]+\r?\n(?:Completed At:\s*[^\r\n]+\r?\n)?|Completed At:\s*[^\r\n]+\r?\n)/
const GENERATED_IMAGE_SAVED_RE = /Generated image is saved at\s+([^\r\n]+?)\.?\s*$/i
const POLL_INTERVAL_MS = 250
const MAX_TRACK_DURATION_MS = 10 * 60 * 1000
const DEFAULT_NO_WAKEUP_TIMEOUT_MS = 5_000
const DEFAULT_WAKEUP_RESPONSE_TIMEOUT_MS = 120_000

export interface SpawnedSubagentRef {
  conversationId: string
  outputFile: string
  stepIndex: number
  createdAtMs?: number
}

export interface ParsedAntigravitySubagentTranscript {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  toolUses: number
  durationMs: number
  toolEntries: Array<{ toolName: string; description: string }>
  lastToolName?: string
  summary?: string
  resultText?: string
  savedImagePaths: string[]
  completed: boolean
  failed: boolean
}

export interface ParentWakeupToolCall {
  toolUseId: string
  rawName: string
  toolName: string
  input: Record<string, unknown>
  summary: string
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

function stripFileUri(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed.toLowerCase().startsWith('file://')) return trimmed
  try {
    return fileURLToPath(trimmed)
  } catch {
    return trimmed.replace(/^file:\/\//i, '')
  }
}

function unwrapArgValues(rawArgs: unknown): Record<string, unknown> {
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(rawArgs as Record<string, unknown>)) {
    if (typeof val === 'string') {
      const t = val.trim()
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')) || t === 'true' || t === 'false' || /^-?\d+(?:\.\d+)?$/.test(t)) {
        try { out[key] = JSON.parse(t); continue } catch { void 0 }
      }
    }
    out[key] = val
  }
  return out
}

function summarizeToolCall(toolName: string, input: Record<string, unknown>): string {
  for (const key of ['file_path', 'target_file', 'command', 'pattern', 'query', 'url', 'path', 'prompt', 'description', 'to']) {
    const val = input[key]
    if (typeof val === 'string' && val.trim()) return val.trim().slice(0, 120)
  }
  return ''
}

function firstNonEmptyLine(text: string | undefined): string | undefined {
  if (typeof text !== 'string') return undefined
  const line = text.trim().split(/\r?\n/, 1)[0]?.trim()
  return line ? line.slice(0, 160) : undefined
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

const CREATED_SUBAGENTS_MARKERS = [
  'Created the following subagents:',
  'Created the following subagent:',
] as const

export function extractSpawnedSubagentsFromParentTranscript(raw: string): SpawnedSubagentRef[] {
  const out: SpawnedSubagentRef[] = []
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim()
    if (!line || !line.includes('Created the following subagent')) continue
    try {
      const rec = JSON.parse(line) as Record<string, unknown>
      const content = typeof rec.content === 'string' ? rec.content : ''
      let markerIdx = -1
      let markerLen = 0
      for (const marker of CREATED_SUBAGENTS_MARKERS) {
        const idx = content.indexOf(marker)
        if (idx >= 0) {
          markerIdx = idx
          markerLen = marker.length
          break
        }
      }
      if (markerIdx < 0) continue
      const jsonSlice = content.slice(markerIdx + markerLen).trim()
      const firstBrace = jsonSlice.indexOf('{')
      const firstBracket = jsonSlice.indexOf('[')
      let candidates: unknown[] = []
      if (firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace)) {
        const endBracket = jsonSlice.lastIndexOf(']')
        if (endBracket > firstBracket) {
          const parsedArr = JSON.parse(jsonSlice.slice(firstBracket, endBracket + 1)) as unknown
          if (Array.isArray(parsedArr)) candidates = parsedArr
        }
      } else if (firstBrace >= 0) {
        const endBrace = jsonSlice.lastIndexOf('}')
        if (endBrace > firstBrace) {
          candidates = [JSON.parse(jsonSlice.slice(firstBrace, endBrace + 1))]
        }
      }
      const stepIndex = typeof rec.step_index === 'number' ? rec.step_index : i
      const createdAtMs = typeof rec.created_at === 'string' ? Date.parse(rec.created_at) : Number.NaN
      for (const item of candidates) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const parsed = item as Record<string, unknown>
        const conversationId = typeof parsed.conversationId === 'string' ? parsed.conversationId.trim() : ''
        const logUri = typeof parsed.logAbsoluteUri === 'string' ? parsed.logAbsoluteUri.trim() : ''
        if (!conversationId) continue
        const outputFile = logUri ? stripFileUri(logUri) : ''
        out.push({
          conversationId,
          outputFile,
          stepIndex,
          ...(Number.isFinite(createdAtMs) ? { createdAtMs } : {}),
        })
      }
    } catch {
      continue
    }
  }
  return out
}

export function extractParentWakeupProgress(
  raw: string,
  afterStepIndex: number,
): ParentWakeupProgress {
  const lines = raw.split('\n')
  const records: Array<{ stepIndex: number; rec: Record<string, unknown> }> = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim()
    if (!line) continue
    try {
      const rec = JSON.parse(line) as Record<string, unknown>
      const stepIndex = typeof rec.step_index === 'number' ? rec.step_index : i
      records.push({ stepIndex, rec })
    } catch {
      continue
    }
  }

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

  let turnInputTokens = 0
  let turnOutputTokens = 0
  let turnCacheReadTokens = 0
  let turnContextTokens = 0
  let sawSystemMessage = false
  const steps: ParentWakeupPlannerStep[] = []
  let lastWakeupStep: ParentWakeupPlannerStep | null = null
  let pendingToolResultIdx = 0
  let lastPostSystemRecordType: string | null = null
  let lastPostSystemPlannerDone = false

  const minWakeupStepIndex = Math.max(turnStartStepIndex, afterStepIndex)

  for (const { stepIndex, rec } of records) {
    if (stepIndex <= turnStartStepIndex) continue
    if (stepIndex >= nextUserStepIndex) break

    if (rec.type === 'PLANNER_RESPONSE' && (rec.status === 'DONE' || rec.status === 'ERROR')) {
      const rawIn = typeof rec.input_tokens === 'number' && Number.isFinite(rec.input_tokens) ? rec.input_tokens : 0
      const outTok = typeof rec.output_tokens === 'number' && Number.isFinite(rec.output_tokens) ? rec.output_tokens : 0
      const cacheRead =
        typeof rec.cache_read_tokens === 'number' && Number.isFinite(rec.cache_read_tokens)
          ? rec.cache_read_tokens
          : 0
      const uncachedIn = cacheRead > 0 && rawIn >= cacheRead ? rawIn - cacheRead : rawIn
      turnInputTokens += uncachedIn
      turnOutputTokens += outTok
      turnCacheReadTokens += cacheRead
      if (rawIn + outTok > 0) {
        turnContextTokens = rawIn + outTok
      }
    }

    if (stepIndex <= minWakeupStepIndex) continue

    const isSystemMsg =
      rec.type === 'SYSTEM_MESSAGE' ||
      (typeof rec.content === 'string' && rec.content.includes('<SYSTEM_MESSAGE>'))
    if (isSystemMsg) {
      sawSystemMessage = true
      lastPostSystemRecordType = 'SYSTEM_MESSAGE'
      lastPostSystemPlannerDone = false
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
        const args = unwrapArgValues(tcObj.args)
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
          summary: summarizeToolCall(normalized.toolName, normalized.input),
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
      if (targetCall) {
        const rawOut = typeof rec.content === 'string' ? unwrapAntigravityToolOutputText(rec.content).trim() : ''
        targetCall.resultSummary = rawOut || 'done'
        targetCall.isError = rec.status === 'ERROR'
      }
    }
  }

  const completed =
    sawSystemMessage &&
    steps.length > 0 &&
    lastPostSystemRecordType === 'PLANNER_RESPONSE' &&
    lastPostSystemPlannerDone

  return {
    sawSystemMessage,
    completed,
    steps,
    turnInputTokens,
    turnOutputTokens,
    turnCacheReadTokens,
    turnContextTokens,
  }
}

export function parseAntigravitySubagentTranscript(raw: string): ParsedAntigravitySubagentTranscript {
  const lines = raw.split('\n')
  const records: Array<Record<string, unknown>> = []
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    try {
      records.push(JSON.parse(line) as Record<string, unknown>)
    } catch {
      continue
    }
  }

  let maxInputTokens = 0
  let sumOutputTokens = 0
  let toolUses = 0
  let firstTimeMs = Number.NaN
  let lastTimeMs = Number.NaN
  let lastToolName: string | undefined
  let summary: string | undefined
  let sendMessageText: string | undefined
  let lastContentText: string | undefined
  const toolEntries: Array<{ toolName: string; description: string }> = []
  const savedImagePaths: string[] = []
  const seenImages = new Set<string>()

  const addImagePath = (candidate: string): void => {
    const cleaned = stripFileUri(candidate).replace(/[.,;:]+$/, '')
    if (cleaned && !seenImages.has(cleaned)) {
      seenImages.add(cleaned)
      savedImagePaths.push(cleaned)
    }
  }

  for (const rec of records) {
    if (typeof rec.created_at === 'string') {
      const t = Date.parse(rec.created_at)
      if (Number.isFinite(t)) {
        if (!Number.isFinite(firstTimeMs) || t < firstTimeMs) firstTimeMs = t
        if (!Number.isFinite(lastTimeMs) || t > lastTimeMs) lastTimeMs = t
      }
    }

    if (rec.type === 'PLANNER_RESPONSE') {
      const inTok = typeof rec.input_tokens === 'number' && Number.isFinite(rec.input_tokens) ? rec.input_tokens : 0
      const outTok = typeof rec.output_tokens === 'number' && Number.isFinite(rec.output_tokens) ? rec.output_tokens : 0
      if (inTok > maxInputTokens) maxInputTokens = inTok
      sumOutputTokens += outTok

      const thinkLine = firstNonEmptyLine(typeof rec.thinking === 'string' ? rec.thinking : undefined)
      if (thinkLine) summary = thinkLine

      const cleanedContent = typeof rec.content === 'string' ? cleanAntigravityStepContent(rec.content) : ''
      if (cleanedContent) {
        lastContentText = cleanedContent
      }

      const calls = Array.isArray(rec.tool_calls) ? rec.tool_calls : []
      for (const tc of calls) {
        if (!tc || typeof tc !== 'object') continue
        const tcObj = tc as Record<string, unknown>
        const rawName = typeof tcObj.name === 'string' && tcObj.name ? tcObj.name : 'tool'
        const args = unwrapArgValues(tcObj.args)
        if (rawName === 'send_message' && typeof args.Message === 'string' && args.Message.trim()) {
          sendMessageText = args.Message.trim()
        }
        const normalized = normalizeTranscriptTool(rawName, args)
        lastToolName = normalized.toolName
        toolUses += 1
        toolEntries.push({
          toolName: normalized.toolName,
          description: summarizeToolCall(normalized.toolName, normalized.input),
        })
      }
      continue
    }

    if (rec.type === 'GENERIC') {
      if (Array.isArray(rec.media)) {
        for (const item of rec.media) {
          if (item && typeof item === 'object') {
            const mediaObj = item as Record<string, unknown>
            const mime = typeof mediaObj.mime_type === 'string' ? mediaObj.mime_type : ''
            const uri = typeof mediaObj.uri === 'string' ? mediaObj.uri : ''
            if (uri && (!mime || mime.startsWith('image/'))) {
              addImagePath(uri)
            }
          }
        }
      }
      if (typeof rec.content === 'string') {
        const stripped = rec.content.replace(STEP_TIMESTAMP_HEADER_RE, '').trim()
        const match = GENERATED_IMAGE_SAVED_RE.exec(stripped)
        if (match?.[1]) addImagePath(match[1])
      }
    }
  }

  const lastRec = records[records.length - 1]
  const lastCalls = lastRec && Array.isArray(lastRec.tool_calls) ? lastRec.tool_calls : []
  const failed = Boolean(lastRec && lastRec.status === 'ERROR')
  const completed =
    failed ||
    Boolean(
      lastRec &&
      lastRec.type === 'PLANNER_RESPONSE' &&
      lastRec.status === 'DONE' &&
      lastCalls.length === 0,
    )
  const durationMs =
    Number.isFinite(firstTimeMs) && Number.isFinite(lastTimeMs) && lastTimeMs >= firstTimeMs
      ? lastTimeMs - firstTimeMs
      : 0

  return {
    totalTokens: maxInputTokens + sumOutputTokens,
    inputTokens: maxInputTokens,
    outputTokens: sumOutputTokens,
    toolUses,
    durationMs,
    toolEntries,
    lastToolName,
    summary,
    resultText: sendMessageText ?? lastContentText,
    savedImagePaths,
    completed,
    failed,
  }
}

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

    if (!parsed.completed && !entry.emittedSavedImages && parsed.savedImagePaths.length > 0) {
      entry.emittedSavedImages = true
      state.emitEvent({
        type: 'content_delta',
        messageId: entry.messageId,
        delta: {
          type: 'tool_result',
          toolUseId: entry.toolUseId,
          summary: JSON.stringify({ subagent_id: taskId, output_file: entry.outputFile, status: 'generated', savedPaths: parsed.savedImagePaths, provider: 'antigravity' }),
          outputPath: entry.outputFile,
          isError: false,
        },
      })
    }

    if (parsed.completed) {
      entry.completed = true
      const resultSummary =
        parsed.savedImagePaths.length > 0
          ? JSON.stringify({ subagent_id: taskId, output_file: entry.outputFile, status: 'generated', savedPaths: parsed.savedImagePaths, provider: 'antigravity' })
          : JSON.stringify({ subagent_id: taskId, output_file: entry.outputFile })
      state.emitEvent({
        type: 'content_delta',
        messageId: entry.messageId,
        delta: {
          type: 'tool_result',
          toolUseId: entry.toolUseId,
          summary: resultSummary,
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
    const wakeup = parentRaw
      ? extractParentWakeupProgress(parentRaw, afterStepIndex)
      : {
          sawSystemMessage: false,
          completed: false,
          steps: [],
          turnInputTokens: 0,
          turnOutputTokens: 0,
          turnCacheReadTokens: 0,
          turnContextTokens: 0,
        }

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
