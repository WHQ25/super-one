import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { cleanAntigravityStepContent } from '@superone/shared/antigravity-chunks'
import { resolveAntigravityBrainRoots } from './acp/antigravity-profile'

export interface WorkflowAgentTranscriptSummary {
  agentId: string
  jsonlPath: string
  prompt?: string
  toolCount: number
  tokens?: number
  resultText?: string
  transcriptAvailable: true
}

interface AntigravityTranscriptSummary {
  prompt?: string
  toolCount: number
  tokens?: number
  resultText?: string
}

const summaryCache = new Map<string, { mtimeMs: number; size: number; summary: AntigravityTranscriptSummary }>()
const SUMMARY_CACHE_LIMIT = 512

const USER_REQUEST_RE = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i

export function deriveAntigravityBrainRootFromLogPath(logPath: string | undefined): string | undefined {
  if (!logPath) return undefined
  const trimmed = logPath.trim()
  if (!trimmed) return undefined
  const tasksDir = dirname(trimmed)
  if (basename(tasksDir) !== 'tasks') return undefined
  const sysDir = dirname(tasksDir)
  if (basename(sysDir) !== '.system_generated') return undefined
  const sessionDir = dirname(sysDir)
  const brainRoot = dirname(sessionDir)
  if (!brainRoot || brainRoot === sessionDir) return undefined
  return brainRoot
}

export function extractAntigravityPrompt(content: string | undefined): string | undefined {
  if (!content) return undefined
  const match = content.match(USER_REQUEST_RE)
  if (match?.[1]?.trim()) return match[1].trim()
  const trimmed = content.trim()
  return trimmed || undefined
}

function unwrapArgString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return value
    }
  }
  return value
}

function formatFinishResult(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const unwrapped = unwrapArgString(value)
  if (typeof unwrapped === 'string') return unwrapped.trim() || undefined
  try {
    return JSON.stringify(unwrapped, null, 2)
  } catch {
    return String(unwrapped)
  }
}

export function summarizeAntigravityAgentTranscript(raw: string): AntigravityTranscriptSummary {
  let prompt: string | undefined
  let toolCount = 0
  let sendMessageText: string | undefined
  let finishResultText: string | undefined
  let lastContentText: string | undefined
  const tokensByStep = new Map<string, number>()

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let rec: Record<string, unknown>
    try {
      rec = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    if (!rec || typeof rec !== 'object') continue

    if (rec.type === 'USER_INPUT' && !prompt && typeof rec.content === 'string') {
      prompt = extractAntigravityPrompt(rec.content)
      continue
    }

    if (rec.type === 'PLANNER_RESPONSE') {
      const inputTokens = typeof rec.input_tokens === 'number' && Number.isFinite(rec.input_tokens) ? rec.input_tokens : 0
      const cacheReadTokens = typeof rec.cache_read_tokens === 'number' && Number.isFinite(rec.cache_read_tokens) ? rec.cache_read_tokens : 0
      const outputTokens = typeof rec.output_tokens === 'number' && Number.isFinite(rec.output_tokens) ? rec.output_tokens : 0
      const stepTotal = inputTokens + cacheReadTokens + outputTokens
      if (stepTotal > 0) {
        const key = typeof rec.step_index === 'number' ? String(rec.step_index) : `#${tokensByStep.size}`
        tokensByStep.set(key, stepTotal)
      }
      if (typeof rec.content === 'string') {
        const cleaned = cleanAntigravityStepContent(rec.content)
        if (cleaned) lastContentText = cleaned
      }
      const calls = Array.isArray(rec.tool_calls) ? rec.tool_calls : []
      for (const tc of calls) {
        if (!tc || typeof tc !== 'object') continue
        toolCount += 1
        const tcObj = tc as { name?: unknown; args?: Record<string, unknown> }
        const name = typeof tcObj.name === 'string' ? tcObj.name : ''
        const args = tcObj.args && typeof tcObj.args === 'object' ? tcObj.args : undefined
        if (name === 'send_message' && args) {
          const msg = unwrapArgString(args.Message ?? args.message)
          if (typeof msg === 'string' && msg.trim()) sendMessageText = msg.trim()
        } else if (name === 'finish' && args && 'result' in args) {
          const fin = formatFinishResult(args.result)
          if (fin) finishResultText = fin
        }
      }
    }
  }

  let tokens = 0
  for (const val of tokensByStep.values()) tokens += val
  const resultText = sendMessageText ?? finishResultText ?? lastContentText
  return {
    ...(prompt ? { prompt } : {}),
    toolCount,
    ...(tokens > 0 ? { tokens } : {}),
    ...(resultText ? { resultText } : {}),
  }
}

async function summarizeCached(filePath: string): Promise<AntigravityTranscriptSummary | null> {
  let info: { mtimeMs: number; size: number }
  try {
    const st = await stat(filePath)
    if (!st.isFile()) return null
    info = { mtimeMs: st.mtimeMs, size: st.size }
  } catch {
    return null
  }
  const cached = summaryCache.get(filePath)
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
    return cached.summary
  }
  try {
    const raw = await readFile(filePath, 'utf8')
    const summary = summarizeAntigravityAgentTranscript(raw)
    summaryCache.delete(filePath)
    if (summaryCache.size >= SUMMARY_CACHE_LIMIT) {
      summaryCache.delete(summaryCache.keys().next().value as string)
    }
    summaryCache.set(filePath, { mtimeMs: info.mtimeMs, size: info.size, summary })
    return summary
  } catch {
    return null
  }
}

function isSafeAgentId(agentId: string): boolean {
  return agentId.length > 0 && !agentId.includes('/') && !agentId.includes('\\') && !agentId.includes('..')
}

export async function resolveAntigravityWorkflowAgentTranscripts(params: {
  agentIds: string[]
  logPath?: string
  customBrainRoots?: string[]
}): Promise<Record<string, WorkflowAgentTranscriptSummary>> {
  const uniqueIds = [...new Set(params.agentIds.map((id) => id.trim()).filter(isSafeAgentId))]
  if (uniqueIds.length === 0) return {}

  const derivedRoot = deriveAntigravityBrainRootFromLogPath(params.logPath)
  const roots = [...new Set([
    ...(derivedRoot ? [derivedRoot] : []),
    ...(params.customBrainRoots ?? resolveAntigravityBrainRoots()),
  ])]

  const out: Record<string, WorkflowAgentTranscriptSummary> = {}
  for (const agentId of uniqueIds) {
    for (const root of roots) {
      let matched = false
      for (const filename of ['transcript.jsonl', 'transcript_full.jsonl']) {
        const candidate = join(root, agentId, '.system_generated', 'logs', filename)
        const summary = await summarizeCached(candidate)
        if (summary) {
          out[agentId] = {
            agentId,
            jsonlPath: candidate,
            ...summary,
            transcriptAvailable: true,
          }
          matched = true
          break
        }
      }
      if (matched) break
    }
  }
  return out
}
