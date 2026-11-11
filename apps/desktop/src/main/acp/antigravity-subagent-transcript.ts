import { cleanAntigravityStepContent } from '@superone/shared/antigravity-chunks'
import { normalizeTranscriptTool } from '@superone/shared/tool-ui'
import {
  stripAntigravityFileUri,
  summarizeAntigravityTranscriptToolCall,
  unwrapAntigravityTranscriptArgs,
} from './antigravity-background-task-transcript'

export * from './antigravity-background-task-transcript'
export * from './antigravity-wakeup-transcript'

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

function firstNonEmptyLine(text: string | undefined): string | undefined {
  if (typeof text !== 'string') return undefined
  const line = text.trim().split(/\r?\n/, 1)[0]?.trim()
  return line ? line.slice(0, 160) : undefined
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
        const outputFile = logUri ? stripAntigravityFileUri(logUri) : ''
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
    const cleaned = stripAntigravityFileUri(candidate).replace(/[.,;:]+$/, '')
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
        const args = unwrapAntigravityTranscriptArgs(tcObj.args)
        if (rawName === 'send_message' && typeof args.Message === 'string' && args.Message.trim()) {
          sendMessageText = args.Message.trim()
        }
        const normalized = normalizeTranscriptTool(rawName, args)
        lastToolName = normalized.toolName
        toolUses += 1
        toolEntries.push({
          toolName: normalized.toolName,
          description: summarizeAntigravityTranscriptToolCall(normalized.toolName, normalized.input),
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
