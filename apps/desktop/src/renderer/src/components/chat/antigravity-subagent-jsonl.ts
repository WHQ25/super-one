import { cleanAntigravityStepContent } from '@superone/shared/antigravity-chunks'
import { formatTranscriptToolResult } from '@superone/shared/tool-ui'
import type { JsonlEntry, JsonlToolEntry } from './subagent-utils'

const STEP_TIMESTAMP_HEADER_RE = /^(?:Created At:\s*[^\r\n]+\r?\n(?:Completed At:\s*[^\r\n]+\r?\n)?|Completed At:\s*[^\r\n]+\r?\n)/
const STEP_COMMAND_OUTPUT_HEADER_RE =
  /^(?:The command|Command) exited with code -?\d+\.\r?\n(?:\r?\n)?(?:Command output|Output):\r?\n/
const STEP_COMMAND_NO_OUTPUT_RE =
  /^(?:The command|Command) exited with code 0\.\r?\n(?:\r?\n)?No output(?: from the command)?\.?\s*$/

export interface AntigravityTranscriptRecord {
  step_index?: number
  source?: string
  type?: string
  status?: string
  created_at?: string
  input_tokens?: number
  cache_read_tokens?: number
  output_tokens?: number
  thinking?: string
  content?: string
  tool_calls?: Array<{
    id?: string
    name?: string
    args?: Record<string, unknown>
  }>
  media?: Array<{
    mime_type?: string
    uri?: string
  }>
}

export function isAntigravityTranscriptRecord(rec: Record<string, unknown>): boolean {
  return (
    typeof rec.step_index === 'number' &&
    typeof rec.type === 'string' &&
    (rec.type === 'SYSTEM_MESSAGE' ||
      rec.type === 'USER_INPUT' ||
      rec.type === 'PLANNER_RESPONSE' ||
      rec.type === 'GENERIC')
  )
}

export function unwrapAntigravityArgValues(rawArgs: unknown): Record<string, unknown> {
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(rawArgs as Record<string, unknown>)) {
    if (typeof val === 'string') {
      const trimmed = val.trim()
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        trimmed === 'true' ||
        trimmed === 'false' ||
        /^-?\d+(?:\.\d+)?$/.test(trimmed)
      ) {
        try {
          out[key] = JSON.parse(trimmed)
          continue
        } catch {
          void 0
        }
      }
    }
    out[key] = val
  }
  return out
}

function stripFileUri(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed.toLowerCase().startsWith('file://')) return trimmed
  try {
    return decodeURIComponent(new URL(trimmed).pathname).replace(/^\/([A-Za-z]:)/, '$1')
  } catch {
    return trimmed.replace(/^file:\/\//i, '')
  }
}

export function entriesFromAntigravityTranscript(
  records: AntigravityTranscriptRecord[],
  makeToolEntry: (
    rawName: string,
    rawInput: Record<string, unknown>,
    toolUseId?: string,
  ) => JsonlToolEntry | { type: 'structured'; data: unknown },
): { entries: JsonlEntry[]; resultText?: string; toolCount: number } {
  const entries: JsonlEntry[] = []
  const pendingToolIndices: number[] = []
  let sendMessageText: string | undefined
  let lastContentText: string | undefined
  let toolCount = 0

  for (const record of records) {
    if (record.type === 'PLANNER_RESPONSE') {
      pendingToolIndices.length = 0
      if (typeof record.thinking === 'string' && record.thinking.trim()) {
        entries.push({ type: 'activity', text: record.thinking.trim() })
      }
      const cleanedContent = typeof record.content === 'string' ? cleanAntigravityStepContent(record.content) : ''
      if (cleanedContent) {
        lastContentText = cleanedContent
        entries.push({ type: 'activity', text: cleanedContent })
      }
      const calls = Array.isArray(record.tool_calls) ? record.tool_calls : []
      for (let i = 0; i < calls.length; i += 1) {
        const tc = calls[i]
        if (!tc || typeof tc !== 'object') continue
        const name = typeof tc.name === 'string' && tc.name ? tc.name : 'tool'
        const args = unwrapAntigravityArgValues(tc.args)
        if (name === 'send_message' && typeof args.Message === 'string' && args.Message.trim()) {
          sendMessageText = args.Message.trim()
        }
        const id =
          typeof tc.id === 'string' && tc.id
            ? tc.id
            : `agy_step_${record.step_index ?? entries.length}_tc_${i}`
        toolCount += 1
        const entry = makeToolEntry(name, args, id)
        if (entry.type === 'tool') {
          pendingToolIndices.push(entries.length)
        }
        entries.push(entry)
      }
      continue
    }

    if (record.type === 'GENERIC') {
      const idx = pendingToolIndices.shift()
      if (idx === undefined) continue
      const entry = entries[idx]
      if (!entry || entry.type !== 'tool') continue
      const rawContent = typeof record.content === 'string' ? record.content : ''
      const withoutTs = rawContent.replace(STEP_TIMESTAMP_HEADER_RE, '')
      const stripped = STEP_COMMAND_NO_OUTPUT_RE.test(withoutTs)
        ? ''
        : withoutTs.replace(STEP_COMMAND_OUTPUT_HEADER_RE, '').trim()
      const mediaUri =
        Array.isArray(record.media) && typeof record.media[0]?.uri === 'string'
          ? stripFileUri(record.media[0].uri)
          : ''
      const resultText = stripped
        ? formatTranscriptToolResult(stripped)
        : mediaUri
          ? `Saved to ${mediaUri}`
          : entry.toolName === 'ImageGen' || entry.toolName === 'ImageEdit'
            ? 'Completed'
            : ''
      const isError = record.status === 'ERROR'
      entries[idx] = {
        ...entry,
        ...(resultText ? { result: resultText } : {}),
        ...(isError ? { isError: true } : {}),
      }
    }
  }

  const lastRecord = records[records.length - 1]
  const sawPlanner = records.some((record) => record.type === 'PLANNER_RESPONSE')
  // A finished invoke often ends on the GENERIC result of send_message, not another planner step.
  const isCompleted =
    pendingToolIndices.length === 0 &&
    (sawPlanner || lastRecord?.status === 'ERROR')

  return {
    entries,
    resultText: isCompleted ? (sendMessageText ?? lastContentText) : undefined,
    toolCount,
  }
}
