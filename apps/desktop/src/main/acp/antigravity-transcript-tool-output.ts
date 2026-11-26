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

function pickNumberArg(obj: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const val = obj[key]
    if (typeof val === 'number' && Number.isFinite(val)) return val
    if (typeof val === 'string' && /^-?\d+(?:\.\d+)?$/.test(val.trim())) {
      const parsed = Number(val.trim())
      if (Number.isFinite(parsed)) return parsed
    }
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

const TRANSCRIPT_OUTPUT_VARIANTS = new Set([
  'ManageTask',
  'ManageSubagents',
  'Schedule',
  'DefineSubagent',
  'SendMessage',
  'ListMcpResources',
  'ReadMcpResource',
  'ManageInbox',
  'ReadBoard',
  'PostMessage',
  'SwarmWait',
  'Workflow',
])

export function isAntigravityTranscriptOutputTool(variant: unknown): boolean {
  return typeof variant === 'string' && TRANSCRIPT_OUTPUT_VARIANTS.has(variant)
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
  callId?: string
  args: Record<string, unknown>
  output: string
}

function collectTranscriptGenericOutputs(
  sessionId: string | undefined,
  toolNames: ReadonlySet<string>,
  unwrapOutput: (text: string) => string,
  customBrainRoots?: string[],
  allowRunning = false,
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
  let activeCalls: Array<{
    stepIndex: number
    callIdx: number
    callId?: string
    name: string
    args: Record<string, unknown>
  }> = []
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
        const callId = typeof tcObj.id === 'string' && tcObj.id.trim() ? tcObj.id.trim() : undefined
        const args = tcObj.args && typeof tcObj.args === 'object' && !Array.isArray(tcObj.args)
          ? (tcObj.args as Record<string, unknown>)
          : {}
        activeCalls.push({ stepIndex, callIdx: cIdx, callId, name, args })
      }
      pendingIdx = 0
      continue
    }
    const statusOk = rec.status === 'DONE' || rec.status === 'ERROR' || (allowRunning && rec.status === 'RUNNING')
    if (rec.type === 'GENERIC' && statusOk && pendingIdx < activeCalls.length) {
      const call = activeCalls[pendingIdx]!
      pendingIdx += 1
      if (!toolNames.has(call.name)) continue
      const content = typeof rec.content === 'string' ? unwrapOutput(rec.content).trim() : ''
      if (!content) continue
      candidates.push({
        key: `${sessionId}:${call.stepIndex}:${call.callIdx}`,
        callId: call.callId,
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
  toolCallId?: string,
): string | undefined {
  if (toolCallId) {
    const exact = candidates.find((c) => c.callId === toolCallId)
    if (exact) {
      recordConsumedKey(exact.key)
      return exact.output
    }
  }
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

const MANAGE_TASK_NAMES = new Set(['manage_task', 'ManageTask', 'send_command_input'])
const MANAGE_SUBAGENTS_NAMES = new Set(['manage_subagents', 'ManageSubagents', 'swarm'])
const SCHEDULE_NAMES = new Set(['schedule', 'Schedule'])
const DEFINE_SUBAGENT_NAMES = new Set(['define_subagent', 'DefineSubagent'])
const SEND_MESSAGE_NAMES = new Set(['send_message', 'SendMessage'])
const LIST_RESOURCES_NAMES = new Set(['list_resources', 'list_mcp_resources', 'ListMcpResources'])
const READ_RESOURCE_NAMES = new Set(['read_resource', 'read_mcp_resource', 'ReadMcpResource'])
const MANAGE_INBOX_NAMES = new Set(['manage_inbox', 'ManageInbox'])
const READ_BOARD_NAMES = new Set(['read_board', 'ReadBoard'])
const POST_MESSAGE_NAMES = new Set(['post_message', 'PostMessage'])
const SWARM_WAIT_NAMES = new Set(['swarm_wait', 'SwarmWait'])
const WORKFLOW_NAMES = new Set(['run_workflow', 'workflow', 'Workflow'])

export function resolveAntigravityManageTaskOutput(
  sessionId: string | undefined,
  rawInput: Record<string, unknown>,
  unwrapOutput: (text: string) => string,
  customBrainRoots?: string[],
  toolCallId?: string,
): string | undefined {
  const candidates = collectTranscriptGenericOutputs(sessionId, MANAGE_TASK_NAMES, unwrapOutput, customBrainRoots)
  if (candidates.length === 0) return undefined

  const wantAction = pickStringArg(rawInput, ['action', 'Action'])?.toLowerCase()
  const wantTaskId = pickStringArg(rawInput, ['taskId', 'TaskId', 'task_id', 'CommandId'])
  const wantInput = pickStringArg(rawInput, ['input', 'Input'], false)

  return selectMatchingTranscriptOutput(candidates, (args) => {
    const cAction = pickStringArg(args, ['action', 'Action'])?.toLowerCase()
    const cTaskId = pickStringArg(args, ['taskId', 'TaskId', 'task_id', 'CommandId'])
    const cInput = pickStringArg(args, ['input', 'Input'], false)
    if (wantAction && cAction && cAction !== wantAction) return false
    if (wantTaskId && cTaskId && cTaskId !== wantTaskId) return false
    if (wantInput !== undefined && cInput !== undefined && cInput !== wantInput) return false
    return true
  }, toolCallId)
}

export function resolveAntigravityManageSubagentsOutput(
  sessionId: string | undefined,
  rawInput: Record<string, unknown>,
  unwrapOutput: (text: string) => string,
  customBrainRoots?: string[],
  toolCallId?: string,
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
  }, toolCallId)
}

export function resolveAntigravityTranscriptToolOutput(
  variant: unknown,
  sessionId: string | undefined,
  rawInput: Record<string, unknown>,
  unwrapOutput: (text: string) => string,
  customBrainRoots?: string[],
  toolCallId?: string,
): string | undefined {
  if (variant === 'ManageTask') {
    return resolveAntigravityManageTaskOutput(sessionId, rawInput, unwrapOutput, customBrainRoots, toolCallId)
  }
  if (variant === 'ManageSubagents') {
    return resolveAntigravityManageSubagentsOutput(sessionId, rawInput, unwrapOutput, customBrainRoots, toolCallId)
  }
  if (variant === 'Workflow') {
    const candidates = collectTranscriptGenericOutputs(sessionId, WORKFLOW_NAMES, unwrapOutput, customBrainRoots, true)
    if (candidates.length === 0) return undefined
    const wantDesc = pickStringArg(rawInput, ['Description', 'description'])
    const wantScript = pickStringArg(rawInput, ['Script', 'script'], false)
    const wantScriptPath = pickStringArg(rawInput, ['ScriptPath', 'scriptPath', 'script_path'])
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cDesc = pickStringArg(args, ['Description', 'description'])
      const cScript = pickStringArg(args, ['Script', 'script'], false)
      const cScriptPath = pickStringArg(args, ['ScriptPath', 'scriptPath', 'script_path'])
      if (wantDesc && cDesc && cDesc !== wantDesc) return false
      if (wantScript && cScript && cScript !== wantScript) return false
      if (wantScriptPath && cScriptPath && cScriptPath !== wantScriptPath) return false
      return true
    }, toolCallId)
  }
  if (variant === 'Schedule') {
    const candidates = collectTranscriptGenericOutputs(sessionId, SCHEDULE_NAMES, unwrapOutput, customBrainRoots, true)
    if (candidates.length === 0) return undefined
    const wantPrompt = pickStringArg(rawInput, ['prompt', 'Prompt'])
    const wantCron = pickStringArg(rawInput, ['cronExpression', 'CronExpression'])
    const wantDuration = pickNumberArg(rawInput, ['durationSeconds', 'DurationSeconds'])
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cPrompt = pickStringArg(args, ['prompt', 'Prompt'])
      const cCron = pickStringArg(args, ['cronExpression', 'CronExpression'])
      const cDuration = pickNumberArg(args, ['durationSeconds', 'DurationSeconds'])
      if (wantPrompt && cPrompt && cPrompt !== wantPrompt) return false
      if (wantCron && cCron && cCron !== wantCron) return false
      if (wantDuration !== undefined && cDuration !== undefined && cDuration !== wantDuration) return false
      return true
    }, toolCallId)
  }
  if (variant === 'DefineSubagent') {
    const candidates = collectTranscriptGenericOutputs(sessionId, DEFINE_SUBAGENT_NAMES, unwrapOutput, customBrainRoots)
    if (candidates.length === 0) return undefined
    const wantName = pickStringArg(rawInput, ['name', 'Name'])
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cName = pickStringArg(args, ['name', 'Name'])
      return !(wantName && cName && cName !== wantName)
    }, toolCallId)
  }
  if (variant === 'SendMessage') {
    const candidates = collectTranscriptGenericOutputs(sessionId, SEND_MESSAGE_NAMES, unwrapOutput, customBrainRoots)
    if (candidates.length === 0) return undefined
    const wantTo = pickStringArg(rawInput, ['to', 'Recipient', 'recipient'])
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cTo = pickStringArg(args, ['to', 'Recipient', 'recipient'])
      return !(wantTo && cTo && cTo !== wantTo)
    }, toolCallId)
  }
  if (variant === 'ListMcpResources') {
    const candidates = collectTranscriptGenericOutputs(sessionId, LIST_RESOURCES_NAMES, unwrapOutput, customBrainRoots)
    if (candidates.length === 0) return undefined
    const wantServer = pickStringArg(rawInput, ['server', 'ServerName', 'server_name'])
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cServer = pickStringArg(args, ['server', 'ServerName', 'server_name'])
      return !(wantServer && cServer && cServer !== wantServer)
    }, toolCallId)
  }
  if (variant === 'ReadMcpResource') {
    const candidates = collectTranscriptGenericOutputs(sessionId, READ_RESOURCE_NAMES, unwrapOutput, customBrainRoots)
    if (candidates.length === 0) return undefined
    const wantUri = pickStringArg(rawInput, ['uri', 'Uri'])
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cUri = pickStringArg(args, ['uri', 'Uri'])
      return !(wantUri && cUri && cUri !== wantUri)
    }, toolCallId)
  }
  if (variant === 'ManageInbox') {
    const candidates = collectTranscriptGenericOutputs(sessionId, MANAGE_INBOX_NAMES, unwrapOutput, customBrainRoots)
    if (candidates.length === 0) return undefined
    const wantAction = pickStringArg(rawInput, ['action', 'Action'])?.toLowerCase()
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cAction = pickStringArg(args, ['action', 'Action'])?.toLowerCase()
      return !(wantAction && cAction && cAction !== wantAction)
    }, toolCallId)
  }
  if (variant === 'ReadBoard') {
    const candidates = collectTranscriptGenericOutputs(sessionId, READ_BOARD_NAMES, unwrapOutput, customBrainRoots)
    if (candidates.length === 0) return undefined
    const wantSince = pickNumberArg(rawInput, ['since', 'Since'])
    const wantChannel = pickStringArg(rawInput, ['channel', 'Channel'])
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cSince = pickNumberArg(args, ['since', 'Since'])
      const cChannel = pickStringArg(args, ['channel', 'Channel'])
      if (wantSince !== undefined && cSince !== undefined && cSince !== wantSince) return false
      if (wantChannel && cChannel && cChannel !== wantChannel) return false
      return true
    }, toolCallId)
  }
  if (variant === 'PostMessage') {
    const candidates = collectTranscriptGenericOutputs(sessionId, POST_MESSAGE_NAMES, unwrapOutput, customBrainRoots)
    if (candidates.length === 0) return undefined
    const wantText = pickStringArg(rawInput, ['text', 'Text', 'message', 'Message'])
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cText = pickStringArg(args, ['text', 'Text', 'message', 'Message'])
      return !(wantText && cText && cText !== wantText)
    }, toolCallId)
  }
  if (variant === 'SwarmWait') {
    const candidates = collectTranscriptGenericOutputs(sessionId, SWARM_WAIT_NAMES, unwrapOutput, customBrainRoots)
    if (candidates.length === 0) return undefined
    const wantSince = pickNumberArg(rawInput, ['since', 'Since'])
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cSince = pickNumberArg(args, ['since', 'Since'])
      return !(wantSince !== undefined && cSince !== undefined && cSince !== wantSince)
    }, toolCallId)
  }
  return undefined
}
