import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveAntigravityBrainRoots } from './antigravity-profile'

const MAX_CONSUMED_TRANSCRIPT_RESULTS = 1000
const consumedTranscriptKeys = new Set<string>()

function recordConsumedKey(key: string): void {
  if (consumedTranscriptKeys.size >= MAX_CONSUMED_TRANSCRIPT_RESULTS) {
    const oldest = consumedTranscriptKeys.values().next().value
    if (oldest) consumedTranscriptKeys.delete(oldest)
  }
  consumedTranscriptKeys.add(key)
}

function unwrapStringArg(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined
  const trimmed = val.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === 'string') return parsed
    } catch {
      void 0
    }
  }
  return val
}

function pickStringArg(obj: Record<string, unknown>, keys: readonly string[], trim = true): string | undefined {
  for (const key of keys) {
    const raw = unwrapStringArg(obj[key])
    if (raw === undefined) continue
    const val = trim ? raw.trim() : raw
    if (val.length > 0 || !trim) return val
  }
  return undefined
}

function pickStringArrayArg(obj: Record<string, unknown>, keys: readonly string[]): string[] | undefined {
  for (const key of keys) {
    const val = obj[key]
    if (Array.isArray(val)) {
      return val
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    }
    if (typeof val === 'string') {
      const trimmed = val.trim()
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed)
          if (Array.isArray(parsed)) {
            return parsed
              .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
              .map((item) => item.trim())
          }
        } catch {
          void 0
        }
      }
    }
  }
  return undefined
}

export function compactDiffPair(oldText: string, newText: string): { oldText: string; newText: string } {
  if (!oldText || !newText || oldText === newText) return { oldText, newText }
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const minLen = Math.min(oldLines.length, newLines.length)
  let prefix = 0
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) prefix++
  let suffix = 0
  while (suffix < minLen - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++
  if (prefix + suffix <= 6) return { oldText, newText }
  const start = Math.max(0, prefix - 3)
  return {
    oldText: oldLines.slice(start, Math.min(oldLines.length, oldLines.length - suffix + 3)).join('\n'),
    newText: newLines.slice(start, Math.min(newLines.length, newLines.length - suffix + 3)).join('\n'),
  }
}

export function applyAntigravityManageTaskInput(inObj: Record<string, unknown>): void {
  const action = pickStringArg(inObj, ['action', 'Action'])
  if (action && typeof inObj.action !== 'string') {
    inObj.action = action.toLowerCase()
  }
  const taskId = pickStringArg(inObj, ['taskId', 'TaskId', 'task_id'])
  if (taskId && typeof inObj.taskId !== 'string') {
    inObj.taskId = taskId
  }
  const input = pickStringArg(inObj, ['input', 'Input'], false)
  if (input !== undefined && typeof inObj.input !== 'string') {
    inObj.input = input
  }
}

export function applyAntigravityManageSubagentsInput(inObj: Record<string, unknown>): void {
  const action = pickStringArg(inObj, ['action', 'Action'])
  if (action && typeof inObj.action !== 'string') {
    inObj.action = action.toLowerCase()
  }
  const conversationIds = pickStringArrayArg(inObj, ['conversationIds', 'ConversationIds', 'conversation_ids'])
  if (conversationIds !== undefined && !Array.isArray(inObj.conversationIds)) {
    inObj.conversationIds = conversationIds
  }
}

export function applyAntigravityBuiltinToolInput(
  mappedUiName: string | null,
  inObj: Record<string, unknown>,
): void {
  if (mappedUiName === 'ManageTask') {
    applyAntigravityManageTaskInput(inObj)
  } else if (mappedUiName === 'ManageSubagents') {
    applyAntigravityManageSubagentsInput(inObj)
  }
}

export function isAntigravityTranscriptOutputTool(variant: unknown): boolean {
  return variant === 'ManageTask' || variant === 'ManageSubagents'
}

function findTranscriptFile(sessionId: string, brainRoots: string[]): string | null {
  for (const root of brainRoots) {
    for (const filename of ['transcript_full.jsonl', 'transcript.jsonl']) {
      const candidate = join(root, sessionId, '.system_generated', 'logs', filename)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

interface TranscriptGenericCandidate {
  key: string
  args: Record<string, unknown>
  output: string
}

function collectTranscriptGenericOutputs(
  sessionId: string | undefined,
  toolNames: ReadonlySet<string>,
  unwrapOutput: (text: string) => string,
  customBrainRoots?: string[],
): TranscriptGenericCandidate[] {
  if (!sessionId || /[/\\]/.test(sessionId)) return []
  const transcriptPath = findTranscriptFile(sessionId.trim(), customBrainRoots ?? resolveAntigravityBrainRoots())
  if (!transcriptPath) return []

  let raw = ''
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return []
  }

  const records: Array<{ stepIndex: number; rec: Record<string, unknown> }> = []
  const lines = raw.split('\n')
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

  let lastUserIdx = -1
  for (let i = 0; i < records.length; i += 1) {
    if (records[i]?.rec.type === 'USER_INPUT') lastUserIdx = i
  }

  const candidates: TranscriptGenericCandidate[] = []
  let activeCalls: Array<{ stepIndex: number; callIdx: number; name: string; args: Record<string, unknown> }> = []
  let pendingIdx = 0

  for (let i = lastUserIdx + 1; i < records.length; i += 1) {
    const { stepIndex, rec } = records[i]!
    if (rec.type === 'PLANNER_RESPONSE' && (rec.status === 'DONE' || rec.status === 'ERROR')) {
      const toolCalls = Array.isArray(rec.tool_calls) ? rec.tool_calls : []
      activeCalls = []
      for (let cIdx = 0; cIdx < toolCalls.length; cIdx += 1) {
        const tc = toolCalls[cIdx]
        if (!tc || typeof tc !== 'object') continue
        const tcObj = tc as Record<string, unknown>
        const name = typeof tcObj.name === 'string' ? tcObj.name.trim() : ''
        const args = tcObj.args && typeof tcObj.args === 'object' && !Array.isArray(tcObj.args)
          ? (tcObj.args as Record<string, unknown>)
          : {}
        activeCalls.push({ stepIndex, callIdx: cIdx, name, args })
      }
      pendingIdx = 0
      continue
    }
    if (rec.type === 'GENERIC' && (rec.status === 'DONE' || rec.status === 'ERROR') && pendingIdx < activeCalls.length) {
      const call = activeCalls[pendingIdx]!
      pendingIdx += 1
      if (!toolNames.has(call.name)) continue
      const content = typeof rec.content === 'string' ? unwrapOutput(rec.content).trim() : ''
      if (!content) continue
      candidates.push({
        key: `${sessionId}:${call.stepIndex}:${call.callIdx}`,
        args: call.args,
        output: content,
      })
    }
  }

  return candidates
}

function selectMatchingTranscriptOutput(
  candidates: TranscriptGenericCandidate[],
  matchesArgs: (args: Record<string, unknown>) => boolean,
): string | undefined {
  for (const candidate of candidates) {
    if (!consumedTranscriptKeys.has(candidate.key) && matchesArgs(candidate.args)) {
      recordConsumedKey(candidate.key)
      return candidate.output
    }
  }
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i]!
    if (matchesArgs(candidate.args)) return candidate.output
  }
  return undefined
}

const MANAGE_TASK_NAMES = new Set(['manage_task', 'ManageTask'])
const MANAGE_SUBAGENTS_NAMES = new Set(['manage_subagents', 'ManageSubagents'])

export function resolveAntigravityManageTaskOutput(
  sessionId: string | undefined,
  rawInput: Record<string, unknown>,
  unwrapOutput: (text: string) => string,
  customBrainRoots?: string[],
): string | undefined {
  const candidates = collectTranscriptGenericOutputs(sessionId, MANAGE_TASK_NAMES, unwrapOutput, customBrainRoots)
  if (candidates.length === 0) return undefined

  const wantAction = pickStringArg(rawInput, ['action', 'Action'])?.toLowerCase()
  const wantTaskId = pickStringArg(rawInput, ['taskId', 'TaskId', 'task_id'])
  const wantInput = pickStringArg(rawInput, ['input', 'Input'], false)

  return selectMatchingTranscriptOutput(candidates, (args) => {
    const cAction = pickStringArg(args, ['action', 'Action'])?.toLowerCase()
    const cTaskId = pickStringArg(args, ['taskId', 'TaskId', 'task_id'])
    const cInput = pickStringArg(args, ['input', 'Input'], false)
    if (wantAction && cAction && cAction !== wantAction) return false
    if (wantTaskId && cTaskId && cTaskId !== wantTaskId) return false
    if (wantInput !== undefined && cInput !== undefined && cInput !== wantInput) return false
    return true
  })
}

export function resolveAntigravityManageSubagentsOutput(
  sessionId: string | undefined,
  rawInput: Record<string, unknown>,
  unwrapOutput: (text: string) => string,
  customBrainRoots?: string[],
): string | undefined {
  const candidates = collectTranscriptGenericOutputs(sessionId, MANAGE_SUBAGENTS_NAMES, unwrapOutput, customBrainRoots)
  if (candidates.length === 0) return undefined

  const wantAction = pickStringArg(rawInput, ['action', 'Action'])?.toLowerCase()
  const wantIds = pickStringArrayArg(rawInput, ['conversationIds', 'ConversationIds', 'conversation_ids'])

  return selectMatchingTranscriptOutput(candidates, (args) => {
    const cAction = pickStringArg(args, ['action', 'Action'])?.toLowerCase()
    const cIds = pickStringArrayArg(args, ['conversationIds', 'ConversationIds', 'conversation_ids'])
    if (wantAction && cAction && cAction !== wantAction) return false
    if (wantIds && wantIds.length > 0 && cIds && cIds.length > 0 && wantIds.join('\0') !== cIds.join('\0')) {
      return false
    }
    return true
  })
}

export function resolveAntigravityTranscriptToolOutput(
  variant: unknown,
  sessionId: string | undefined,
  rawInput: Record<string, unknown>,
  unwrapOutput: (text: string) => string,
  customBrainRoots?: string[],
): string | undefined {
  if (variant === 'ManageTask') {
    return resolveAntigravityManageTaskOutput(sessionId, rawInput, unwrapOutput, customBrainRoots)
  }
  if (variant === 'ManageSubagents') {
    return resolveAntigravityManageSubagentsOutput(sessionId, rawInput, unwrapOutput, customBrainRoots)
  }
  return undefined
}
