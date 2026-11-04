import type { PermissionOption, RequestPermissionRequest, RequestPermissionResponse, SessionUpdate } from '@agentclientprotocol/sdk'
import type { PermissionMode } from '@superone/shared/agent-types'
import { BUILT_IN_SUPERONE_TOOL_NAMES, COMPUTER_USE_TOOL_NAMES, MINIAPP_CALL_BARE_NAME, MINIAPP_LIST_BARE_NAME } from '@superone/shared/superone-host-owned-tools'
import { claudeMcpToolRuleName, parseMcpToolName, uiToolNameFromId } from '@superone/shared/tool-ui'
import type { GrokAskUserQuestionParams } from './acp-xai-extensions'

const TOOL_TEXT_LIMIT = 8_000
const TOOL_TEXT_TRUNCATED = '[Earlier output truncated]\n\n'
const QUESTION_LABEL_LIMIT = 512
const WARNING_TEXT_LIMIT = 512
const SECURITY_WARNING_META_KEY = 'agy.security.warning'
const READ_ONLY_TOOL_KINDS = new Set(['read', 'search', 'think'])
const MUTATION_TOOL_KINDS = new Set(['edit', 'delete', 'move'])
const SUBAGENT_TITLES = new Set([
  'Running start_subagent', 'Run start_subagent?', 'Running invoke_subagent', 'Run invoke_subagent?', 'start_subagent', 'invoke_subagent',
])
const SUPERONE_MCP_BARE_TOOLS = new Set<string>([
  ...BUILT_IN_SUPERONE_TOOL_NAMES, ...COMPUTER_USE_TOOL_NAMES, MINIAPP_CALL_BARE_NAME, MINIAPP_LIST_BARE_NAME,
])

export function extractAntigravityToolNameFromTitle(title: string | undefined | null): string | undefined {
  if (typeof title !== 'string') return undefined
  const trimmed = title.trim()
  if (!trimmed) return undefined
  return /^Running\s+([a-zA-Z0-9_.:-]+)$/.exec(trimmed)?.[1] ?? /^Run\s+([a-zA-Z0-9_.:-]+)\?$/.exec(trimmed)?.[1]
}

export const ANTIGRAVITY_CLIENT_INFO = { name: 'zed', version: '0.0.0' } as const

export function antigravitySessionMeta(
  mode?: PermissionMode | null,
  systemPromptAppend?: string | null,
): Record<string, unknown> {
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

function boundText(text: string, limit = TOOL_TEXT_LIMIT): string {
  if (text.length <= limit) return text
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try { JSON.parse(trimmed); return text } catch { void 0 }
  }
  return copyBoundedText(`${TOOL_TEXT_TRUNCATED}${text.slice(-limit)}`)
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === 'object' && !Array.isArray(val))
}

export function isAntigravityUserInputRequest(request: RequestPermissionRequest): boolean {
  return typeof request.toolCall?.toolCallId === 'string' && request.toolCall.toolCallId.startsWith('interaction_')
}

export function extractAntigravitySecurityWarning(options: ReadonlyArray<PermissionOption>): string | undefined {
  for (const option of options) {
    const meta = (option as { _meta?: unknown })._meta
    if (!isRecord(meta)) continue
    const rawWarning = meta[SECURITY_WARNING_META_KEY]
    if (!isRecord(rawWarning)) continue
    const message =
      (typeof rawWarning.message === 'string' && rawWarning.message.trim()) ||
      (typeof rawWarning.title === 'string' && rawWarning.title.trim()) || ''
    if (!message) continue
    return message.length > WARNING_TEXT_LIMIT ? copyBoundedText(`${message.slice(0, WARNING_TEXT_LIMIT - 3)}...`) : message
  }
  return undefined
}

function questionOptionLabel(option: PermissionOption): string {
  const label = (typeof option.name === 'string' ? option.name.trim() : '') || option.optionId
  return label.length > QUESTION_LABEL_LIMIT ? copyBoundedText(`${label.slice(0, QUESTION_LABEL_LIMIT - 3)}...`) : label
}

export function extractAntigravityUserInputQuestion(request: RequestPermissionRequest): GrokAskUserQuestionParams | null {
  if (!isAntigravityUserInputRequest(request) || request.options.length === 0) return null
  const seen = new Set<string>()
  for (const option of request.options) {
    if (!option.optionId?.trim() || seen.has(option.optionId)) return null
    seen.add(option.optionId)
  }
  const rawTitle = typeof request.toolCall.title === 'string' && request.toolCall.title.trim() ? request.toolCall.title.trim() : 'Choose an option.'
  const questionText = rawTitle.length > TOOL_TEXT_LIMIT ? copyBoundedText(`${rawTitle.slice(0, TOOL_TEXT_LIMIT - 3)}...`) : rawTitle
  return {
    questions: [{
      id: request.toolCall.toolCallId,
      header: 'Question',
      question: questionText,
      multiSelect: false,
      options: request.options.map((option) => {
        const label = questionOptionLabel(option)
        return { label, description: label }
      }),
    }],
  }
}

export function makeAntigravityUserInputResponse(request: RequestPermissionRequest, response: Record<string, unknown>): RequestPermissionResponse {
  if (response.outcome === 'cancelled' || response.cancelled === true) return { outcome: { outcome: 'cancelled' } }
  const answersObj = isRecord(response.answers) ? response.answers : response
  let candidate: string | undefined
  const byId = answersObj[request.toolCall.toolCallId]
  if (typeof byId === 'string' && byId.trim()) candidate = byId.trim()
  else if (Array.isArray(byId) && typeof byId[0] === 'string' && byId[0].trim()) candidate = byId[0].trim()
  else {
    for (const val of Object.values(answersObj)) {
      if (typeof val === 'string' && val.trim()) { candidate = val.trim(); break }
      if (Array.isArray(val) && typeof val[0] === 'string' && val[0].trim()) { candidate = val[0].trim(); break }
    }
  }
  if (!candidate) return { outcome: { outcome: 'cancelled' } }
  const exact = request.options.find((opt) => opt.optionId === candidate)
  if (exact) return { outcome: { outcome: 'selected', optionId: exact.optionId } }
  const byLabel = request.options.filter((opt) => questionOptionLabel(opt) === candidate)
  if (byLabel.length === 1 && byLabel[0]) return { outcome: { outcome: 'selected', optionId: byLabel[0].optionId } }
  return { outcome: { outcome: 'cancelled' } }
}

export function antigravityPermissionMode(mode: PermissionMode | undefined | null): string {
  switch (mode) {
    case 'bypassPermissions': return 'yolo'
    case 'acceptEdits': return 'auto_edit'
    case 'auto': return 'auto'
    case 'plan':
    case 'default':
    default: return 'default'
  }
}

export function antigravityPermissionDisposition(mode: PermissionMode | undefined | null, request: RequestPermissionRequest): 'allow' | 'ask' {
  if (isAntigravityUserInputRequest(request)) return 'ask'
  const kind = request.toolCall?.kind
  if (typeof kind === 'string' && READ_ONLY_TOOL_KINDS.has(kind)) return 'allow'
  switch (mode) {
    case 'bypassPermissions': return 'allow'
    case 'acceptEdits': return typeof kind === 'string' && MUTATION_TOOL_KINDS.has(kind) ? 'allow' : 'ask'
    case 'auto':
    case 'plan':
    case 'default':
    default: return 'ask'
  }
}

export function selectAntigravityAutoApprovedOptionId(request: RequestPermissionRequest): string | null {
  const allowOnce = request.options.find((opt) => opt.kind === 'allow_once')
  if (allowOnce?.optionId) return allowOnce.optionId
  return request.options.find((opt) => opt.kind === 'allow_always')?.optionId ?? null
}

interface ToolPayloadBudget {
  nodes: number
  text: number
}

function sanitizeToolValue(value: unknown, budget: ToolPayloadBudget, depth: number): unknown {
  if (depth > 12 || budget.nodes-- <= 0) {
    return undefined
  }
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value) || budget.text <= 0) {
      return undefined
    }
    const text = boundText(value, Math.min(TOOL_TEXT_LIMIT, budget.text))
    budget.text -= text.length
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
  if (!isRecord(value)) {
    return value
  }
  const entries: Array<[string, unknown]> = []
  for (const [key, entry] of Object.entries(value)) {
    if (budget.nodes <= 0) break
    if (
      (value.type === 'image' && (key === 'data' || key === 'blob')) ||
      (key === 'blob' &&
        typeof value.mimeType === 'string' &&
        value.mimeType.startsWith('image/')) ||
      ((key === 'formatted_output' || key === 'formattedOutput') &&
        (entry === value.combinedOutput || entry === value.combined_output))
    ) {
      continue
    }
    const sanitized = sanitizeToolValue(entry, budget, depth + 1)
    if (sanitized !== undefined) entries.push([key, sanitized])
  }
  return Object.fromEntries(entries)
}

export function sanitizeAntigravityToolPayload(payload: unknown): unknown {
  return sanitizeToolValue(payload, { nodes: 512, text: 64_000 }, 0)
}

function pickNonEmptyString(
  obj: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const val = obj[key]
    if (typeof val === 'string' && val.trim()) return val.trim()
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

function resolveAntigravityMcpMeta(
  title: string | undefined,
  strippedName: string | undefined,
  meta: unknown,
  kind?: string | null,
): { server: string; tool: string; prompt?: string } | null {
  const metaObj = isRecord(meta) ? meta : null
  const mcpObj = metaObj && isRecord(metaObj.mcp) ? metaObj.mcp : null
  const prompt = metaObj && typeof metaObj.prompt === 'string' && metaObj.prompt.trim()
    ? metaObj.prompt.trim()
    : undefined
  if (mcpObj && typeof mcpObj.server === 'string' && typeof mcpObj.tool === 'string') {
    const server = mcpObj.server.trim()
    const tool = mcpObj.tool.trim()
    if (server && tool) return { server, tool, ...(prompt ? { prompt } : {}) }
  }
  for (const candidate of [strippedName, title]) {
    if (!candidate) continue
    const parsed = parseMcpToolName(candidate.trim())
    if (parsed) {
      return {
        server: parsed.serverName,
        tool: parsed.mcpToolName,
        ...(prompt ? { prompt } : {}),
      }
    }
  }
  if (
    strippedName &&
    SUPERONE_MCP_BARE_TOOLS.has(strippedName) &&
    (metaObj?.is_mcp_tool_call === true || kind === 'other' || kind == null)
  ) {
    return {
      server: 'superone',
      tool: strippedName,
      ...(prompt ? { prompt } : {}),
    }
  }
  return null
}

function setStringIfMissing(
  target: Record<string, unknown>,
  key: string,
  val: string | undefined,
  bounded = false,
): void {
  if (val !== undefined && typeof target[key] !== 'string') {
    target[key] = bounded ? boundText(val) : val
  }
}

export function normalizeAntigravityRawInput(
  rawInput: unknown,
  rawOutput?: unknown,
  title?: string,
  meta?: unknown,
  kind?: string | null,
): {
  rawInput: Record<string, unknown>
  inferredKind?: 'execute' | 'other'
  isSubagent?: boolean
  normalizedTitle?: string
  normalizedMeta?: Record<string, unknown>
} {
  const sanitizedIn = sanitizeAntigravityToolPayload(rawInput)
  let inObj = isRecord(sanitizedIn) ? { ...sanitizedIn } : {}
  const outObj = isRecord(rawOutput) ? rawOutput : {}
  const strippedToolName = extractAntigravityToolNameFromTitle(title)
  const mcpInfo = resolveAntigravityMcpMeta(title, strippedToolName, meta, kind)

  if (mcpInfo) {
    if (isRecord(inObj.arguments)) {
      const inner = { ...(inObj.arguments as Record<string, unknown>) }
      for (const [k, v] of Object.entries(inObj)) {
        if (k !== 'arguments' && k !== 'server' && k !== 'tool' && !(k in inner)) inner[k] = v
      }
      inObj = inner
    }
    const baseMeta = isRecord(meta) ? { ...meta } : {}
    baseMeta.mcp = { server: mcpInfo.server, tool: mcpInfo.tool }
    baseMeta.is_mcp_tool_call = true
    return {
      rawInput: inObj,
      normalizedTitle: mcpInfo.prompt ?? claudeMcpToolRuleName(mcpInfo.server, mcpInfo.tool),
      normalizedMeta: baseMeta,
    }
  }

  const cmd =
    pickNonEmptyString(inObj, ['command', 'CommandLine', 'command_line', 'commandLine']) ??
    pickNonEmptyString(outObj, ['commandLine', 'command_line', 'CommandLine', 'command'])
  setStringIfMissing(inObj, 'command', cmd, true)

  const cwd =
    pickNonEmptyString(inObj, ['cwd', 'Cwd', 'WorkingDirectory', 'working_dir', 'workingDir']) ??
    pickNonEmptyString(outObj, ['workingDir', 'working_dir', 'WorkingDirectory', 'Cwd', 'cwd'])
  setStringIfMissing(inObj, 'cwd', cwd, true)

  const summaryDesc = pickNonEmptyString(inObj, ['description', 'toolSummary', 'toolAction'])
  setStringIfMissing(inObj, 'description', summaryDesc, true)

  if (inObj.IsDaemon === true && inObj.run_in_background === undefined) {
    inObj.run_in_background = true
  }

  const isSubagentTitle =
    (typeof title === 'string' && SUBAGENT_TITLES.has(title)) ||
    (typeof strippedToolName === 'string' && SUBAGENT_TITLES.has(strippedToolName))
  const isMcp = isRecord(meta) && meta.is_mcp_tool_call === true
  if (isSubagentTitle && !isMcp) {
    inObj.variant = 'Agent'
    setStringIfMissing(inObj, 'subagent_type', pickNonEmptyString(inObj, ['subagent_type', 'TypeName', 'agent_type', 'type']))
    setStringIfMissing(inObj, 'prompt', pickNonEmptyString(inObj, ['prompt', 'Prompt', 'task', 'objective']), true)
    setStringIfMissing(inObj, 'model', pickNonEmptyString(inObj, ['model', 'Model']))
    if (!inObj.description) {
      inObj.description =
        pickNonEmptyString(inObj, ['Role', 'Prompt', 'task', 'prompt', 'objective', 'name']) ?? 'Subagent'
    }
    return {
      rawInput: inObj,
      isSubagent: true,
      normalizedTitle: typeof inObj.description === 'string' ? inObj.description : strippedToolName,
    }
  }

  const mappedUiName =
    uiToolNameFromId(strippedToolName ?? title) ??
    (typeof inObj.variant === 'string' ? uiToolNameFromId(inObj.variant) ?? inObj.variant : null)
  setStringIfMissing(inObj, 'variant', mappedUiName ?? undefined)

  const isFileTool =
    mappedUiName === 'Read' || mappedUiName === 'Write' || mappedUiName === 'Edit' || mappedUiName === 'Delete'
  setStringIfMissing(
    inObj,
    'file_path',
    pickNonEmptyString(
      inObj,
      isFileTool
        ? ['file_path', 'AbsolutePath', 'TargetFile', 'FilePath', 'filePath', 'target_file', 'Path', 'path']
        : ['file_path', 'AbsolutePath', 'TargetFile', 'FilePath', 'filePath', 'target_file'],
    ),
  )

  if (mappedUiName === 'LS' || mappedUiName === 'Glob' || mappedUiName === 'Grep' || !inObj.file_path) {
    setStringIfMissing(
      inObj,
      'path',
      pickNonEmptyString(inObj, ['path', 'DirectoryPath', 'SearchDirectory', 'SearchPath', 'Path', 'Directory', 'target_directory']),
    )
  }

  const startLine = pickNumber(inObj, ['offset', 'StartLine', 'start_line', 'startLine'])
  const endLine = pickNumber(inObj, ['EndLine', 'end_line', 'endLine'])
  if (startLine !== undefined && inObj.offset === undefined) inObj.offset = startLine
  if (endLine !== undefined && inObj.limit === undefined) {
    inObj.limit = startLine !== undefined && endLine >= startLine ? endLine - startLine + 1 : endLine
  }

  setStringIfMissing(inObj, 'content', pickNonEmptyString(inObj, ['content', 'CodeContent', 'Content', 'contents', 'fileText']))

  const firstChunk = Array.isArray(inObj.ReplacementChunks)
    ? (inObj.ReplacementChunks.find((c) => isRecord(c)) as Record<string, unknown> | undefined)
    : undefined
  const oldStr =
    pickNonEmptyString(inObj, ['old_string', 'Target', 'TargetContent', 'oldString', 'oldText']) ??
    (firstChunk && typeof firstChunk.TargetContent === 'string' ? firstChunk.TargetContent : undefined)
  const newStr =
    (typeof inObj.new_string === 'string' ? inObj.new_string : undefined) ??
    (typeof inObj.Replacement === 'string' ? inObj.Replacement : undefined) ??
    (typeof inObj.ReplacementContent === 'string' ? inObj.ReplacementContent : undefined) ??
    (firstChunk && typeof firstChunk.ReplacementContent === 'string' ? firstChunk.ReplacementContent : undefined)
  setStringIfMissing(inObj, 'old_string', oldStr)
  setStringIfMissing(inObj, 'new_string', newStr)

  if (mappedUiName !== 'WebSearch') {
    setStringIfMissing(inObj, 'pattern', pickNonEmptyString(inObj, ['pattern', 'Pattern', 'Query', 'query']))
  }
  setStringIfMissing(inObj, 'query', pickNonEmptyString(inObj, ['query', 'Query', 'q', 'search']))
  setStringIfMissing(inObj, 'url', pickNonEmptyString(inObj, ['url', 'Url', 'Uri', 'uri']))

  const normalizedTitle =
    strippedToolName ??
    (typeof title === 'string' && (title === 'Run command' || title === 'Run command?') && summaryDesc
      ? summaryDesc
      : title)

  return {
    rawInput: inObj,
    ...(cmd ? { inferredKind: 'execute' as const } : {}),
    ...(normalizedTitle !== undefined ? { normalizedTitle } : {}),
  }
}

export function normalizeAntigravitySessionUpdate(update: SessionUpdate): SessionUpdate {
  if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') {
    return update
  }
  let sanitizedOutput =
    update.rawOutput !== undefined ? sanitizeAntigravityToolPayload(update.rawOutput) : undefined
  if (isRecord(sanitizedOutput)) {
    const combined =
      typeof sanitizedOutput.combinedOutput === 'string'
        ? sanitizedOutput.combinedOutput
        : typeof sanitizedOutput.combined_output === 'string'
          ? sanitizedOutput.combined_output
          : undefined
    if (combined !== undefined && typeof sanitizedOutput.stdout !== 'string') {
      const exitCode =
        typeof sanitizedOutput.exitCode === 'number'
          ? sanitizedOutput.exitCode
          : typeof sanitizedOutput.exit_code === 'number'
            ? sanitizedOutput.exit_code
            : 0
      sanitizedOutput = {
        ...sanitizedOutput,
        stdout: combined,
        exitCode,
      }
    }
  }
  const normalizedIn = normalizeAntigravityRawInput(
    update.rawInput,
    sanitizedOutput,
    typeof update.title === 'string' ? update.title : undefined,
    (update as { _meta?: unknown })._meta,
    update.kind,
  )
  const contentBudget = { nodes: 512, text: 32_000 }
  const sanitizedContent = Array.isArray(update.content)
    ? (sanitizeToolValue(update.content, contentBudget, 0) as typeof update.content)
    : update.content

  const nextKind =
    (update.kind === undefined || update.kind === null) && normalizedIn.inferredKind
      ? normalizedIn.inferredKind
      : update.kind
  const nextTitle = normalizedIn.normalizedTitle ?? (typeof update.title === 'string' ? update.title : undefined)

  return {
    ...update,
    ...(nextKind !== undefined && nextKind !== null ? { kind: nextKind } : {}),
    ...(typeof nextTitle === 'string' ? { title: boundText(nextTitle) } : {}),
    ...(normalizedIn.normalizedMeta !== undefined ? { _meta: normalizedIn.normalizedMeta } : {}),
    ...(update.rawInput !== undefined || Object.keys(normalizedIn.rawInput).length > 0
      ? { rawInput: normalizedIn.rawInput }
      : {}),
    ...(sanitizedOutput !== undefined ? { rawOutput: sanitizedOutput } : {}),
    ...(sanitizedContent !== undefined ? { content: sanitizedContent } : {}),
  } as SessionUpdate
}
