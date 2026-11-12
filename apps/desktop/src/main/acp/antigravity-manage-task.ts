import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeCustomBuiltinInput, uiToolNameFromId } from '@superone/shared/tool-ui'
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

const NON_BASH_EXECUTE_TOOLS = new Set([
  'ImageGen',
  'ImageEdit',
  'TaskOutput',
  'ManageTask',
  'KillTask',
  'NotebookEdit',
])

export function isAntigravityNonBashExecuteTool(mappedUiName: string | null | undefined): boolean {
  return Boolean(mappedUiName && NON_BASH_EXECUTE_TOOLS.has(mappedUiName))
}

function unquoteTitleValue(raw: string): string {
  const trimmed = raw.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function inferAntigravityWireTool(
  strippedToolName: string | undefined,
  title: string | undefined,
  kind: string | null | undefined,
  inObj: Record<string, unknown>,
  mutateInput = false,
): { mappedUiName: string | null; inferredTitle?: string } {
  const direct =
    uiToolNameFromId(strippedToolName ?? title) ??
    (typeof inObj.variant === 'string' ? uiToolNameFromId(inObj.variant) ?? inObj.variant : null)
  if (direct) return { mappedUiName: direct }

  const trimmedTitle = typeof title === 'string' ? title.trim() : ''
  const hasToolField = Boolean(pickStringArg(inObj, ['ToolName', 'tool', 'tool_name']))
  const serverName = pickStringArg(inObj, ['ServerName', 'server_name', 'serverName'])
  const uriVal = pickStringArg(inObj, ['Uri', 'uri'])

  const resourceTitleMatch = /^Resource\s+(.+?)(?:\s+on Web)?$/i.exec(trimmedTitle)
  if (resourceTitleMatch && !/^Resource\s*\(/i.test(trimmedTitle)) {
    const parsedUri = unquoteTitleValue(resourceTitleMatch[1]!)
    if (mutateInput && parsedUri && !inObj.uri && !inObj.Uri) inObj.uri = parsedUri
    return { mappedUiName: 'ReadMcpResource', inferredTitle: 'ReadMcpResource' }
  }
  if (!hasToolField && serverName && uriVal) {
    return { mappedUiName: 'ReadMcpResource', inferredTitle: 'ReadMcpResource' }
  }
  if (!hasToolField && serverName && !uriVal && kind !== 'execute') {
    return { mappedUiName: 'ListMcpResources', inferredTitle: 'ListMcpResources' }
  }

  const urlTitleMatch =
    /^URL\s+(https?:\/\/\S+)$/i.exec(trimmedTitle) ??
    /^\*Opened the URL\s+(https?:\/\/\S+?)\s*\*$/i.exec(trimmedTitle)
  if (urlTitleMatch) {
    if (mutateInput && !inObj.url && !inObj.Url) inObj.url = urlTitleMatch[1]!
    return { mappedUiName: 'WebFetch', inferredTitle: 'WebFetch' }
  }
  const hasExplicitFile = Boolean(
    pickStringArg(inObj, ['file_path', 'AbsolutePath', 'TargetFile', 'FilePath', 'filePath', 'target_file', 'Path', 'path', 'NotebookPath', 'notebookPath']),
  )
  const httpUrl = pickStringArg(inObj, ['Url', 'url'])
  if (kind === 'read' && !hasExplicitFile && httpUrl && /^https?:\/\//i.test(httpUrl)) {
    return { mappedUiName: 'WebFetch', inferredTitle: 'WebFetch' }
  }

  const commandId = pickStringArg(inObj, ['CommandId', 'commandId', 'command_id'])
  const hasSendInput = inObj.Input !== undefined || inObj.input !== undefined || inObj.Terminate !== undefined || inObj.terminate !== undefined
  if (trimmedTitle === 'Waiting for command completion' || (commandId && !hasSendInput)) {
    return { mappedUiName: 'TaskOutput', inferredTitle: 'TaskOutput' }
  }
  if (/^Send\s+.+\s+to command$/i.test(trimmedTitle) || (commandId && hasSendInput)) {
    return { mappedUiName: 'ManageTask', inferredTitle: 'ManageTask' }
  }

  const notebookTitleMatch = /^Notebook\s+(.+)$/.exec(trimmedTitle)
  const notebookPath = pickStringArg(inObj, ['NotebookPath', 'notebookPath', 'notebook_path']) ??
    (notebookTitleMatch ? unquoteTitleValue(notebookTitleMatch[1]!) : undefined)
  if (notebookPath) {
    const nbTool = kind === 'read' ? 'Read' : 'NotebookEdit'
    if (mutateInput) {
      if (!inObj.notebook_path) inObj.notebook_path = notebookPath
      if (!inObj.file_path) inObj.file_path = notebookPath
    }
    return { mappedUiName: nbTool, inferredTitle: nbTool }
  }

  if (trimmedTitle === 'Waiting...' && kind === 'think') {
    return { mappedUiName: 'Wait', inferredTitle: 'Wait' }
  }

  return { mappedUiName: null }
}

export function applyAntigravityManageTaskInput(inObj: Record<string, unknown>): void {
  const normalized = normalizeCustomBuiltinInput('ManageTask', inObj)
  if (normalized) Object.assign(inObj, normalized)
}

export function applyAntigravityManageSubagentsInput(inObj: Record<string, unknown>): void {
  const normalized = normalizeCustomBuiltinInput('ManageSubagents', inObj)
  if (normalized) Object.assign(inObj, normalized)
}

export function applyAntigravityBuiltinToolInput(
  mappedUiName: string | null,
  inObj: Record<string, unknown>,
  strippedToolName?: string,
): void {
  if (!mappedUiName) return
  const normalized = normalizeCustomBuiltinInput(mappedUiName, inObj)
  if (normalized) {
    for (const [key, val] of Object.entries(normalized)) {
      if (inObj[key] === undefined) inObj[key] = val
    }
  }
  if (mappedUiName === 'TaskOutput') {
    const taskId = pickStringArg(inObj, ['task_id', 'taskId', 'CommandId', 'commandId', 'command_id'])
    if (taskId && typeof inObj.task_id !== 'string') inObj.task_id = taskId
  } else if (mappedUiName === 'Wait' && strippedToolName === 'wait_5_seconds' && inObj.durationSeconds === undefined) {
    inObj.durationSeconds = 5
  }
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

const MANAGE_TASK_NAMES = new Set(['manage_task', 'ManageTask', 'send_command_input'])
const MANAGE_SUBAGENTS_NAMES = new Set(['manage_subagents', 'ManageSubagents'])
const SCHEDULE_NAMES = new Set(['schedule', 'Schedule'])
const DEFINE_SUBAGENT_NAMES = new Set(['define_subagent', 'DefineSubagent'])
const SEND_MESSAGE_NAMES = new Set(['send_message', 'SendMessage'])
const LIST_RESOURCES_NAMES = new Set(['list_resources', 'list_mcp_resources', 'ListMcpResources'])
const READ_RESOURCE_NAMES = new Set(['read_resource', 'read_mcp_resource', 'ReadMcpResource'])
const MANAGE_INBOX_NAMES = new Set(['manage_inbox', 'ManageInbox'])

export function resolveAntigravityManageTaskOutput(
  sessionId: string | undefined,
  rawInput: Record<string, unknown>,
  unwrapOutput: (text: string) => string,
  customBrainRoots?: string[],
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
  if (variant === 'Schedule') {
    const candidates = collectTranscriptGenericOutputs(sessionId, SCHEDULE_NAMES, unwrapOutput, customBrainRoots)
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
    })
  }
  if (variant === 'DefineSubagent') {
    const candidates = collectTranscriptGenericOutputs(sessionId, DEFINE_SUBAGENT_NAMES, unwrapOutput, customBrainRoots)
    if (candidates.length === 0) return undefined
    const wantName = pickStringArg(rawInput, ['name', 'Name'])
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cName = pickStringArg(args, ['name', 'Name'])
      return !(wantName && cName && cName !== wantName)
    })
  }
  if (variant === 'SendMessage') {
    const candidates = collectTranscriptGenericOutputs(sessionId, SEND_MESSAGE_NAMES, unwrapOutput, customBrainRoots)
    if (candidates.length === 0) return undefined
    const wantTo = pickStringArg(rawInput, ['to', 'Recipient', 'recipient'])
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cTo = pickStringArg(args, ['to', 'Recipient', 'recipient'])
      return !(wantTo && cTo && cTo !== wantTo)
    })
  }
  if (variant === 'ListMcpResources') {
    const candidates = collectTranscriptGenericOutputs(sessionId, LIST_RESOURCES_NAMES, unwrapOutput, customBrainRoots)
    if (candidates.length === 0) return undefined
    const wantServer = pickStringArg(rawInput, ['server', 'ServerName', 'server_name'])
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cServer = pickStringArg(args, ['server', 'ServerName', 'server_name'])
      return !(wantServer && cServer && cServer !== wantServer)
    })
  }
  if (variant === 'ReadMcpResource') {
    const candidates = collectTranscriptGenericOutputs(sessionId, READ_RESOURCE_NAMES, unwrapOutput, customBrainRoots)
    if (candidates.length === 0) return undefined
    const wantUri = pickStringArg(rawInput, ['uri', 'Uri'])
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cUri = pickStringArg(args, ['uri', 'Uri'])
      return !(wantUri && cUri && cUri !== wantUri)
    })
  }
  if (variant === 'ManageInbox') {
    const candidates = collectTranscriptGenericOutputs(sessionId, MANAGE_INBOX_NAMES, unwrapOutput, customBrainRoots)
    if (candidates.length === 0) return undefined
    const wantAction = pickStringArg(rawInput, ['action', 'Action'])?.toLowerCase()
    return selectMatchingTranscriptOutput(candidates, (args) => {
      const cAction = pickStringArg(args, ['action', 'Action'])?.toLowerCase()
      return !(wantAction && cAction && cAction !== wantAction)
    })
  }
  return undefined
}
