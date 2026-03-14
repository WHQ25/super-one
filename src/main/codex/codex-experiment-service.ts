import { execFileSync, spawn } from 'child_process'
import { mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { basename, extname, join } from 'path'
import { createInterface } from 'readline'
import log from '../logger'
import { trace } from '../agent/event-trace'
import { getActiveProviderRaw } from '../database'
import {
  CODEX_PERMISSION_PRESETS,
  DEFAULT_CODEX_PERMISSION_PRESET,
  DEFAULT_CODEX_PERMISSION_PROFILE,
} from '../../shared/agent-types'
import type {
  AskUserQuestionRequest,
  CodexApprovalMode,
  CodexAuthMode,
  CodexAuthStatus,
  CodexCollaborationMode,
  CodexCollabAgentState,
  CodexCollabAgentStatus,
  CodexCollabTool,
  CodexCollabToolCallItem,
  CodexCommandExecutionStatus,
  CodexCompactRequest,
  CodexMcpToolCallStatus,
  CodexPatchApplyStatus,
  CodexPatchChangeKind,
  CodexPermissionPreset,
  CodexReasoningEffort,
  CodexReviewRequest,
  CodexSandboxMode,
  CodexThreadItem,
  CodexUsageInfo,
  ImageAttachment,
  ModelOption,
  PermissionRequest,
  ReasoningEffortOption,
  CodexRunRequest,
  CodexRunResult,
  CodexSetAuthRequest,
} from '../../shared/agent-types'

interface CodexProjectAuth {
  mode: CodexAuthMode
  apiKey?: string
}

interface CodexSession {
  projectPath: string
  model?: string
  modelReasoningEffort?: CodexReasoningEffort
  permissionPreset: CodexPermissionPreset
  threadId: string | null
  effectiveCwd: string | null
  runningController: AbortController | null
  pendingApprovals: Map<string, PendingCodexApproval>
  activeTurnId: string | null
  steerFn: ((input: string) => Promise<void>) | null
}

interface CodexRunStreamCallbacks {
  onThreadStarted?: (threadId: string) => void
  onItemDelta?: (phase: 'started' | 'updated' | 'completed', item: CodexThreadItem) => void
  onUsageDelta?: (usage: CodexUsageInfo) => void
  onPermissionRequest?: (request: PermissionRequest) => void
  onAskUserQuestion?: (request: AskUserQuestionRequest) => void
}

type CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'

type PendingCodexApprovalResponse =
  | { decision: CodexApprovalDecision }
  | { answers: Record<string, { answers: string[] }> }

interface AppServerUserInputQuestion {
  id: string
  header: string
  question: string
  isOther: boolean
  options: string[]
}

interface PendingCodexApproval {
  responseKind: 'decision' | 'user_input'
  questions?: AppServerUserInputQuestion[]
  resolve: (response: PendingCodexApprovalResponse) => void
  reject: (error: Error) => void
}

interface CodexAppServerModel {
  id: string
  model: string
  displayName: string
  description: string
  isDefault: boolean
  supportedReasoningEfforts: ReasoningEffortOption[]
  defaultReasoningEffort?: CodexReasoningEffort
}

type JsonRpcRequestId = string | number

interface AppServerNotification {
  requestIdRaw?: JsonRpcRequestId
  requestId?: string
  method: string
  params: Record<string, unknown>
}

interface AppServerConnection {
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  respond(requestId: JsonRpcRequestId, result?: Record<string, unknown>): Promise<void>
  notify(method: string, params?: Record<string, unknown>): Promise<void>
  nextNotification(): Promise<AppServerNotification>
}

type ParsedApprovalRequest =
  | {
    request: PermissionRequest
    responseKind: 'decision'
  }
  | {
    request: AskUserQuestionRequest
    responseKind: 'user_input'
    questions: AppServerUserInputQuestion[]
  }

const APP_SERVER_RESPONSE_TIMEOUT_MS = 15_000
const moduleRequire = createRequire(import.meta.url)

function resolveCodexPlatformPackage(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | null {
  if (platform === 'darwin' && arch === 'x64') return '@openai/codex-darwin-x64'
  if (platform === 'darwin' && arch === 'arm64') return '@openai/codex-darwin-arm64'
  if (platform === 'linux' && arch === 'x64') return '@openai/codex-linux-x64'
  if (platform === 'linux' && arch === 'arm64') return '@openai/codex-linux-arm64'
  if (platform === 'win32' && arch === 'x64') return '@openai/codex-win32-x64'
  if (platform === 'win32' && arch === 'arm64') return '@openai/codex-win32-arm64'
  return null
}

function hasCodexPlatformPackage(packageName: string): boolean {
  try {
    moduleRequire.resolve(`${packageName}/package.json`)
    return true
  } catch {
    return false
  }
}

function findSystemCodexCli(): string | null {
  const cmd = process.platform === 'win32' ? 'where' : '/usr/bin/which'
  try {
    const out = execFileSync(cmd, ['codex'], { timeout: 3000, stdio: 'pipe' }).toString()
    const candidate = out.split(/\r?\n/).map((v) => v.trim()).find(Boolean)
    return candidate ?? null
  } catch {
    return null
  }
}

function normalizeApiKey(value?: string): string | undefined {
  const key = value?.trim()
  return key ? key : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== null)
}

function readTextPart(value: unknown): string | null {
  const direct = readString(value)
  if (direct !== null) return direct
  const rec = asRecord(value)
  if (!rec) return null
  return readString(rec.text)
    ?? readString(rec.summaryText)
    ?? readString(rec.summary_text)
    ?? readString(rec.content)
}

function readTextParts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => readTextPart(entry))
    .filter((entry): entry is string => entry !== null && entry.length > 0)
}

function readItemId(rec: Record<string, unknown>): string | null {
  return readString(rec.itemId)
    ?? readString(rec.item_id)
    ?? readString(rec.id)
    ?? readString(asRecord(rec.item)?.id)
}

function readDeltaText(rec: Record<string, unknown>): string {
  return readString(rec.delta)
    ?? readString(rec.textDelta)
    ?? readString(rec.text_delta)
    ?? readString(rec.summaryTextDelta)
    ?? readString(rec.summary_text_delta)
    ?? readString(rec.summaryDelta)
    ?? readString(rec.summary_delta)
    ?? readString(rec.text)
    ?? readString(rec.summaryText)
    ?? readString(rec.summary_text)
    ?? ''
}

function toReasoningEffort(value: unknown): CodexReasoningEffort | null {
  return value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
    ? value
    : null
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value
  }
  return output
}

function sanitizeAttachmentName(name: string): string {
  const trimmed = basename(name.trim() || 'image')
  const cleaned = trimmed.replace(/[^A-Za-z0-9._-]/g, '-')
  const normalized = cleaned.replace(/-+/g, '-').slice(0, 80)
  return normalized || 'image'
}

function inferImageExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    case 'image/bmp':
      return '.bmp'
    case 'image/tiff':
      return '.tiff'
    case 'image/svg+xml':
      return '.svg'
    default:
      return ''
  }
}

function cleanupPersistedImageAttachments(paths: string[]): void {
  for (const filePath of paths) {
    try {
      unlinkSync(filePath)
    } catch {
      // Ignore cleanup failures.
    }
  }
}

function persistImageAttachments(projectPath: string, images: ImageAttachment[]): string[] {
  const targetDir = join(tmpdir(), 'super-one-codex-attachments')
  mkdirSync(targetDir, { recursive: true })

  const writtenPaths: string[] = []
  try {
    for (let i = 0; i < images.length; i++) {
      const image = images[i]
      const normalizedName = sanitizeAttachmentName(image.name || `image-${i + 1}`)
      const extension = extname(normalizedName) || inferImageExtension(image.mimeType)
      const baseName = extname(normalizedName) ? normalizedName.slice(0, -extname(normalizedName).length) : normalizedName
      const fileName = `${Date.now()}-${i}-${baseName}${extension}`
      const filePath = join(targetDir, fileName)
      writeFileSync(filePath, Buffer.from(image.base64, 'base64'))
      writtenPaths.push(filePath)
    }
    return writtenPaths
  } catch (error) {
    cleanupPersistedImageAttachments(writtenPaths)
    throw error
  }
}

function resolveApiKey(mode: CodexAuthMode, sessionApiKey?: string): string | undefined {
  if (mode === 'chatgpt') return undefined
  if (mode === 'apiKey') return normalizeApiKey(sessionApiKey) ?? normalizeApiKey(process.env.CODEX_API_KEY)
  return normalizeApiKey(sessionApiKey) ?? normalizeApiKey(process.env.CODEX_API_KEY)
}

function resolveMode(mode: CodexAuthMode, sessionApiKey?: string): 'chatgpt' | 'apiKey' {
  return resolveApiKey(mode, sessionApiKey) ? 'apiKey' : 'chatgpt'
}

function resolvePermissionProfile(
  permissionPreset?: CodexPermissionPreset,
): {
  permissionPreset: CodexPermissionPreset
  approvalPolicy: CodexApprovalMode
  sandboxMode: CodexSandboxMode
  networkAccessEnabled: boolean
} {
  const resolvedPreset = permissionPreset ?? DEFAULT_CODEX_PERMISSION_PRESET
  const profile = CODEX_PERMISSION_PRESETS[resolvedPreset] ?? DEFAULT_CODEX_PERMISSION_PROFILE
  return {
    permissionPreset: resolvedPreset,
    approvalPolicy: profile.approvalPolicy,
    sandboxMode: profile.sandboxMode,
    networkAccessEnabled: profile.networkAccessEnabled,
  }
}

function buildCollaborationMode(
  collaborationMode: CodexCollaborationMode | undefined,
  model?: string,
  reasoningEffort?: CodexReasoningEffort,
): Record<string, unknown> | undefined {
  if (collaborationMode !== 'plan' || !model) return undefined
  return {
    mode: 'plan',
    settings: {
      model,
      reasoning_effort: reasoningEffort ?? null,
      developer_instructions: null,
    },
  }
}

function mapPatchChangeKind(raw: unknown): CodexPatchChangeKind {
  const direct = readString(raw)
  if (direct === 'add' || direct === 'delete' || direct === 'update') return direct

  const rec = asRecord(raw)
  const kind = readString(rec?.type)
  if (kind === 'add' || kind === 'delete' || kind === 'update') return kind

  return 'update'
}

function mapCommandExecutionStatus(raw: unknown): CodexCommandExecutionStatus {
  const status = readString(raw)
  switch (status) {
    case 'in_progress':
    case 'inProgress':
      return 'in_progress'
    case 'failed':
    case 'declined':
      return 'failed'
    case 'completed':
    default:
      return 'completed'
  }
}

function mapPatchApplyStatus(raw: unknown): CodexPatchApplyStatus {
  const status = readString(raw)
  switch (status) {
    case 'failed':
    case 'declined':
      return 'failed'
    case 'completed':
    case 'in_progress':
    case 'inProgress':
    default:
      return 'completed'
  }
}

function mapMcpToolCallStatus(raw: unknown): CodexMcpToolCallStatus {
  const status = readString(raw)
  switch (status) {
    case 'in_progress':
    case 'inProgress':
      return 'in_progress'
    case 'failed':
      return 'failed'
    case 'completed':
    default:
      return 'completed'
  }
}

function mapThreadItemFromAppServer(raw: unknown, previous?: CodexThreadItem): CodexThreadItem | null {
  const rec = asRecord(raw)
  if (!rec) return null

  const type = readString(rec.type)
  const id = readString(rec.id) ?? previous?.id
  if (!type || !id) return null

  switch (type) {
    case 'agent_message':
    case 'agentMessage': {
      const text = readString(rec.text) ?? (previous?.type === 'agent_message' ? previous.text : '')
      return { id, type: 'agent_message', text }
    }

    case 'reasoning': {
      const directText = readString(rec.text)
      const summaryText = readTextParts(rec.summary).join('\n\n')
      const contentText = readTextParts(rec.content).join('\n\n')
      const text =
        (directText && directText.length > 0 ? directText : '')
        || summaryText
        || contentText
        || (previous?.type === 'reasoning' ? previous.text : '')
      return { id, type: 'reasoning', text }
    }

    case 'command_execution':
    case 'commandExecution': {
      const prevCommand = previous?.type === 'command_execution' ? previous : null
      const command = readString(rec.command) ?? prevCommand?.command ?? ''
      const aggregatedOutput = readString(rec.aggregatedOutput)
        ?? readString(rec.aggregated_output)
        ?? prevCommand?.aggregatedOutput
        ?? ''
      const exitCode = readNumber(rec.exitCode) ?? readNumber(rec.exit_code)
      const commandActions = Array.isArray(rec.commandActions)
        ? rec.commandActions.map((a) => {
            const r = asRecord(a)
            if (!r) return null
            return {
              type: readString(r.type) ?? 'unknown',
              ...(r.command != null ? { command: readString(r.command) ?? undefined } : {}),
              ...(r.name != null ? { name: readString(r.name) ?? undefined } : {}),
              ...(r.path != null ? { path: readString(r.path) ?? undefined } : {}),
              ...(r.query != null ? { query: readString(r.query) ?? undefined } : {}),
            }
          }).filter((a): a is NonNullable<typeof a> => a !== null)
        : undefined
      return {
        id,
        type: 'command_execution',
        command,
        aggregatedOutput,
        ...(exitCode !== null ? { exitCode } : {}),
        status: mapCommandExecutionStatus(rec.status ?? prevCommand?.status),
        ...(commandActions ? { commandActions } : prevCommand?.commandActions ? { commandActions: prevCommand.commandActions } : {}),
      }
    }

    case 'file_change':
    case 'fileChange': {
      const changes = Array.isArray(rec.changes)
        ? rec.changes
            .map((entry) => {
              const change = asRecord(entry)
              const path = readString(change?.path)
              if (!path) return null
              const diff = readString(change?.diff)
              return {
                path,
                kind: mapPatchChangeKind(change?.kind),
                ...(diff !== null ? { diff } : {}),
              }
            })
            .filter((entry): entry is { path: string; kind: CodexPatchChangeKind; diff?: string } => entry !== null)
        : (previous?.type === 'file_change' ? previous.changes : [])
      return {
        id,
        type: 'file_change',
        changes,
        status: mapPatchApplyStatus(rec.status ?? (previous?.type === 'file_change' ? previous.status : undefined)),
      }
    }

    case 'mcp_tool_call':
    case 'mcpToolCall': {
      const prevMcp = previous?.type === 'mcp_tool_call' ? previous : null
      const resultRec = asRecord(rec.result)
      const errorRec = asRecord(rec.error)
      return {
        id,
        type: 'mcp_tool_call',
        server: readString(rec.server) ?? prevMcp?.server ?? '',
        tool: readString(rec.tool) ?? prevMcp?.tool ?? '',
        arguments: rec.arguments ?? prevMcp?.arguments ?? {},
        ...(resultRec
          ? {
              result: {
                content: Array.isArray(resultRec.content) ? resultRec.content : [],
                structuredContent: resultRec.structuredContent ?? resultRec.structured_content ?? null,
              },
            }
          : prevMcp?.result
          ? { result: prevMcp.result }
          : {}),
        ...(errorRec
          ? { error: { message: readString(errorRec.message) ?? 'Unknown MCP tool error' } }
          : prevMcp?.error
          ? { error: prevMcp.error }
          : {}),
        status: mapMcpToolCallStatus(rec.status ?? prevMcp?.status),
      }
    }

    case 'web_search':
    case 'webSearch':
      return {
        id,
        type: 'web_search',
        query: readString(rec.query) ?? (previous?.type === 'web_search' ? previous.query : ''),
      }

    case 'todo_list':
    case 'todoList': {
      const items = Array.isArray(rec.items)
        ? rec.items
            .map((entry) => {
              const todo = asRecord(entry)
              const text = readString(todo?.text)
              if (!text) return null
              return { text, completed: readBoolean(todo?.completed) ?? false }
            })
            .filter((entry): entry is { text: string; completed: boolean } => entry !== null)
        : (previous?.type === 'todo_list' ? previous.items : [])
      return {
        id,
        type: 'todo_list',
        items,
      }
    }

    case 'error':
      return {
        id,
        type: 'error',
        message: readString(rec.message) ?? (previous?.type === 'error' ? previous.message : 'Unknown error'),
      }

    case 'plan': {
      const text = readString(rec.text)
      if (!text) return null
      return {
        id,
        type: 'reasoning',
        text,
      }
    }

    case 'enteredReviewMode': {
      const text = readString(rec.text) ?? readString(rec.review) ?? ''
      return { id, type: 'review', phase: 'entered', text }
    }

    case 'exitedReviewMode': {
      const text = readString(rec.text) ?? readString(rec.review) ?? ''
      return { id: `${id}_exit`, type: 'review', phase: 'exited', text }
    }

    case 'contextCompaction':
      return { id, type: 'compaction' }

    case 'collabAgentToolCall': {
      const prevCollab = previous?.type === 'collab_tool_call' ? previous : null
      const tool = (readString(rec.tool) ?? prevCollab?.tool ?? 'spawnAgent') as CodexCollabTool
      const statusStr = readString(rec.status)
      const status: 'in_progress' | 'completed' = statusStr === 'completed' ? 'completed' : 'in_progress'
      const senderThreadId = readString(rec.senderThreadId) ?? readString(rec.sender_thread_id) ?? prevCollab?.senderThreadId
      const receiverThreadIds = readStringArray(rec.receiverThreadIds ?? rec.receiver_thread_ids)
      const prompt = readString(rec.prompt) ?? prevCollab?.prompt

      const agentsStates: Record<string, CodexCollabAgentState> = { ...(prevCollab?.agentsStates ?? {}) }
      const rawStates = asRecord(rec.agentsStates ?? rec.agents_states)
      if (rawStates) {
        for (const [agentId, stateVal] of Object.entries(rawStates)) {
          const stateRec = asRecord(stateVal)
          if (!stateRec) continue
          const prevAgentState = prevCollab?.agentsStates?.[agentId]
          agentsStates[agentId] = {
            ...prevAgentState,
            status: (readString(stateRec.status) ?? 'running') as CodexCollabAgentStatus,
            ...(stateRec.nickname != null ? { nickname: readString(stateRec.nickname) ?? undefined } : {}),
            ...(stateRec.role != null ? { role: readString(stateRec.role) ?? undefined } : {}),
            ...(stateRec.message != null ? { message: readString(stateRec.message) ?? undefined } : {}),
          }
        }
      }

      return {
        id,
        type: 'collab_tool_call',
        tool,
        status,
        ...(senderThreadId ? { senderThreadId } : {}),
        receiverThreadIds: receiverThreadIds.length > 0 ? receiverThreadIds : (prevCollab?.receiverThreadIds ?? []),
        ...(prompt ? { prompt } : {}),
        agentsStates,
        ...(prevCollab?.childItems ? { childItems: prevCollab.childItems } : {}),
      }
    }

    default:
      return null
  }
}

function upsertItem(order: string[], map: Map<string, CodexThreadItem>, item: CodexThreadItem): void {
  if (!map.has(item.id)) order.push(item.id)
  map.set(item.id, item)
}

function mapUsageFromTokenUsage(raw: unknown): CodexUsageInfo | null {
  const rec = asRecord(raw)
  if (!rec) return null
  const parseBreakdown = (value: unknown): { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningOutputTokens: number } | null => {
    const breakdown = asRecord(value)
    if (!breakdown) return null
    return {
      inputTokens: readNumber(breakdown.inputTokens ?? breakdown.input_tokens) ?? 0,
      cachedInputTokens: readNumber(breakdown.cachedInputTokens ?? breakdown.cached_input_tokens) ?? 0,
      outputTokens: readNumber(breakdown.outputTokens ?? breakdown.output_tokens) ?? 0,
      reasoningOutputTokens: readNumber(breakdown.reasoningOutputTokens ?? breakdown.reasoning_output_tokens) ?? 0,
    }
  }

  const last = parseBreakdown(rec.last)
  const total = parseBreakdown(rec.total)
  const resolvedLast = last ?? total
  const resolvedTotal = total ?? last
  if (!resolvedLast || !resolvedTotal) return null

  return {
    totalInputTokens: resolvedTotal.inputTokens,
    totalCachedInputTokens: resolvedTotal.cachedInputTokens,
    totalOutputTokens: resolvedTotal.outputTokens,
    lastInputTokens: resolvedLast.inputTokens,
    lastCachedInputTokens: resolvedLast.cachedInputTokens,
    lastOutputTokens: resolvedLast.outputTokens,
    reasoningOutputTokens: resolvedTotal.reasoningOutputTokens || (readNumber(rec.reasoningOutputTokens ?? rec.reasoning_output_tokens) ?? 0),
    contextWindow: readNumber(rec.modelContextWindow ?? rec.model_context_window ?? rec.contextWindow ?? rec.context_window) ?? 0,
  }
}

function deriveFinalResponse(items: CodexThreadItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.type === 'agent_message') return item.text
  }
  return ''
}

function extractJsonRpcErrorMessage(raw: unknown): string {
  const rec = asRecord(raw)
  if (!rec) return 'Unknown app-server error'
  return readString(rec.message) ?? 'Unknown app-server error'
}

function extractTurnErrorMessage(raw: unknown): string {
  const rec = asRecord(raw)
  if (!rec) return 'Codex turn failed'

  const direct = readString(rec.message)
  if (direct) return direct

  const nested = asRecord(rec.error)
  return readString(nested?.message) ?? 'Codex turn failed'
}

const POSITIVE_OPTION_PATTERN = /\b(accept|allow|yes|continue|proceed|approve|ok|confirm|run)\b/i
const NEGATIVE_OPTION_PATTERN = /\b(decline|deny|reject|cancel|no|stop|abort|disallow)\b/i

function parseUserInputQuestions(value: unknown): AppServerUserInputQuestion[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => {
      const questionRec = asRecord(entry)
      if (!questionRec) return null
      const id = readString(questionRec?.id)
      const question = readString(questionRec?.question)
      if (!id || !question) return null

      const options = Array.isArray(questionRec.options)
        ? questionRec.options
            .map((optionEntry) => readString(asRecord(optionEntry)?.label))
            .filter((option): option is string => option !== null)
        : []

      return {
        id,
        header: readString(questionRec.header) ?? id,
        question,
        isOther: readBoolean(questionRec.isOther) ?? false,
        options,
      } satisfies AppServerUserInputQuestion
    })
    .filter((question): question is AppServerUserInputQuestion => question !== null)
}

function chooseUserInputAnswers(question: AppServerUserInputQuestion, allow: boolean, reason?: string): string[] {
  const trimmedReason = reason?.trim()

  if (!allow && trimmedReason && question.isOther) return [trimmedReason]
  if (question.options.length === 0) {
    return !allow && trimmedReason ? [trimmedReason] : []
  }

  const matchPattern = allow ? POSITIVE_OPTION_PATTERN : NEGATIVE_OPTION_PATTERN
  const matched = question.options.find((option) => matchPattern.test(option))
  if (matched) return [matched]
  return [allow ? question.options[0] : question.options[question.options.length - 1]]
}

function buildUserInputApprovalResponse(
  questions: AppServerUserInputQuestion[],
  allow: boolean,
  reason?: string,
): { answers: Record<string, { answers: string[] }> } {
  const answers: Record<string, { answers: string[] }> = {}

  for (const question of questions) {
    answers[question.id] = {
      answers: chooseUserInputAnswers(question, allow, reason),
    }
  }

  return { answers }
}

function buildUserInputAnswersResponse(
  questions: AppServerUserInputQuestion[],
  answersByQuestion: Record<string, string>,
): { answers: Record<string, { answers: string[] }> } {
  const answers: Record<string, { answers: string[] }> = {}

  for (const question of questions) {
    const answer = answersByQuestion[question.id]?.trim()
    answers[question.id] = {
      answers: answer ? [answer] : [],
    }
  }

  return { answers }
}

function mapApprovalRequest(notification: AppServerNotification): ParsedApprovalRequest | null {
  const requestId = notification.requestId
  if (!requestId) return null

  if (notification.method === 'item/commandExecution/requestApproval') {
    const command = readString(notification.params.command) ?? ''
    const cwd = readString(notification.params.cwd) ?? undefined
    const reason = readString(notification.params.reason) ?? undefined
    return {
      responseKind: 'decision',
      request: {
        requestId,
        toolName: 'Bash',
        toolUseId: requestId,
        input: compactRecord({
          command,
          cwd,
        }),
        decisionReason: reason,
        allowAlwaysAllow: true,
      },
    }
  }

  if (notification.method === 'item/fileChange/requestApproval') {
    const grantRoot = readString(notification.params.grantRoot) ?? undefined
    const reason = readString(notification.params.reason) ?? undefined
    return {
      responseKind: 'decision',
      request: {
        requestId,
        toolName: 'FileChange',
        toolUseId: requestId,
        input: compactRecord({
          file_path: grantRoot,
          kind: 'grant_root',
        }),
        decisionReason: reason,
        blockedPath: grantRoot,
        allowAlwaysAllow: true,
      },
    }
  }

  if (
    notification.method === 'item/tool/requestUserInput'
    || notification.method === 'tool/requestUserInput'
  ) {
    const questions = parseUserInputQuestions(notification.params.questions)

    return {
      responseKind: 'user_input',
      questions,
      request: {
        requestId,
        questions: questions.map((question) => ({
          header: question.header,
          question: question.question,
          options: question.options.map((label) => ({
            label,
            description: '',
          })),
          multiSelect: false,
        })),
      },
    }
  }

  return null
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function parseAppServerModel(raw: unknown): CodexAppServerModel | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (readBoolean(rec.hidden) === true) return null
  const model = readString(rec.model) ?? readString(rec.id)
  const id = readString(rec.id) ?? model
  if (!id || !model) return null

  const reasoningEfforts = Array.isArray(rec.supportedReasoningEfforts)
    ? rec.supportedReasoningEfforts
    : Array.isArray(rec.reasoningEffort)
      ? rec.reasoningEffort
      : []

  return {
    id,
    model,
    displayName: typeof rec.displayName === 'string' ? rec.displayName : model,
    description: typeof rec.description === 'string' ? rec.description : '',
    isDefault: rec.isDefault === true,
    supportedReasoningEfforts: Array.isArray(reasoningEfforts)
      ? reasoningEfforts
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const effort = toReasoningEffort(
              (entry as Record<string, unknown>).reasoningEffort
              ?? (entry as Record<string, unknown>).effort,
            )
            const description = (entry as Record<string, unknown>).description
            if (!effort) return null
            return {
              value: effort,
              description: typeof description === 'string' ? description : effort,
            } satisfies ReasoningEffortOption
          })
          .filter((entry): entry is ReasoningEffortOption => Boolean(entry))
      : [],
    defaultReasoningEffort: toReasoningEffort(rec.defaultReasoningEffort) ?? undefined,
  }
}

export class CodexExperimentService {
  private sessions = new Map<string, CodexSession>()  // key = sessionId
  private projectAuth = new Map<string, CodexProjectAuth>()  // key = projectPath
  private codexCliScriptPath: string | null = null

  private rejectPendingApprovals(session: CodexSession, message: string): void {
    if (session.pendingApprovals.size === 0) return
    const error = new Error(message)
    for (const pending of session.pendingApprovals.values()) {
      pending.reject(error)
    }
    session.pendingApprovals.clear()
  }

  private getProjectAuth(projectPath: string): CodexProjectAuth {
    let auth = this.projectAuth.get(projectPath)
    if (!auth) {
      auth = { mode: 'auto' }
      this.projectAuth.set(projectPath, auth)
    }
    return auth
  }

  private createSession(
    projectPath: string,
    model?: string,
    threadId?: string,
    modelReasoningEffort?: CodexReasoningEffort,
    permissionPreset?: CodexPermissionPreset,
  ): CodexSession {
    const resolvedPermissionProfile = resolvePermissionProfile(permissionPreset)
    return {
      projectPath,
      model,
      modelReasoningEffort,
      permissionPreset: resolvedPermissionProfile.permissionPreset,
      threadId: threadId ?? null,
      effectiveCwd: null,
      runningController: null,
      pendingApprovals: new Map<string, PendingCodexApproval>(),
      activeTurnId: null,
      steerFn: null,
    }
  }

  private resolveCwd(session: CodexSession, projectPath: string, requestedCwd?: string): string {
    const cwd = requestedCwd || session.effectiveCwd || projectPath
    if (session.effectiveCwd && session.effectiveCwd !== cwd) {
      session.threadId = null
    }
    session.effectiveCwd = cwd
    return cwd
  }

  private ensureSession(
    sessionId: string,
    projectPath: string,
    requestedModel?: string,
    requestedThreadId?: string,
    requestedReasoningEffort?: CodexReasoningEffort,
    requestedPermissionPreset?: CodexPermissionPreset,
  ): CodexSession {
    const existing = this.sessions.get(sessionId)
    if (!existing) {
      const created = this.createSession(
        projectPath,
        requestedModel,
        requestedThreadId,
        requestedReasoningEffort,
        requestedPermissionPreset,
      )
      this.sessions.set(sessionId, created)
      return created
    }

    const shouldSwitchThread = Boolean(requestedThreadId && requestedThreadId !== existing.threadId)
    const shouldSwitchModel = Boolean(requestedModel && requestedModel !== existing.model)
    const shouldSwitchReasoningEffort = Boolean(
      requestedReasoningEffort
      && requestedReasoningEffort !== existing.modelReasoningEffort,
    )
    const shouldSwitchPermissionPreset = Boolean(
      requestedPermissionPreset
      && requestedPermissionPreset !== existing.permissionPreset,
    )

    if (
      shouldSwitchThread
      || shouldSwitchModel
      || shouldSwitchReasoningEffort
      || shouldSwitchPermissionPreset
    ) {
      this.rejectPendingApprovals(existing, 'Codex run interrupted')
      if (existing.runningController) existing.runningController.abort()
      const recreated = this.createSession(
        projectPath,
        requestedModel ?? existing.model,
        requestedThreadId ?? existing.threadId ?? undefined,
        requestedReasoningEffort ?? existing.modelReasoningEffort,
        requestedPermissionPreset ?? existing.permissionPreset,
      )
      this.sessions.set(sessionId, recreated)
      return recreated
    }

    return existing
  }

  private resolveCodexCliScriptPath(): string {
    if (this.codexCliScriptPath) return this.codexCliScriptPath
    let resolved = moduleRequire.resolve('@openai/codex/bin/codex.js')
    resolved = resolved.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    log.info('[codex] Resolved CLI script:', resolved)
    this.codexCliScriptPath = resolved
    return this.codexCliScriptPath
  }

  private buildAppServerEnv(auth: CodexProjectAuth): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (process.versions.electron) {
      env.ELECTRON_RUN_AS_NODE = '1'
    }
    const codexProvider = getActiveProviderRaw('codex')
    if (codexProvider) {
      const configs = JSON.parse(codexProvider.agent_configs || '{}')
      const cc = configs.codex
      if (codexProvider.api_key) env.CODEX_API_KEY = codexProvider.api_key
      if (cc?.base_url) env.OPENAI_BASE_URL = cc.base_url
      try { Object.assign(env, JSON.parse(cc?.extra_env || '{}')) } catch {}
      return env
    }
    if (auth.mode === 'chatgpt') {
      delete env.CODEX_API_KEY
      return env
    }
    const apiKey = resolveApiKey(auth.mode, auth.apiKey)
    if (apiKey) env.CODEX_API_KEY = apiKey
    return env
  }

  private mapAppServerModel(m: CodexAppServerModel): ModelOption {
    return {
      id: m.model,
      name: m.displayName || m.model,
      description: m.description,
      isDefault: m.isDefault,
      supportedReasoningEfforts: m.supportedReasoningEfforts,
      defaultReasoningEffort: m.defaultReasoningEffort,
    }
  }

  private buildThreadConfig(
    permissionProfile: {
      sandboxMode: CodexSandboxMode
      networkAccessEnabled: boolean
    },
  ): Record<string, unknown> | undefined {
    if (permissionProfile.sandboxMode !== 'workspace-write') return undefined
    return {
      sandbox_workspace_write: {
        network_access: permissionProfile.networkAccessEnabled,
      },
    }
  }

  private buildTurnSandboxPolicy(
    cwd: string,
    permissionProfile: {
      sandboxMode: CodexSandboxMode
      networkAccessEnabled: boolean
    },
  ): Record<string, unknown> {
    if (permissionProfile.sandboxMode === 'danger-full-access') {
      return { type: 'dangerFullAccess' }
    }

    if (permissionProfile.sandboxMode === 'read-only') {
      return {
        type: 'readOnly',
        access: { type: 'fullAccess' },
      }
    }

    return {
      type: 'workspaceWrite',
      writableRoots: [cwd],
      readOnlyAccess: { type: 'fullAccess' },
      networkAccess: permissionProfile.networkAccessEnabled,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    }
  }

  private async withAppServerConnection<T>(
    auth: CodexProjectAuth,
    signal: AbortSignal | undefined,
    fn: (connection: AppServerConnection) => Promise<T>,
  ): Promise<T> {
    if (signal?.aborted) {
      throw new Error('Codex run interrupted')
    }

    const codexScript = this.resolveCodexCliScriptPath()
    const env = this.buildAppServerEnv(auth)
    const expectedPackage = resolveCodexPlatformPackage()
    const hasBundledPackage = expectedPackage ? hasCodexPlatformPackage(expectedPackage) : false
    const systemCodexCli = !hasBundledPackage ? findSystemCodexCli() : null
    log.info(
      '[codex] app-server launch platform=%s arch=%s mode=%s script=%s expectedPackage=%s bundledPackage=%s systemCodex=%s',
      process.platform,
      process.arch,
      auth.mode,
      codexScript,
      expectedPackage ?? 'unknown',
      hasBundledPackage,
      systemCodexCli ?? 'none',
    )

    if (!hasBundledPackage && !systemCodexCli) {
      const hint = process.platform === 'darwin'
        ? 'Rebuild dependencies with: bun install --frozen-lockfile --os=darwin --cpu=*'
        : 'Rebuild dependencies for the current target architecture'
      throw new Error(`Missing Codex runtime package (${expectedPackage ?? 'unknown'}). ${hint}`)
    }

    const child = systemCodexCli
      ? spawn(systemCodexCli, ['app-server', '--listen', 'stdio://'], {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
          windowsHide: process.platform === 'win32',
        })
      : spawn(process.execPath, [codexScript, 'app-server', '--listen', 'stdio://'], {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        })

    const stdout = child.stdout
    const stdin = child.stdin
    if (!stdout || !stdin) {
      child.kill()
      throw new Error('Failed to start Codex app-server')
    }

    const rl = createInterface({ input: stdout })
    const iterator = rl[Symbol.asyncIterator]()
    const stderrChunks: string[] = []
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => stderrChunks.push(chunk))

    const onAbort = () => {
      if (!child.killed) child.kill()
    }
    signal?.addEventListener('abort', onAbort)

    const sendMessage = async (payload: Record<string, unknown>): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }

    const readMessage = async (): Promise<Record<string, unknown>> => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const next = await iterator.next()
        if (next.done) {
          throw new Error('Codex app-server closed unexpectedly')
        }
        const line = `${next.value}`.trim()
        if (!line) continue

        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }

        const rec = asRecord(parsed)
        if (rec) return rec
      }
    }

    const notificationQueue: AppServerNotification[] = []
    let nextRequestId = 1

      const waitForResponse = async (id: number, label: string): Promise<Record<string, unknown>> => {
        const expectedId = String(id)
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const msg = await withTimeout(readMessage(), APP_SERVER_RESPONSE_TIMEOUT_MS, `Codex app-server ${label}`)

          const method = readString(msg.method)
          if (method) {
            const rawId = ('id' in msg && (typeof msg.id === 'string' || typeof msg.id === 'number'))
              ? (msg.id as JsonRpcRequestId)
              : undefined
            notificationQueue.push({
              requestIdRaw: rawId,
              requestId: rawId !== undefined ? String(rawId) : undefined,
              method,
              params: asRecord(msg.params) ?? {},
            })
            continue
          }

        if (!('id' in msg)) continue
        if (String(msg.id) !== expectedId) continue

        if ('error' in msg && msg.error) {
          throw new Error(extractJsonRpcErrorMessage(msg.error))
        }

        const result = asRecord(msg.result)
        return result ?? {}
      }
    }

    const connection: AppServerConnection = {
      request: async (method, params) => {
        const requestId = nextRequestId
        nextRequestId += 1
        await sendMessage(compactRecord({ id: requestId, method, params }))
        return waitForResponse(requestId, method)
      },

      respond: async (requestId, result) => {
        await sendMessage(compactRecord({ id: requestId, result: result ?? {} }))
      },

      notify: async (method, params) => {
        await sendMessage(compactRecord({ method, params }))
      },

      nextNotification: async () => {
        if (notificationQueue.length > 0) {
          const queued = notificationQueue.shift()
          if (queued) return queued
        }

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const msg = await readMessage()
          const method = readString(msg.method)
          if (!method) continue
          const rawId = ('id' in msg && (typeof msg.id === 'string' || typeof msg.id === 'number'))
            ? (msg.id as JsonRpcRequestId)
            : undefined
          return {
            requestIdRaw: rawId,
            requestId: rawId !== undefined ? String(rawId) : undefined,
            method,
            params: asRecord(msg.params) ?? {},
          }
        }
      },
    }

    try {
      await connection.request('initialize', {
        clientInfo: {
          name: 'super-one',
          title: 'Super One',
          version: '0.1.0',
        },
        capabilities: {
          experimentalApi: true,
        },
      })
      await connection.notify('initialized')

      return await fn(connection)
    } catch (error) {
      const stderr = stderrChunks.join('').trim()
      log.error('[codex] app-server error:', error instanceof Error ? error.message : String(error))
      if (stderr.includes('Missing optional dependency')) {
        log.error(
          '[codex] missing optional dependency detected platform=%s arch=%s expectedPackage=%s',
          process.platform,
          process.arch,
          expectedPackage ?? 'unknown',
        )
      }
      if (stderr) log.error('[codex] app-server stderr:', stderr)
      if (stderr) {
        const message = error instanceof Error ? error.message : String(error)
        const debugLogPath = String(log.transports.file.getFile().path)
        throw new Error(`${message}\n${stderr}\nDebug log: ${debugLogPath}`)
      }
      throw error
    } finally {
      signal?.removeEventListener('abort', onAbort)
      rl.close()
      try {
        stdin.end()
      } catch {
        // ignore
      }
      if (!child.killed) child.kill()
    }
  }

  private async fetchModelsFromAppServer(auth: CodexProjectAuth): Promise<ModelOption[]> {
    return this.withAppServerConnection(auth, undefined, async (connection) => {
      const models: CodexAppServerModel[] = []
      let cursor: string | null = null

      do {
        const result = await connection.request(
          'model/list',
          compactRecord({
            limit: 100,
            cursor: cursor ?? undefined,
          }),
        )

        const items = Array.isArray(result.data) ? result.data : []
        for (const raw of items) {
          const parsed = parseAppServerModel(raw)
          if (parsed) models.push(parsed)
        }

        cursor = readString(result.nextCursor)
      } while (cursor)

      const mapped = models.map((m) => this.mapAppServerModel(m))
      if (!mapped.some((m) => m.isDefault) && mapped[0]) {
        mapped[0] = { ...mapped[0], isDefault: true }
      }
      return mapped
    })
  }

  async listModels(projectPath: string): Promise<ModelOption[]> {
    const auth = this.getProjectAuth(projectPath)
    log.info('[codex] listModels: mode=%s, hasApiKey=%s', auth.mode, Boolean(auth.apiKey || process.env.CODEX_API_KEY))
    const models = await this.fetchModelsFromAppServer(auth)
    log.info('[codex] listModels: fetched %d models', models.length)
    return models
  }

  private async resolveThread(
    connection: AppServerConnection,
    session: CodexSession,
    cwd: string,
    permissionProfile: ReturnType<typeof resolvePermissionProfile>,
  ): Promise<string> {
    const threadConfig = this.buildThreadConfig(permissionProfile)

    const startNewThread = () =>
      connection.request(
        'thread/start',
        compactRecord({
          model: session.model,
          cwd,
          approvalPolicy: permissionProfile.approvalPolicy,
          sandbox: permissionProfile.sandboxMode,
          config: threadConfig,
          experimentalRawEvents: false,
          persistExtendedHistory: true,
        }),
      )

    const threadResult = session.threadId
      ? await connection.request(
          'thread/resume',
          compactRecord({
            threadId: session.threadId,
            model: session.model,
            cwd,
            approvalPolicy: permissionProfile.approvalPolicy,
            sandbox: permissionProfile.sandboxMode,
            config: threadConfig,
            persistExtendedHistory: true,
          }),
        ).catch(() => {
          session.threadId = null
          return startNewThread()
        })
      : await startNewThread()

    const thread = asRecord(threadResult.thread)
    const resolvedThreadId = readString(thread?.id)
    if (!resolvedThreadId) {
      throw new Error('Failed to resolve Codex thread id')
    }

    session.threadId = resolvedThreadId
    return resolvedThreadId
  }

  private async streamTurnEvents(
    connection: AppServerConnection,
    session: CodexSession,
    activeTurnId: string | null,
    controller: AbortController,
    callbacks?: CodexRunStreamCallbacks,
  ): Promise<{ threadId: string | null; usage: CodexUsageInfo | null; items: CodexThreadItem[] }> {
    let threadStartedEmitted = false
    const emitThreadStarted = (threadId: string) => {
      if (threadStartedEmitted) return
      threadStartedEmitted = true
      callbacks?.onThreadStarted?.(threadId)
    }

    if (session.threadId) emitThreadStarted(session.threadId)

    const itemOrder: string[] = []
    const itemMap = new Map<string, CodexThreadItem>()
    let usage: CodexUsageInfo | null = null
    let turnCompleted = false

    const subscribedChildThreads = new Set<string>()
    const childItemMaps = new Map<string, { order: string[]; map: Map<string, CodexThreadItem> }>()
    const childThreadToCollabId = new Map<string, string>()

    const getChildItems = (threadId: string): CodexThreadItem[] => {
      const data = childItemMaps.get(threadId)
      if (!data) return []
      return data.order.map((id) => data.map.get(id)).filter((i): i is CodexThreadItem => Boolean(i))
    }

    const upsertChildItem = (threadId: string, item: CodexThreadItem): void => {
      let data = childItemMaps.get(threadId)
      if (!data) {
        data = { order: [], map: new Map() }
        childItemMaps.set(threadId, data)
      }
      if (!data.map.has(item.id)) data.order.push(item.id)
      data.map.set(item.id, item)
    }

    const emitCollabUpdate = (collabId: string, trigger?: string): void => {
      const collab = itemMap.get(collabId)
      if (!collab || collab.type !== 'collab_tool_call') return
      const updatedChildItems: Record<string, CodexThreadItem[]> = {}
      for (const tid of collab.receiverThreadIds) {
        const items = getChildItems(tid)
        if (items.length > 0) updatedChildItems[tid] = items
      }
      const updated: CodexCollabToolCallItem = { ...collab, childItems: updatedChildItems }
      itemMap.set(collabId, updated)
      if (process.env.NODE_ENV === 'development') {
        const childCounts: Record<string, number> = {}
        for (const [tid, items] of Object.entries(updatedChildItems)) childCounts[tid] = items.length
        trace('codex.collab', 'emit_update', {
          collabId,
          trigger,
          tool: collab.tool,
          status: collab.status,
          agentIds: Object.keys(collab.agentsStates),
          receiverThreadIds: collab.receiverThreadIds,
          childItemCounts: childCounts,
        }, collabId)
      }
      callbacks?.onItemDelta?.('updated', updated)
    }

    const subscribeChildThread = async (threadId: string, collabId: string): Promise<void> => {
      if (subscribedChildThreads.has(threadId)) return
      subscribedChildThreads.add(threadId)
      childThreadToCollabId.set(threadId, collabId)
      childItemMaps.set(threadId, { order: [], map: new Map() })
      try {
        await connection.request('thread/resume', { threadId, persistExtendedHistory: false })
        log.info('[codex] Subscribed to child thread %s for collab %s', threadId, collabId)
      } catch (err) {
        log.info('[codex] thread/resume skipped for child %s (events still tracked): %s', threadId, err)
      }
      if (process.env.NODE_ENV === 'development') {
        trace('codex.collab', 'subscribe_child', { threadId, collabId }, collabId)
      }
    }

    const unsubscribeChildThread = async (threadId: string): Promise<void> => {
      if (!subscribedChildThreads.has(threadId)) return
      const collabId = childThreadToCollabId.get(threadId)
      try {
        await connection.notify('thread/unsubscribe', { threadId })
      } catch {}
      if (process.env.NODE_ENV === 'development') {
        trace('codex.collab', 'unsubscribe_child', { threadId, collabId }, collabId ?? undefined)
      }
      subscribedChildThreads.delete(threadId)
      childItemMaps.delete(threadId)
      childThreadToCollabId.delete(threadId)
    }

    const handleServerRequest = async (notification: AppServerNotification): Promise<boolean> => {
      if (notification.requestIdRaw === undefined) return false

      const parsedApprovalRequest = mapApprovalRequest(notification)
      if (parsedApprovalRequest) {
        const fallbackResponse: PendingCodexApprovalResponse = parsedApprovalRequest.responseKind === 'user_input'
          ? buildUserInputApprovalResponse(parsedApprovalRequest.questions, false)
          : { decision: 'decline' }

        if (controller.signal.aborted) {
          await connection.respond(notification.requestIdRaw, fallbackResponse)
          return true
        }
        const canHandleRequest = parsedApprovalRequest.responseKind === 'user_input'
          ? callbacks?.onAskUserQuestion
          : callbacks?.onPermissionRequest
        if (!canHandleRequest) {
          await connection.respond(notification.requestIdRaw, fallbackResponse)
          return true
        }
        try {
          const responsePromise = new Promise<PendingCodexApprovalResponse>((resolve, reject) => {
            session.pendingApprovals.set(parsedApprovalRequest.request.requestId, {
              responseKind: parsedApprovalRequest.responseKind,
              questions: parsedApprovalRequest.responseKind === 'user_input'
                ? parsedApprovalRequest.questions
                : undefined,
              resolve,
              reject,
            })
          })
          if (parsedApprovalRequest.responseKind === 'user_input') {
            callbacks?.onAskUserQuestion?.(parsedApprovalRequest.request)
          } else {
            callbacks?.onPermissionRequest?.(parsedApprovalRequest.request)
          }
          const response = await responsePromise
          await connection.respond(notification.requestIdRaw, response)
          return true
        } finally {
          session.pendingApprovals.delete(parsedApprovalRequest.request.requestId)
        }
      }

      await connection.respond(notification.requestIdRaw, {})
      return true
    }

    const isRelevantEvent = (params: Record<string, unknown>): boolean => {
      const notifThreadId = readString(params.threadId)
      if (notifThreadId && subscribedChildThreads.has(notifThreadId)) return true
      if (!activeTurnId) return true
      const turnId = readString(params.turnId) ?? readString(asRecord(params.turn)?.id)
      return !turnId || turnId === activeTurnId
    }

    while (!turnCompleted) {
      const notification = await connection.nextNotification()
      const { method, params } = notification
      if (process.env.NODE_ENV === 'development') {
        trace('codex.raw', method, {
          params,
          itemId: readItemId(params),
          itemType: readString(asRecord(params.item)?.type),
          deltaText: readDeltaText(params),
          summaryIndex: readNumber(params.summaryIndex ?? params.summary_index),
          itemSummary: asRecord(params.item)?.summary,
          itemContent: asRecord(params.item)?.content,
        }, activeTurnId ?? session.threadId ?? undefined)
      }

      if (await handleServerRequest(notification)) {
        continue
      }

      if (method === 'thread/started') {
        const startedThreadId = readString(asRecord(params.thread)?.id)
        if (startedThreadId && !subscribedChildThreads.has(startedThreadId)) {
          session.threadId = startedThreadId
          emitThreadStarted(startedThreadId)
        }
        continue
      }

      if (!isRelevantEvent(params)) {
        continue
      }

      const notifThreadId = readString(params.threadId)
      const isChildThreadEvent = notifThreadId ? subscribedChildThreads.has(notifThreadId) : false

      if (isChildThreadEvent && notifThreadId) {
        const collabId = childThreadToCollabId.get(notifThreadId)
        if (!collabId) continue

        if (process.env.NODE_ENV === 'development') {
          trace('codex.collab', `child:${method}`, {
            childThreadId: notifThreadId,
            collabId,
            itemId: readItemId(params),
            itemType: readString(asRecord(params.item)?.type),
          }, collabId)
        }

        switch (method) {
          case 'item/started':
          case 'item/completed': {
            const rawItem = asRecord(params.item)
            if (!rawItem) break
            const itemId = readString(rawItem.id)
            const childData = childItemMaps.get(notifThreadId)
            const previous = itemId ? childData?.map.get(itemId) : undefined
            if (previous?.type === 'plan' && method === 'item/completed') {
              emitCollabUpdate(collabId, `child:${method}:plan`)
              break
            }
            const mapped = mapThreadItemFromAppServer(rawItem, previous)
            if (mapped) {
              upsertChildItem(notifThreadId, mapped)
              emitCollabUpdate(collabId, `child:${method}:${mapped.type}`)
            }
            break
          }

          case 'item/agentMessage/delta': {
            const itemId = readString(params.itemId)
            const delta = readString(params.delta) ?? ''
            if (!itemId) break
            const childData = childItemMaps.get(notifThreadId)
            const prev = childData?.map.get(itemId)
            const prevText = prev?.type === 'agent_message' ? prev.text : ''
            upsertChildItem(notifThreadId, { id: itemId, type: 'agent_message', text: `${prevText}${delta}` })
            emitCollabUpdate(collabId, 'child:agentMessage/delta')
            break
          }

          case 'item/reasoning/summaryTextDelta':
          case 'item/reasoning/summary_text_delta':
          case 'item/reasoning/summaryDelta':
          case 'item/reasoning/summary_delta':
          case 'item/reasoning/summaryPartAdded':
          case 'item/reasoning/summary_part_added':
          case 'item/reasoning/textDelta':
          case 'item/reasoning/text_delta':
          case 'item/reasoning/delta': {
            const itemId = readItemId(params)
            const delta = readDeltaText(params)
            if (!itemId) break
            const childData = childItemMaps.get(notifThreadId)
            const prev = childData?.map.get(itemId)
            const prevText = prev?.type === 'reasoning' ? prev.text : ''
            const nextText = (method === 'item/reasoning/summaryPartAdded' || method === 'item/reasoning/summary_part_added')
              ? (prevText && !prevText.endsWith('\n\n') ? `${prevText}\n\n` : prevText)
              : `${prevText}${delta}`
            upsertChildItem(notifThreadId, { id: itemId, type: 'reasoning', text: nextText })
            emitCollabUpdate(collabId, `child:reasoning/delta`)
            break
          }

          case 'item/commandExecution/outputDelta': {
            const itemId = readString(params.itemId)
            const delta = readString(params.delta) ?? ''
            if (!itemId) break
            const childData = childItemMaps.get(notifThreadId)
            const prev = childData?.map.get(itemId)
            const prevCmd = prev?.type === 'command_execution' ? prev : null
            upsertChildItem(notifThreadId, {
              id: itemId,
              type: 'command_execution',
              command: prevCmd?.command ?? '',
              aggregatedOutput: `${prevCmd?.aggregatedOutput ?? ''}${delta}`,
              ...(prevCmd?.exitCode !== undefined ? { exitCode: prevCmd.exitCode } : {}),
              status: prevCmd?.status ?? 'in_progress',
              ...(prevCmd?.commandActions ? { commandActions: prevCmd.commandActions } : {}),
            })
            emitCollabUpdate(collabId, 'child:commandExecution/outputDelta')
            break
          }

          default:
            break
        }
        continue
      }

      switch (method) {
        case 'item/started':
        case 'item/completed': {
          const rawItem = asRecord(params.item)
          if (!rawItem) break

          const itemId = readString(rawItem.id)
          const previous = itemId ? itemMap.get(itemId) : undefined
          if (previous?.type === 'plan' && method === 'item/completed') {
            callbacks?.onItemDelta?.('completed', previous)
            break
          }
          const mapped = mapThreadItemFromAppServer(rawItem, previous)
          if (!mapped) break

          upsertItem(itemOrder, itemMap, mapped)
          callbacks?.onItemDelta?.(method === 'item/started' ? 'started' : 'completed', mapped)

          if (mapped.type === 'collab_tool_call') {
            if (process.env.NODE_ENV === 'development') {
              trace('codex.collab', `${method === 'item/started' ? 'started' : 'completed'}:${mapped.tool}`, {
                collabId: mapped.id,
                tool: mapped.tool,
                status: mapped.status,
                prompt: mapped.prompt?.slice(0, 200),
                agentIds: Object.keys(mapped.agentsStates),
                agentStatuses: Object.fromEntries(Object.entries(mapped.agentsStates).map(([k, v]) => [k, v.status])),
                receiverThreadIds: mapped.receiverThreadIds,
              }, mapped.id)
            }
            if (method === 'item/completed' && mapped.tool === 'spawnAgent') {
              for (const tid of mapped.receiverThreadIds) {
                await subscribeChildThread(tid, mapped.id)
              }
            }
            if (method === 'item/completed' && mapped.tool === 'closeAgent' && mapped.status === 'completed') {
              for (const tid of mapped.receiverThreadIds) {
                await unsubscribeChildThread(tid)
              }
            }
          }
          break
        }

        case 'item/agentMessage/delta': {
          const itemId = readString(params.itemId)
          const delta = readString(params.delta) ?? ''
          if (!itemId) break

          const previous = itemMap.get(itemId)
          const previousText = previous?.type === 'agent_message' ? previous.text : ''
          const updated: CodexThreadItem = {
            id: itemId,
            type: 'agent_message',
            text: `${previousText}${delta}`,
          }
          upsertItem(itemOrder, itemMap, updated)
          callbacks?.onItemDelta?.('updated', updated)
          break
        }

        case 'item/reasoning/summaryTextDelta':
        case 'item/reasoning/summary_text_delta':
        case 'item/reasoning/summaryDelta':
        case 'item/reasoning/summary_delta':
        case 'item/reasoning/summaryPartAdded':
        case 'item/reasoning/summary_part_added':
        case 'item/reasoning/textDelta':
        case 'item/reasoning/text_delta':
        case 'item/reasoning/delta': {
          const itemId = readItemId(params)
          const delta = readDeltaText(params)
          if (!itemId) break

          const previous = itemMap.get(itemId)
          const previousText = previous?.type === 'reasoning' ? previous.text : ''
          const nextText = (
            method === 'item/reasoning/summaryPartAdded'
            || method === 'item/reasoning/summary_part_added'
          )
            ? (previousText && !previousText.endsWith('\n\n') ? `${previousText}\n\n` : previousText)
            : `${previousText}${delta}`
          const updated: CodexThreadItem = {
            id: itemId,
            type: 'reasoning',
            text: nextText,
          }
          upsertItem(itemOrder, itemMap, updated)
          callbacks?.onItemDelta?.('updated', updated)
          break
        }

        case 'item/plan/delta': {
          const itemId = readItemId(params)
          const delta = readDeltaText(params)
          if (!itemId) break

          const previous = itemMap.get(itemId)
          const previousText = previous?.type === 'plan' ? previous.text : ''
          const updated: CodexThreadItem = {
            id: itemId,
            type: 'plan',
            text: `${previousText}${delta}`,
          }
          upsertItem(itemOrder, itemMap, updated)
          callbacks?.onItemDelta?.('updated', updated)
          break
        }

        case 'item/commandExecution/outputDelta': {
          const itemId = readString(params.itemId)
          const delta = readString(params.delta) ?? ''
          if (!itemId) break

          const previous = itemMap.get(itemId)
          const previousCommand = previous?.type === 'command_execution' ? previous : null
          const updated: CodexThreadItem = {
            id: itemId,
            type: 'command_execution',
            command: previousCommand?.command ?? '',
            aggregatedOutput: `${previousCommand?.aggregatedOutput ?? ''}${delta}`,
            ...(previousCommand?.exitCode !== undefined ? { exitCode: previousCommand.exitCode } : {}),
            status: previousCommand?.status ?? 'in_progress',
            ...(previousCommand?.commandActions ? { commandActions: previousCommand.commandActions } : {}),
          }
          upsertItem(itemOrder, itemMap, updated)
          callbacks?.onItemDelta?.('updated', updated)
          break
        }

        case 'turn/plan/updated': {
          const plan = Array.isArray(params.plan) ? params.plan : []
          if (plan.length === 0) break

          const todoId = activeTurnId ? `todo_${activeTurnId}` : 'todo_current'
          const todoItems = plan
            .map((entry) => {
              const step = asRecord(entry)
              const text = readString(step?.step)
              if (!text) return null
              return {
                text,
                completed: readString(step?.status) === 'completed',
              }
            })
            .filter((entry): entry is { text: string; completed: boolean } => entry !== null)

          if (todoItems.length === 0) break

          const updated: CodexThreadItem = {
            id: todoId,
            type: 'todo_list',
            items: todoItems,
          }
          upsertItem(itemOrder, itemMap, updated)
          callbacks?.onItemDelta?.('updated', updated)
          break
        }

        case 'thread/tokenUsage/updated': {
          const nextUsage = mapUsageFromTokenUsage(params.tokenUsage ?? params)
          if (nextUsage) {
            usage = nextUsage
            callbacks?.onUsageDelta?.(nextUsage)
          }
          break
        }

        case 'error': {
          const willRetry = readBoolean(params.willRetry) ?? false
          if (willRetry) break
          throw new Error(extractTurnErrorMessage(params))
        }

        case 'turn/completed': {
          const completedTurn = asRecord(params.turn)
          const status = readString(completedTurn?.status) ?? 'completed'
          if (status === 'failed') {
            throw new Error(extractTurnErrorMessage(completedTurn?.error ?? params))
          }
          if (status === 'interrupted') {
            throw new Error('Codex run interrupted')
          }
          turnCompleted = true
          break
        }

        case 'codex/event/collab_agent_spawn_end': {
          const msg = asRecord(params.msg)
          if (!msg) break
          const callId = readString(msg.call_id)
          const newThreadId = readString(msg.new_thread_id)
          const nickname = readString(msg.new_agent_nickname)
          const role = readString(msg.new_agent_role)
          if (!callId) break
          const collab = itemMap.get(callId)
          if (!collab || collab.type !== 'collab_tool_call') break
          if (newThreadId && (nickname || role)) {
            const prev = collab.agentsStates[newThreadId] ?? {
              status: 'pendingInit' as CodexCollabAgentStatus,
            }
            collab.agentsStates[newThreadId] = {
              ...prev,
              ...(nickname ? { nickname } : {}),
              ...(role ? { role } : {}),
            }
            upsertItem(itemOrder, itemMap, collab)
            callbacks?.onItemDelta?.('updated', collab)
          }
          break
        }

        default:
          break
      }
    }

    const items = itemOrder
      .map((id) => itemMap.get(id))
      .filter((item): item is CodexThreadItem => Boolean(item))

    return {
      threadId: session.threadId,
      usage,
      items,
    }
  }

  async run(
    sessionId: string,
    projectPath: string,
    request: CodexRunRequest,
    callbacks?: CodexRunStreamCallbacks,
  ): Promise<CodexRunResult> {
    const prompt = request.prompt.trim()
    const persistedImagePaths = request.images?.length ? persistImageAttachments(projectPath, request.images) : []
    const normalizedPrompt = prompt || (persistedImagePaths.length > 0 ? 'Please analyze the attached images.' : '')
    if (!normalizedPrompt) {
      throw new Error('Codex prompt is empty')
    }

    const session = this.ensureSession(
      sessionId,
      projectPath,
      request.model,
      request.threadId,
      request.reasoningEffort,
      request.permissionPreset,
    )
    if (session.runningController) {
      throw new Error('Codex is already running for this project')
    }

    const controller = new AbortController()
    session.runningController = controller

    try {
      const permissionProfile = resolvePermissionProfile(session.permissionPreset)
      const effectiveCwd = this.resolveCwd(session, projectPath, request.cwd)
      const collaborationMode = buildCollaborationMode(
        request.collaborationMode,
        session.model,
        session.modelReasoningEffort,
      )

      const auth = this.getProjectAuth(projectPath)
      const streamed = await this.withAppServerConnection(auth, controller.signal, async (connection) => {
        const resolvedThreadId = await this.resolveThread(connection, session, effectiveCwd, permissionProfile)

        const turnStartResult = await connection.request(
          'turn/start',
          compactRecord({
            threadId: resolvedThreadId,
            input: [
              {
                type: 'text',
                text: normalizedPrompt,
                text_elements: [],
              },
              ...persistedImagePaths.map((path) => ({ type: 'localImage', path })),
            ],
            model: session.model,
            effort: session.modelReasoningEffort,
            approvalPolicy: permissionProfile.approvalPolicy,
            sandboxPolicy: this.buildTurnSandboxPolicy(effectiveCwd, permissionProfile),
            ...(collaborationMode ? { collaborationMode } : {}),
          }),
        )

        const turn = asRecord(turnStartResult.turn)
        const activeTurnId = readString(turn?.id)

        // Set up steer capability while turn is active
        session.activeTurnId = activeTurnId
        let steerSeq = 9000
        session.steerFn = async (text: string) => {
          steerSeq += 1
          await connection.request('turn/steer', {
            threadId: resolvedThreadId,
            input: [{ type: 'text', text }],
            expectedTurnId: activeTurnId,
          })
        }

        try {
          return await this.streamTurnEvents(connection, session, activeTurnId, controller, callbacks)
        } finally {
          session.activeTurnId = null
          session.steerFn = null
        }
      })

      return {
        threadId: streamed.threadId,
        finalResponse: deriveFinalResponse(streamed.items),
        usage: streamed.usage,
        items: streamed.items,
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Codex run interrupted')
      }
      throw error
    } finally {
      this.rejectPendingApprovals(session, 'Codex run interrupted')
      cleanupPersistedImageAttachments(persistedImagePaths)
      if (session.runningController === controller) {
        session.runningController = null
      }
    }
  }

  async steer(sessionId: string, input: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session?.steerFn) {
      throw new Error('No active Codex turn to steer')
    }
    await session.steerFn(input)
  }

  async review(
    sessionId: string,
    projectPath: string,
    request: CodexReviewRequest,
    callbacks?: CodexRunStreamCallbacks,
  ): Promise<CodexRunResult> {
    const session = this.ensureSession(
      sessionId,
      projectPath,
      request.model,
      request.threadId,
      undefined,
      request.permissionPreset,
    )
    if (session.runningController) {
      throw new Error('Codex is already running for this project')
    }

    const controller = new AbortController()
    session.runningController = controller

    try {
      const permissionProfile = resolvePermissionProfile(session.permissionPreset)
      const effectiveCwd = this.resolveCwd(session, projectPath, request.cwd)
      const auth = this.getProjectAuth(projectPath)

      const streamed = await this.withAppServerConnection(auth, controller.signal, async (connection) => {
        const resolvedThreadId = await this.resolveThread(connection, session, effectiveCwd, permissionProfile)

        await connection.request('review/start', compactRecord({
          threadId: resolvedThreadId,
          delivery: 'inline',
          target: request.target,
        }))

        return this.streamTurnEvents(connection, session, null, controller, callbacks)
      })

      return {
        threadId: streamed.threadId,
        finalResponse: deriveFinalResponse(streamed.items),
        usage: streamed.usage,
        items: streamed.items,
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Codex run interrupted')
      }
      throw error
    } finally {
      this.rejectPendingApprovals(session, 'Codex run interrupted')
      if (session.runningController === controller) {
        session.runningController = null
      }
    }
  }

  async compact(
    sessionId: string,
    projectPath: string,
    request: CodexCompactRequest,
    callbacks?: CodexRunStreamCallbacks,
  ): Promise<CodexRunResult> {
    const session = this.ensureSession(
      sessionId,
      projectPath,
      request.model,
      request.threadId,
      undefined,
      request.permissionPreset,
    )
    if (session.runningController) {
      throw new Error('Codex is already running for this project')
    }

    const controller = new AbortController()
    session.runningController = controller

    try {
      const permissionProfile = resolvePermissionProfile(session.permissionPreset)
      const effectiveCwd = this.resolveCwd(session, projectPath, request.cwd)
      const auth = this.getProjectAuth(projectPath)

      const streamed = await this.withAppServerConnection(auth, controller.signal, async (connection) => {
        const resolvedThreadId = await this.resolveThread(connection, session, effectiveCwd, permissionProfile)

        await connection.request('thread/compact/start', { threadId: resolvedThreadId })

        return this.streamTurnEvents(connection, session, null, controller, callbacks)
      })

      return {
        threadId: streamed.threadId,
        finalResponse: deriveFinalResponse(streamed.items),
        usage: streamed.usage,
        items: streamed.items,
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Codex run interrupted')
      }
      throw error
    } finally {
      this.rejectPendingApprovals(session, 'Codex run interrupted')
      if (session.runningController === controller) {
        session.runningController = null
      }
    }
  }

  interrupt(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session?.runningController) return false
    session.runningController.abort()
    return true
  }

  respondToPermission(
    sessionId: string,
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    reason?: string,
    decision?: 'cancel',
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    const pending = session.pendingApprovals.get(requestId)
    if (!pending) return false

    if (pending.responseKind === 'user_input') return false

    session.pendingApprovals.delete(requestId)
    const resolvedDecision: CodexApprovalDecision = decision === 'cancel'
      ? 'cancel'
      : allow
        ? (alwaysAllow ? 'acceptForSession' : 'accept')
        : 'decline'
    pending.resolve({ decision: resolvedDecision })
    return true
  }

  respondToQuestion(
    sessionId: string,
    requestId: string,
    answers: Record<string, string>,
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    const pending = session.pendingApprovals.get(requestId)
    if (!pending || pending.responseKind !== 'user_input') return false

    session.pendingApprovals.delete(requestId)
    pending.resolve(buildUserInputAnswersResponse(pending.questions ?? [], answers))
    return true
  }

  dismissQuestion(sessionId: string, requestId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    const pending = session.pendingApprovals.get(requestId)
    if (!pending || pending.responseKind !== 'user_input') return false

    session.pendingApprovals.delete(requestId)
    pending.resolve(buildUserInputApprovalResponse(pending.questions ?? [], false))
    return true
  }

  reset(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.rejectPendingApprovals(session, 'Codex run interrupted')
    if (session.runningController) session.runningController.abort()
    session.threadId = null
    session.effectiveCwd = null
    session.runningController = null
  }

  setAuth(projectPath: string, request: CodexSetAuthRequest): CodexAuthStatus {
    const currentAuth = this.getProjectAuth(projectPath)
    const mode = request.mode
    const apiKey = mode === 'apiKey'
      ? normalizeApiKey(request.apiKey) ?? currentAuth.apiKey
      : undefined

    if (mode === 'apiKey' && !resolveApiKey('apiKey', apiKey)) {
      throw new Error('API key mode requires apiKey or CODEX_API_KEY')
    }

    for (const session of this.sessions.values()) {
      if (session.projectPath !== projectPath) continue
      this.rejectPendingApprovals(session, 'Codex run interrupted')
      if (session.runningController) session.runningController.abort()
      session.runningController = null
      session.activeTurnId = null
      session.steerFn = null
    }

    this.projectAuth.set(projectPath, { mode, apiKey: normalizeApiKey(apiKey) })
    return this.getAuthStatus(projectPath)
  }

  getAuthStatus(projectPath: string): CodexAuthStatus {
    const auth = this.getProjectAuth(projectPath)
    const isRunning = Array.from(this.sessions.values()).some(
      (session) => session.projectPath === projectPath && Boolean(session.runningController),
    )
    return {
      mode: auth.mode,
      resolvedMode: resolveMode(auth.mode, auth.apiKey),
      hasEnvApiKey: Boolean(normalizeApiKey(process.env.CODEX_API_KEY)),
      hasSessionApiKey: Boolean(normalizeApiKey(auth.apiKey)),
      isRunning,
    }
  }

  closeProject(projectPath: string): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.projectPath !== projectPath) continue
      this.rejectPendingApprovals(session, 'Codex run interrupted')
      if (session.runningController) session.runningController.abort()
      this.sessions.delete(sessionId)
    }
    this.projectAuth.delete(projectPath)
  }

  dispose(): void {
    for (const [, session] of this.sessions) {
      this.rejectPendingApprovals(session, 'Codex run interrupted')
      if (session.runningController) session.runningController.abort()
    }
    this.sessions.clear()
    this.projectAuth.clear()
  }
}
