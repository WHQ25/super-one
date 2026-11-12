import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { PermissionMode } from '@superone/shared/agent-types'
import { looksLikeComputerUseOutline } from '@superone/shared/computer-use-result-shape'
import { looksLikeSessionArchiveToon } from '@superone/shared/session-archive-result-shape'
import { claudeMcpToolRuleName, formatAgentToolOutput, isSuperoneMcpServerName, parseMcpToolName, SUPERONE_KNOWN_MCP_BARE_TOOLS } from '@superone/shared/tool-ui'
import {
  applyAntigravityBuiltinToolInput, compactDiffPair, inferAntigravityWireTool,
  isAntigravityNonBashExecuteTool, isAntigravityTranscriptOutputTool, resolveAntigravityTranscriptToolOutput,
} from './antigravity-manage-task'
import {
  antigravityPermissionDisposition, antigravityPermissionMode, consumeAntigravityAnsweredQuestionSummary,
  extractAntigravityElicitationQuestion, extractAntigravitySecurityWarning, extractAntigravityToolNameFromTitle,
  extractAntigravityUserInputQuestion, isAntigravitySandboxBypassRequest, isAntigravityUserInputRequest,
  makeAntigravityElicitationResponse, makeAntigravityUserInputResponse, selectAntigravityAutoApprovedOptionId,
  type AntigravityElicitationCreateResult,
} from './antigravity-permission'
export {
  antigravityPermissionDisposition, antigravityPermissionMode, extractAntigravityElicitationQuestion,
  extractAntigravitySecurityWarning, extractAntigravityToolNameFromTitle, extractAntigravityUserInputQuestion,
  isAntigravitySandboxBypassRequest, isAntigravityUserInputRequest, makeAntigravityElicitationResponse,
  makeAntigravityUserInputResponse, selectAntigravityAutoApprovedOptionId, type AntigravityElicitationCreateResult,
}

const TOOL_TEXT_LIMIT = 8_000
const TOOL_TEXT_TRUNCATED = '[Earlier output truncated]\n\n'
const MAX_SPILLED_OUTPUT_BYTES = 2 * 1024 * 1024
const STEP_TIMESTAMP_HEADER_RE = /^(?:Created At:\s*[^\r\n]+\r?\n(?:Completed At:\s*[^\r\n]+\r?\n)?|Completed At:\s*[^\r\n]+\r?\n)/
const SPILLED_STEP_OUTPUT_RE =
  /^(?:(?:The output was large and was saved to|Result saved to URI):\s*|The tool's output was truncated due to being too long\.\s*You can find the full output in a file at\s+)(file:\/\/[^\r\n]+?|\/[^\r\n]+?)\.?\s*(?:\r?\n|$)/
const STEP_COMMAND_OUTPUT_HEADER_RE =
  /^(?:The command|Command) exited with code -?\d+\.\r?\n(?:\r?\n)?(?:Command output|Output):\r?\n/
const STEP_COMMAND_NO_OUTPUT_RE =
  /^(?:The command|Command) exited with code 0\.\r?\n(?:\r?\n)?No output(?: from the command)?\.?\s*$/
const SUBAGENT_TITLES = new Set([
  'Running start_subagent', 'Run start_subagent', 'Run start_subagent?', 'Running start subagent', 'Run start subagent',
  'Running invoke_subagent', 'Run invoke_subagent', 'Run invoke_subagent?', 'Running invoke subagent', 'Run invoke subagent',
  'start_subagent', 'invoke_subagent',
])

export const ANTIGRAVITY_CLIENT_INFO = { name: 'zed', version: '0.0.0' } as const

export function antigravitySessionMeta(mode?: PermissionMode | null, systemPromptAppend?: string | null): Record<string, unknown> {
  const prompt = systemPromptAppend?.trim()
  return {
    antigravity: {
      disabledTools: ['run_workflow'],
      ...(mode ? { modeId: antigravityPermissionMode(mode) } : {}),
      ...(prompt ? { systemPrompt: { append: prompt } } : {}),
    },
  }
}

function copyBoundedText(text: string): string {
  return Buffer.from(text, 'utf16le').toString('utf16le')
}

function readSpilledStepOutput(target: string): string | null {
  try {
    const trimmed = target.trim().replace(/\.$/, '')
    const filePath = trimmed.startsWith('file://') ? fileURLToPath(trimmed) : trimmed
    const normalized = filePath.replace(/\\/g, '/')
    if (!normalized.includes('/.system_generated/steps/') || !normalized.endsWith('/output.txt')) return null
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size > MAX_SPILLED_OUTPUT_BYTES) return null
    return readFileSync(filePath, 'utf8').replace(STEP_TIMESTAMP_HEADER_RE, '')
  } catch {
    return null
  }
}

export function unwrapAntigravityToolOutputText(text: string): string {
  const stripped = text.replace(STEP_TIMESTAMP_HEADER_RE, '')
  const match = SPILLED_STEP_OUTPUT_RE.exec(stripped.trim())
  const resolved = (match?.[1] && readSpilledStepOutput(match[1])) ?? stripped
  if (STEP_COMMAND_NO_OUTPUT_RE.test(resolved)) return ''
  return resolved.replace(STEP_COMMAND_OUTPUT_HEADER_RE, '')
}

function shouldPreserveFullToolText(trimmed: string): boolean {
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { JSON.parse(trimmed); return true } catch { void 0 }
  }
  return (
    looksLikeSessionArchiveToon(trimmed) ||
    looksLikeComputerUseOutline(trimmed) ||
    /^(?:environmentId:\s*\S+\r?\n\r?\n)?#\s+Session\b/.test(trimmed)
  )
}

function boundText(text: string, limit = TOOL_TEXT_LIMIT): string {
  if (text.length <= limit || shouldPreserveFullToolText(text.trim())) return text
  return copyBoundedText(`${TOOL_TEXT_TRUNCATED}${text.slice(-limit)}`)
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === 'object' && !Array.isArray(val))
}

interface ToolPayloadBudget {
  nodes: number
  text: number
  preserveText?: boolean
  unwrapOutput?: boolean
}

function sanitizeToolValue(value: unknown, budget: ToolPayloadBudget, depth: number): unknown {
  if (depth > 12 || budget.nodes-- <= 0) return undefined
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value) || budget.text <= 0) return undefined
    const raw = budget.unwrapOutput ? unwrapAntigravityToolOutputText(value) : value
    const text = budget.preserveText ? raw : boundText(raw, Math.min(TOOL_TEXT_LIMIT, budget.text))
    budget.text -= Math.min(text.length, TOOL_TEXT_LIMIT)
    return text
  }
  if (Array.isArray(value)) {
    const result: unknown[] = []
    for (const entry of value) {
      if (budget.nodes <= 0) break
      const sanitized = sanitizeToolValue(entry, budget, depth + 1)
      if (sanitized !== undefined) result.push(sanitized)
    }
    return result
  }
  if (!isRecord(value)) return value
  const childBudget = value.type === 'diff' ? { ...budget, preserveText: true, unwrapOutput: false } : budget
  const entries: Array<[string, unknown]> = []
  for (const [key, entry] of Object.entries(value)) {
    if (childBudget.nodes <= 0) break
    if (
      (value.type === 'image' && (key === 'data' || key === 'blob')) ||
      (key === 'blob' && typeof value.mimeType === 'string' && value.mimeType.startsWith('image/')) ||
      ((key === 'formatted_output' || key === 'formattedOutput') &&
        (entry === value.combinedOutput || entry === value.combined_output))
    ) {
      continue
    }
    const sanitized = sanitizeToolValue(entry, childBudget, depth + 1)
    if (sanitized !== undefined) entries.push([key, sanitized])
  }
  budget.nodes = childBudget.nodes
  budget.text = childBudget.text
  return Object.fromEntries(entries)
}

export function sanitizeAntigravityToolPayload(payload: unknown, preserveText = false): unknown {
  return sanitizeToolValue(payload, { nodes: 512, text: 512_000, preserveText, unwrapOutput: true }, 0)
}

export function sanitizeAntigravityToolInput(payload: unknown): unknown {
  return sanitizeToolValue(payload, { nodes: 512, text: 512_000, preserveText: true }, 0)
}

function pickNonEmptyString(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const val = obj[key]
    if (typeof val === 'string' && val.trim()) return val.trim()
  }
  return undefined
}

function pickExactString(obj: Record<string, unknown>, keys: readonly string[], allowEmpty = false): string | undefined {
  for (const key of keys) {
    const val = obj[key]
    if (typeof val === 'string' && (allowEmpty || val.length > 0)) return val
  }
  return undefined
}

function pickNumber(obj: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const val = obj[key]
    if (typeof val === 'number' && Number.isFinite(val)) return val
  }
  return undefined
}

function canonicalAntigravityMcpServer(server: string): string {
  return isSuperoneMcpServerName(server) ? 'superone' : server
}

function parseMcpArgumentsRecord(rawArgs: unknown): Record<string, unknown> | null {
  if (isRecord(rawArgs)) return rawArgs
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (isRecord(parsed)) return parsed
      } catch {
        return null
      }
    }
  }
  return null
}

function resolveAntigravityMcpMeta(
  title: string | undefined,
  strippedName: string | undefined,
  meta: unknown,
  kind?: string | null,
  rawInput?: unknown,
): { server: string; tool: string; prompt?: string } | null {
  const metaObj = isRecord(meta) ? meta : null
  const mcpObj = metaObj && isRecord(metaObj.mcp) ? metaObj.mcp : null
  const prompt = metaObj && typeof metaObj.prompt === 'string' && metaObj.prompt.trim() ? metaObj.prompt.trim() : undefined
  if (mcpObj && typeof mcpObj.server === 'string' && typeof mcpObj.tool === 'string') {
    const server = canonicalAntigravityMcpServer(mcpObj.server.trim())
    const tool = mcpObj.tool.trim()
    if (server && tool) return { server, tool, ...(prompt ? { prompt } : {}) }
  }
  const inObj = isRecord(rawInput) ? rawInput : null
  if (kind === 'execute' || (inObj && pickNonEmptyString(inObj, ['command', 'CommandLine', 'command_line', 'commandLine']))) {
    return null
  }
  if (inObj) {
    const server = pickNonEmptyString(inObj, ['server', 'ServerName', 'serverName', 'server_name'])
    const tool = pickNonEmptyString(inObj, ['tool', 'ToolName', 'toolName', 'tool_name'])
    if (server && tool) {
      return { server: canonicalAntigravityMcpServer(server), tool, ...(prompt ? { prompt } : {}) }
    }
  }
  for (const candidate of [strippedName, title]) {
    if (!candidate) continue
    const parsed = parseMcpToolName(candidate.trim())
    if (parsed) return { server: canonicalAntigravityMcpServer(parsed.serverName), tool: parsed.mcpToolName, ...(prompt ? { prompt } : {}) }
  }
  if (
    strippedName &&
    SUPERONE_KNOWN_MCP_BARE_TOOLS.has(strippedName) &&
    (metaObj?.is_mcp_tool_call === true || kind === 'other' || kind == null)
  ) {
    return { server: 'superone', tool: strippedName, ...(prompt ? { prompt } : {}) }
  }
  return null
}

function setStringIfMissing(target: Record<string, unknown>, key: string, val: string | undefined): void {
  if (val !== undefined && typeof target[key] !== 'string') target[key] = val
}

export function normalizeAntigravityRawInput(
  rawInput: unknown, rawOutput?: unknown, title?: string, meta?: unknown, kind?: string | null, toolNameHint?: string,
): {
  rawInput: Record<string, unknown>; inferredKind?: 'execute' | 'other'; isSubagent?: boolean;
  wasWireInferred?: boolean; normalizedTitle?: string; normalizedMeta?: Record<string, unknown>
} {
  const sanitizedIn = sanitizeAntigravityToolInput(rawInput)
  const inObj = isRecord(sanitizedIn) ? { ...sanitizedIn } : {}
  const outObj = isRecord(rawOutput) ? rawOutput : {}
  const strippedToolName = extractAntigravityToolNameFromTitle(title) ?? extractAntigravityToolNameFromTitle(toolNameHint)
  const mcpInfo = resolveAntigravityMcpMeta(title, strippedToolName, meta, kind, inObj)

  if (mcpInfo) {
    const rawArgs = parseMcpArgumentsRecord(inObj.arguments) ?? parseMcpArgumentsRecord(inObj.Arguments) ?? {}
    const inner = { ...rawArgs }
    for (const [k, v] of Object.entries(inObj)) {
      if (
        k !== 'arguments' && k !== 'Arguments' && k !== 'server' && k !== 'ServerName' &&
        k !== 'serverName' && k !== 'server_name' && k !== 'tool' && k !== 'ToolName' &&
        k !== 'toolName' && k !== 'tool_name' && k !== 'toolAction' && k !== 'toolSummary' && !(k in inner)
      ) {
        inner[k] = v
      }
    }
    const baseMeta = isRecord(meta) ? { ...meta } : {}
    baseMeta.mcp = { server: mcpInfo.server, tool: mcpInfo.tool }
    baseMeta.is_mcp_tool_call = true
    return {
      rawInput: inner,
      normalizedTitle: mcpInfo.prompt ?? claudeMcpToolRuleName(mcpInfo.server, mcpInfo.tool),
      normalizedMeta: baseMeta,
    }
  }

  const cmd = pickNonEmptyString(inObj, ['command', 'CommandLine', 'command_line', 'commandLine']) ??
    pickNonEmptyString(outObj, ['commandLine', 'command_line', 'CommandLine', 'command'])
  setStringIfMissing(inObj, 'command', cmd)
  const cwd = pickNonEmptyString(inObj, ['cwd', 'Cwd', 'WorkingDirectory', 'working_dir', 'workingDir']) ??
    pickNonEmptyString(outObj, ['workingDir', 'working_dir', 'WorkingDirectory', 'Cwd', 'cwd'])
  setStringIfMissing(inObj, 'cwd', cwd)
  const summaryDesc = pickNonEmptyString(inObj, ['description', 'toolSummary', 'toolAction'])
  setStringIfMissing(inObj, 'description', summaryDesc)
  if (inObj.IsDaemon === true && inObj.run_in_background === undefined) inObj.run_in_background = true

  const subagentsArr = Array.isArray(inObj.Subagents) ? inObj.Subagents : Array.isArray(inObj.subagents) ? inObj.subagents : null
  const firstSubagent = subagentsArr?.find((entry) => isRecord(entry)) as Record<string, unknown> | undefined
  const pickFromSubagent = (keys: readonly string[]) =>
    pickNonEmptyString(inObj, keys) ?? (firstSubagent ? pickNonEmptyString(firstSubagent, keys) : undefined)
  const isSubagentTitle =
    (typeof title === 'string' && SUBAGENT_TITLES.has(title.trim())) ||
    (typeof strippedToolName === 'string' && SUBAGENT_TITLES.has(strippedToolName)) ||
    (typeof toolNameHint === 'string' && SUBAGENT_TITLES.has(toolNameHint.trim())) ||
    (typeof inObj.TypeName === 'string' && typeof inObj.Prompt === 'string') ||
    Boolean(firstSubagent)
  if (isSubagentTitle && !(isRecord(meta) && meta.is_mcp_tool_call === true)) {
    inObj.variant = 'Agent'
    if (inObj.run_in_background === undefined) inObj.run_in_background = true
    setStringIfMissing(inObj, 'subagent_type', pickFromSubagent(['subagent_type', 'TypeName', 'type_name', 'agent_type', 'type']))
    setStringIfMissing(inObj, 'prompt', pickFromSubagent(['prompt', 'Prompt', 'task', 'objective']))
    const model = pickFromSubagent(['model', 'Model'])
    if (model && model !== 'inherit') setStringIfMissing(inObj, 'model', model)
    const explicitRole = pickFromSubagent(['Role', 'role'])
    const hadExplicitDescription = isRecord(sanitizedIn) && typeof sanitizedIn.description === 'string' && sanitizedIn.description.trim().length > 0
    if (explicitRole && !hadExplicitDescription) inObj.description = explicitRole
    else if (!inObj.description) inObj.description = explicitRole ?? pickFromSubagent(['Prompt', 'task', 'prompt', 'objective', 'name']) ?? 'Subagent'
    return { rawInput: inObj, isSubagent: true, normalizedTitle: typeof inObj.description === 'string' ? inObj.description : strippedToolName }
  }

  const { mappedUiName, inferredTitle } = inferAntigravityWireTool(strippedToolName, title, kind, inObj, true)
  setStringIfMissing(inObj, 'variant', mappedUiName ?? undefined)
  if (mappedUiName === 'ImageGen' || mappedUiName === 'ImageEdit') {
    setStringIfMissing(inObj, 'prompt', pickNonEmptyString(inObj, ['prompt', 'Prompt', 'description', 'text']))
    setStringIfMissing(inObj, 'aspect_ratio', pickNonEmptyString(inObj, ['aspect_ratio', 'aspectRatio', 'AspectRatio']))
  }
  applyAntigravityBuiltinToolInput(mappedUiName, inObj, strippedToolName)
  const isFileTool = mappedUiName === 'Read' || mappedUiName === 'Write' || mappedUiName === 'Edit' || mappedUiName === 'Delete'
  const fileKeys = ['file_path', 'AbsolutePath', 'TargetFile', 'FilePath', 'filePath', 'target_file']
  setStringIfMissing(inObj, 'file_path', pickNonEmptyString(inObj, isFileTool ? [...fileKeys, 'Path', 'path'] : fileKeys))
  if (mappedUiName === 'LS' || mappedUiName === 'Glob' || mappedUiName === 'Grep' || !inObj.file_path) {
    setStringIfMissing(inObj, 'path', pickNonEmptyString(inObj, ['path', 'DirectoryPath', 'SearchDirectory', 'SearchPath', 'Path', 'Directory', 'target_directory']))
  }
  const startLine = pickNumber(inObj, ['offset', 'StartLine', 'start_line', 'startLine'])
  const endLine = pickNumber(inObj, ['EndLine', 'end_line', 'endLine'])
  if (startLine !== undefined && inObj.offset === undefined) inObj.offset = startLine
  if (endLine !== undefined && inObj.limit === undefined) inObj.limit = startLine !== undefined && endLine >= startLine ? endLine - startLine + 1 : endLine
  setStringIfMissing(inObj, 'content', pickExactString(inObj, ['content', 'CodeContent', 'Content', 'contents', 'fileText']))

  const firstChunk = Array.isArray(inObj.ReplacementChunks)
    ? (inObj.ReplacementChunks.find((c) => isRecord(c)) as Record<string, unknown> | undefined)
    : undefined
  const oldStr = pickExactString(inObj, ['old_string', 'Target', 'TargetContent', 'oldString', 'oldText']) ??
    (firstChunk && typeof firstChunk.TargetContent === 'string' ? firstChunk.TargetContent : undefined)
  const newStr = pickExactString(inObj, ['new_string', 'Replacement', 'ReplacementContent', 'newString', 'newText'], true) ??
    (firstChunk && typeof firstChunk.ReplacementContent === 'string' ? firstChunk.ReplacementContent : undefined)
  setStringIfMissing(inObj, 'old_string', oldStr)
  setStringIfMissing(inObj, 'new_string', newStr)
  if (mappedUiName !== 'WebSearch') setStringIfMissing(inObj, 'pattern', pickNonEmptyString(inObj, ['pattern', 'Pattern', 'Query', 'query']))
  setStringIfMissing(inObj, 'query', pickNonEmptyString(inObj, ['query', 'Query', 'q', 'search']))
  setStringIfMissing(inObj, 'url', pickNonEmptyString(inObj, ['url', 'Url', 'Uri', 'uri']))

  const normalizedTitle = strippedToolName ?? inferredTitle ??
    (typeof title === 'string' && (title === 'Run command' || title === 'Run command?') && summaryDesc ? summaryDesc : title)
  return {
    rawInput: inObj,
    ...(cmd ? { inferredKind: 'execute' as const } : {}),
    ...(inferredTitle ? { wasWireInferred: true } : {}),
    ...(normalizedTitle !== undefined ? { normalizedTitle } : {}),
  }
}

const knownAntigravityMcpCalls = new Set<string>()
const knownAntigravityBashCalls = new Set<string>()
const knownAntigravitySubagentInputs = new Map<string, Record<string, unknown>>()
const MAX_KNOWN_ANTIGRAVITY_MCP_CALLS = 1000

function recordBoundedSet(set: Set<string>, id: string): void {
  if (set.size >= MAX_KNOWN_ANTIGRAVITY_MCP_CALLS) {
    const oldest = set.values().next().value
    if (oldest) set.delete(oldest)
  }
  set.add(id)
}

function recordAntigravitySubagentInput(id: string, input: Record<string, unknown>): void {
  if (knownAntigravitySubagentInputs.size >= MAX_KNOWN_ANTIGRAVITY_MCP_CALLS) {
    const oldest = knownAntigravitySubagentInputs.keys().next().value
    if (oldest) knownAntigravitySubagentInputs.delete(oldest)
  }
  knownAntigravitySubagentInputs.set(id, input)
}

export function normalizeAntigravitySessionUpdate(
  update: SessionUpdate,
  sessionId?: string,
  brainRoots?: string[],
): SessionUpdate {
  if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') return update
  const titleStr = typeof update.title === 'string' ? update.title : undefined
  const rawNameStr = typeof (update as { name?: unknown }).name === 'string' ? (update as { name: string }).name : undefined
  const strippedToolName = extractAntigravityToolNameFromTitle(titleStr) ?? extractAntigravityToolNameFromTitle(rawNameStr)
  const metaVal = (update as { _meta?: unknown })._meta
  let isMcp = Boolean(resolveAntigravityMcpMeta(titleStr, strippedToolName, metaVal, update.kind, update.rawInput))
  const effectiveRawInput =
    update.rawInput !== undefined
      ? update.rawInput
      : (update.toolCallId ? knownAntigravitySubagentInputs.get(update.toolCallId) : undefined)
  const inObj = isRecord(effectiveRawInput) ? effectiveRawInput : null
  const outObj = isRecord(update.rawOutput) ? update.rawOutput : null
  const { mappedUiName } = inferAntigravityWireTool(strippedToolName, titleStr, update.kind, inObj ?? {})
  let isBash =
    !isMcp &&
    (mappedUiName === 'Bash' ||
      (update.kind === 'execute' && !isAntigravityNonBashExecuteTool(mappedUiName)) ||
      Boolean(inObj && pickNonEmptyString(inObj, ['command', 'CommandLine', 'command_line', 'commandLine'])) ||
      Boolean(
        outObj &&
          (typeof outObj.combinedOutput === 'string' ||
            typeof outObj.combined_output === 'string' ||
            typeof outObj.stdout === 'string' ||
            pickNonEmptyString(outObj, ['commandLine', 'command_line', 'CommandLine', 'command'])),
      ))
  if (update.toolCallId) {
    if (isMcp) {
      recordBoundedSet(knownAntigravityMcpCalls, update.toolCallId)
    } else if (knownAntigravityMcpCalls.has(update.toolCallId)) {
      isMcp = true
    }
    if (isBash) {
      recordBoundedSet(knownAntigravityBashCalls, update.toolCallId)
    } else if (!isMcp && knownAntigravityBashCalls.has(update.toolCallId)) {
      isBash = true
    }
    if (update.status === 'completed' || update.status === 'failed') {
      knownAntigravityMcpCalls.delete(update.toolCallId)
      knownAntigravityBashCalls.delete(update.toolCallId)
      knownAntigravitySubagentInputs.delete(update.toolCallId)
    }
  }
  const replaceContentWithOutput = isMcp || isBash
  let sanitizedOutput =
    update.rawOutput !== undefined ? sanitizeAntigravityToolPayload(update.rawOutput, true) : undefined
  if (isRecord(sanitizedOutput)) {
    const combined =
      typeof sanitizedOutput.combinedOutput === 'string'
        ? sanitizedOutput.combinedOutput
        : typeof sanitizedOutput.combined_output === 'string'
          ? sanitizedOutput.combined_output
          : undefined
    if (combined !== undefined && typeof sanitizedOutput.stdout !== 'string') {
      const exitCode = typeof sanitizedOutput.exitCode === 'number'
        ? sanitizedOutput.exitCode
        : typeof sanitizedOutput.exit_code === 'number' ? sanitizedOutput.exit_code : 0
      sanitizedOutput = { ...sanitizedOutput, stdout: combined, exitCode }
    }
  }
  const normalizedIn = normalizeAntigravityRawInput(effectiveRawInput, sanitizedOutput, titleStr, metaVal, update.kind, rawNameStr)
  const isTranscriptTool = isAntigravityTranscriptOutputTool(normalizedIn.rawInput.variant)
  if (
    (normalizedIn.isSubagent || normalizedIn.wasWireInferred || normalizedIn.rawInput.variant === 'AskUserQuestion' || normalizedIn.rawInput.variant === 'Edit' || isTranscriptTool) &&
    update.toolCallId && update.status !== 'completed' && update.status !== 'failed' && update.rawInput !== undefined
  ) {
    recordAntigravitySubagentInput(update.toolCallId, normalizedIn.rawInput)
  }
  if (
    isTranscriptTool &&
    (update.status === 'completed' || update.status === 'failed') &&
    sanitizedOutput === undefined &&
    (!Array.isArray(update.content) || update.content.length === 0)
  ) {
    const transcriptOut = resolveAntigravityTranscriptToolOutput(
      normalizedIn.rawInput.variant,
      sessionId,
      normalizedIn.rawInput,
      unwrapAntigravityToolOutputText,
      brainRoots,
    )
    if (transcriptOut) sanitizedOutput = transcriptOut
  }
  if (update.status === 'completed' && update.toolCallId) {
    const answeredQa = consumeAntigravityAnsweredQuestionSummary(update.toolCallId)
    if (answeredQa) {
      if (update.sessionUpdate === 'tool_call_update') {
        return { sessionUpdate: 'tool_call_update', toolCallId: update.toolCallId, status: update.status, rawOutput: answeredQa } as SessionUpdate
      }
      sanitizedOutput = answeredQa
    }
  }
  const contentBudget: ToolPayloadBudget = { nodes: 512, text: 512_000, preserveText: true, unwrapOutput: true }
  let sanitizedContent = Array.isArray(update.content)
    ? (sanitizeToolValue(update.content, contentBudget, 0) as typeof update.content)
    : update.content
  if (Array.isArray(sanitizedContent)) {
    const hasMultiChunks = Array.isArray(normalizedIn.rawInput.ReplacementChunks) && normalizedIn.rawInput.ReplacementChunks.length > 1
    const oldIn = !hasMultiChunks && typeof normalizedIn.rawInput.old_string === 'string' ? normalizedIn.rawInput.old_string : undefined
    const newIn = !hasMultiChunks && typeof normalizedIn.rawInput.new_string === 'string' ? normalizedIn.rawInput.new_string : undefined
    sanitizedContent = sanitizedContent.map((item) => {
      if (!isRecord(item) || item.type !== 'diff' || typeof item.oldText !== 'string' || !item.oldText || typeof item.newText !== 'string') {
        return item
      }
      if (oldIn !== undefined && newIn !== undefined) return { ...item, oldText: oldIn, newText: newIn }
      return { ...item, ...compactDiffPair(item.oldText, item.newText) }
    }) as typeof update.content
  }

  if ((replaceContentWithOutput || isTranscriptTool) && (update.status === 'completed' || update.status === 'failed') && sanitizedOutput !== undefined) {
    const outText = typeof sanitizedOutput === 'string'
      ? unwrapAntigravityToolOutputText(sanitizedOutput)
      : formatAgentToolOutput(sanitizedOutput)
    sanitizedContent = [{ type: 'content', content: { type: 'text', text: outText } }]
  }

  const nextKind =
    update.kind === undefined || update.kind === null
      ? (normalizedIn.inferredKind ?? (isBash ? 'execute' : undefined))
      : update.kind
  const isSparseCachedUpdate =
    update.sessionUpdate === 'tool_call_update' &&
    effectiveRawInput === undefined &&
    (isMcp || normalizedIn.isSubagent || normalizedIn.rawInput.variant === 'AskUserQuestion')
  const nextTitle = isSparseCachedUpdate ? undefined : (normalizedIn.normalizedTitle ?? titleStr)

  return {
    ...update,
    ...(nextKind !== undefined && nextKind !== null ? { kind: nextKind } : {}),
    ...(typeof nextTitle === 'string' ? { title: boundText(nextTitle) } : isSparseCachedUpdate ? { title: undefined } : {}),
    ...(normalizedIn.normalizedMeta !== undefined ? { _meta: normalizedIn.normalizedMeta } : {}),
    ...(!isSparseCachedUpdate && (effectiveRawInput !== undefined || Object.keys(normalizedIn.rawInput).length > 0)
      ? { rawInput: normalizedIn.rawInput }
      : {}),
    ...(sanitizedOutput !== undefined ? { rawOutput: sanitizedOutput } : {}),
    ...(sanitizedContent !== undefined ? { content: sanitizedContent } : {}),
  } as SessionUpdate
}
