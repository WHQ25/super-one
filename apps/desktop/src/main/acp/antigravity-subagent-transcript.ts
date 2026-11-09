import { fileURLToPath } from 'node:url'
import { cleanAntigravityStepContent } from '@superone/shared/antigravity-chunks'
import { normalizeTranscriptTool } from '@superone/shared/tool-ui'
import {
  accumulateAntigravityTurnStep,
  createAntigravityTurnTokenState,
  recordAntigravityPreTurnStep,
} from './antigravity-db-proto'
import { unwrapAntigravityToolOutputText } from './antigravity-protocol'

const STEP_TIMESTAMP_HEADER_RE = /^(?:Created At:\s*[^\r\n]+\r?\n(?:Completed At:\s*[^\r\n]+\r?\n)?|Completed At:\s*[^\r\n]+\r?\n)/
const GENERATED_IMAGE_SAVED_RE = /Generated image is saved at\s+([^\r\n]+?)\.?\s*$/i

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
  void toolName
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

  const tokenState = createAntigravityTurnTokenState()
  let sawSystemMessage = false
  const steps: ParentWakeupPlannerStep[] = []
  let lastWakeupStep: ParentWakeupPlannerStep | null = null
  let pendingToolResultIdx = 0
  let lastPostSystemRecordType: string | null = null
  let lastPostSystemPlannerDone = false

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
    turnInputTokens: tokenState.inputTokens,
    turnOutputTokens: tokenState.outputTokens,
    turnCacheReadTokens: tokenState.cacheReadTokens,
    turnContextTokens: tokenState.contextTokens,
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
      const cacheRead =
        typeof rec.cache_read_tokens === 'number' && Number.isFinite(rec.cache_read_tokens)
          ? rec.cache_read_tokens
          : 0
      const outTok = typeof rec.output_tokens === 'number' && Number.isFinite(rec.output_tokens) ? rec.output_tokens : 0
      const stepPrompt = inTok + cacheRead
      if (stepPrompt > maxInputTokens) maxInputTokens = stepPrompt
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
