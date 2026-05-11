import { mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, extname, join } from 'path'
import log from '../logger'
import { trace } from '../agent/event-trace'
import {
  asRecord,
  buildCollaborationMode,
  compactRecord,
  createAppServerConnection,
  normalizeApiKey,
  readString,
  resolvePermissionProfile,
  type AppServerConnection,
  type AppServerConnectionHandle,
  type AppServerNotification,
  type CodexProjectAuth,
} from './app-server-connection'
import type {
  AppServerUserInputQuestion,
  CodexApprovalDecision,
  CodexSession,
  PendingCodexApprovalResponse,
} from './codex-session'
import type {
  AskUserQuestionRequest,
  CodexCollabAgentState,
  CodexCollabAgentStatus,
  CodexCollabTool,
  CodexCollabToolCallItem,
  CodexCommandExecutionStatus,
  CodexCompactRequest,
  CodexMcpToolCallStatus,
  CodexPatchApplyStatus,
  CodexPatchChangeKind,
  CodexReasoningEffort,
  CodexReviewRequest,
  CodexRunRequest,
  CodexRunResult,
  CodexSandboxMode,
  CodexThreadItem,
  CodexUsageInfo,
  ElicitationFormField,
  ElicitationFormFieldType,
  ImageAttachment,
  PermissionRequest,
} from '@superone/shared/agent-types'
import { getCodexSuperoneMcpConfig } from '../mcp/superone-mcp-stdio-state'
import { isToolPreapproved } from '../mcp/superone-mcp-server'

const SUPERONE_MCP_TOOL_NAME_PATTERN = /run tool "([a-z0-9_]+)"/i
const MCP_SUPERONE_TOOL_PREFIX = 'mcp__superone__'

export function extractSuperoneMiniAppToolName(message: string): string | null {
  const match = message.match(SUPERONE_MCP_TOOL_NAME_PATTERN)
  if (!match) return null
  const namespacedName = match[1]
  if (!namespacedName.includes('__')) return null
  return `${MCP_SUPERONE_TOOL_PREFIX}${namespacedName}`
}

export interface CodexRunStreamCallbacks {
  onThreadStarted?: (threadId: string) => void
  onItemDelta?: (phase: 'started' | 'updated' | 'completed', item: CodexThreadItem) => void
  onUsageDelta?: (usage: CodexUsageInfo) => void
  onPermissionRequest?: (request: PermissionRequest) => void
  onAskUserQuestion?: (request: AskUserQuestionRequest) => void
}

export type ParsedApprovalRequest =
  | {
    request: PermissionRequest
    responseKind: 'decision'
  }
  | {
    request: AskUserQuestionRequest
    responseKind: 'user_input'
    questions: AppServerUserInputQuestion[]
  }
  | {
    request: PermissionRequest
    responseKind: 'elicitation'
    formFields: ElicitationFormField[]
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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const result: string[] = []
  for (const value of values) {
    if (!value || result.includes(value)) continue
    result.push(value)
  }
  return result
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

function readNotificationThreadId(params: Record<string, unknown>): string | null {
  return readString(params.threadId)
    ?? readString(params.thread_id)
    ?? readString(asRecord(params.thread)?.id)
}

function readNotificationTurnId(params: Record<string, unknown>): string | null {
  return readString(params.turnId)
    ?? readString(params.turn_id)
    ?? readString(asRecord(params.turn)?.id)
}

function normalizeCollabTool(value: unknown): CodexCollabTool | null {
  switch (readString(value)) {
    case 'spawnAgent':
    case 'spawn_agent':
      return 'spawnAgent'
    case 'sendInput':
    case 'send_input':
      return 'sendInput'
    case 'wait':
    case 'wait_agent':
      return 'wait'
    case 'closeAgent':
    case 'close_agent':
      return 'closeAgent'
    case 'resumeAgent':
    case 'resume_agent':
      return 'resumeAgent'
    default:
      return null
  }
}

function normalizeCollabAgentStatus(value: unknown): CodexCollabAgentStatus | null {
  switch (readString(value)) {
    case 'pendingInit':
    case 'pending_init':
      return 'pendingInit'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'errored':
    case 'error':
      return 'errored'
    case 'shutdown':
      return 'shutdown'
    case 'notFound':
    case 'not_found':
      return 'notFound'
    default:
      return null
  }
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

function persistImageAttachments(_projectPath: string, images: ImageAttachment[]): string[] {
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

export function mapThreadItemFromAppServer(raw: unknown, previous?: CodexThreadItem): CodexThreadItem | null {
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

    case 'image_generation':
    case 'imageGeneration': {
      const prev = previous?.type === 'image_generation' ? previous : null
      const status = readString(rec.status) ?? prev?.status ?? 'in_progress'
      const revisedPrompt = readString(rec.revisedPrompt ?? rec.revised_prompt) ?? prev?.revisedPrompt
      const savedPath = readString(rec.savedPath ?? rec.saved_path) ?? prev?.savedPath
      return {
        id,
        type: 'image_generation',
        status,
        ...(revisedPrompt ? { revisedPrompt } : {}),
        ...(savedPath ? { savedPath } : {}),
      }
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

    case 'collabAgentToolCall':
    case 'collabToolCall': {
      const prevCollab = previous?.type === 'collab_tool_call' ? previous : null
      const tool = normalizeCollabTool(rec.tool) ?? prevCollab?.tool ?? 'spawnAgent'
      const statusStr = readString(rec.status)
      const status: 'in_progress' | 'completed' = statusStr === 'completed' ? 'completed' : 'in_progress'
      const senderThreadId = readString(rec.senderThreadId) ?? readString(rec.sender_thread_id) ?? prevCollab?.senderThreadId
      const receiverThreadIds = uniqueStrings([
        ...readStringArray(rec.receiverThreadIds ?? rec.receiver_thread_ids),
        readString(rec.receiverThreadId ?? rec.receiver_thread_id),
        readString(rec.newThreadId ?? rec.new_thread_id),
      ])
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
            status: normalizeCollabAgentStatus(stateRec.status) ?? prevAgentState?.status ?? 'running',
            ...(stateRec.nickname != null ? { nickname: readString(stateRec.nickname) ?? undefined } : {}),
            ...(stateRec.role != null ? { role: readString(stateRec.role) ?? undefined } : {}),
            ...(stateRec.message != null ? { message: readString(stateRec.message) ?? undefined } : {}),
          }
        }
      }

      const rawAgentStatus = rec.agentStatus ?? rec.agent_status
      const agentStatusRec = asRecord(rawAgentStatus)
      if (!rawStates && receiverThreadIds.length > 0 && rawAgentStatus != null) {
        for (const agentId of receiverThreadIds) {
          const prevAgentState = prevCollab?.agentsStates?.[agentId]
          agentsStates[agentId] = {
            ...prevAgentState,
            status: normalizeCollabAgentStatus(agentStatusRec?.status ?? rawAgentStatus) ?? prevAgentState?.status ?? 'running',
            ...(agentStatusRec?.nickname != null ? { nickname: readString(agentStatusRec.nickname) ?? undefined } : {}),
            ...(agentStatusRec?.role != null ? { role: readString(agentStatusRec.role) ?? undefined } : {}),
            ...(agentStatusRec?.message != null ? { message: readString(agentStatusRec.message) ?? undefined } : {}),
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

function parseElicitationSchema(schema: Record<string, unknown> | null): ElicitationFormField[] {
  if (!schema) return []
  const properties = asRecord(schema.properties)
  if (!properties || Object.keys(properties).length === 0) return []
  const required = Array.isArray(schema.required)
    ? schema.required.filter((r): r is string => typeof r === 'string')
    : []
  const fields: ElicitationFormField[] = []
  for (const [name, raw] of Object.entries(properties)) {
    const propRec = asRecord(raw)
    if (!propRec) continue
    const t = readString(propRec.type)
    const label = readString(propRec.title) ?? name
    const description = readString(propRec.description) ?? undefined
    const isRequired = required.includes(name)
    const enumValues = Array.isArray(propRec.enum)
      ? propRec.enum.filter((v): v is string => typeof v === 'string')
      : undefined
    let fieldType: ElicitationFormFieldType | null = null
    let enumOptions: string[] | undefined
    if (enumValues && enumValues.length > 0 && t === 'string') {
      fieldType = 'enum'
      enumOptions = enumValues
    } else if (t === 'boolean') {
      fieldType = 'boolean'
    } else if (t === 'number' || t === 'integer') {
      fieldType = 'number'
    } else if (t === 'string') {
      fieldType = 'string'
    }
    if (!fieldType) continue
    fields.push({
      name,
      type: fieldType,
      label,
      ...(description ? { description } : {}),
      required: isRequired,
      ...(enumOptions ? { enumOptions } : {}),
    })
  }
  return fields
}

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

export function mapApprovalRequest(notification: AppServerNotification): ParsedApprovalRequest | null {
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

  if (notification.method === 'mcpServer/elicitation/request') {
    const message = readString(notification.params.message) ?? ''
    const serverName = readString(notification.params.serverName) ?? 'mcp'
    const meta = asRecord(notification.params._meta)
    const subtitle = readString(meta?.subtitle) ?? undefined
    const rawRiskLevel = readString(meta?.riskLevel)
    const riskLevel = (rawRiskLevel === 'low' || rawRiskLevel === 'medium' || rawRiskLevel === 'high')
      ? rawRiskLevel
      : undefined
    const persistFlags = Array.isArray(meta?.persist)
      ? (meta.persist as unknown[]).filter((v): v is string => typeof v === 'string')
      : []
    const supportsAlwaysPersist = persistFlags.includes('always')
    const schema = asRecord(notification.params.requestedSchema)
    const formFields = parseElicitationSchema(schema)

    const miniAppToolName = serverName === 'superone' && formFields.length === 0
      ? extractSuperoneMiniAppToolName(message)
      : null
    if (miniAppToolName) {
      return {
        responseKind: 'elicitation',
        formFields: [],
        request: {
          requestId,
          toolName: miniAppToolName,
          toolUseId: requestId,
          input: {},
          allowAlwaysAllow: false,
          supportsAlwaysPersist: false,
        },
      }
    }

    return {
      responseKind: 'elicitation',
      formFields,
      request: {
        requestId,
        toolName: serverName,
        toolUseId: requestId,
        input: {},
        allowAlwaysAllow: supportsAlwaysPersist,
        requestKind: 'mcp_elicitation',
        serverName,
        message,
        ...(subtitle ? { subtitle } : {}),
        ...(riskLevel ? { riskLevel } : {}),
        supportsAlwaysPersist,
        ...(formFields.length > 0 ? { elicitationForm: formFields } : {}),
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

export function rejectPendingApprovals(session: CodexSession, message: string): void {
  if (session.pendingApprovals.size === 0) return
  const error = new Error(message)
  for (const pending of session.pendingApprovals.values()) {
    pending.reject(error)
  }
  session.pendingApprovals.clear()
}

export async function closeSessionConnection(session: CodexSession): Promise<void> {
  const handle = session.connectionHandle
  session.connectionHandle = null
  session.connectionAuth = null
  session.threadId = null
  session.threadReady = false
  if (handle) {
    try { await handle.close() } catch (err) {
      log.warn('[codex] close connection error:', err instanceof Error ? err.message : String(err))
    }
  }
}

function authsMatch(a: CodexProjectAuth, b: CodexProjectAuth): boolean {
  return a.mode === b.mode && normalizeApiKey(a.apiKey) === normalizeApiKey(b.apiKey)
}

export async function withSessionConnection<T>(
  session: CodexSession,
  auth: CodexProjectAuth,
  signal: AbortSignal | undefined,
  fn: (connection: AppServerConnection) => Promise<T>,
): Promise<T> {
  if (session.connectionHandle && session.connectionAuth && !authsMatch(session.connectionAuth, auth)) {
    await closeSessionConnection(session)
  }

  if (!session.connectionHandle) {
    const handle = await createAppServerConnection(auth, signal)
    handle.onClosed((info) => {
      if (session.connectionHandle === handle) {
        session.connectionHandle = null
        session.connectionAuth = null
        session.threadId = null
        session.threadReady = false
        log.info('[codex] app-server exited code=%s signal=%s', info.code, info.signal)
      }
    })
    session.connectionHandle = handle
    session.connectionAuth = { mode: auth.mode, apiKey: auth.apiKey }
  }

  const handle = session.connectionHandle
  try {
    return await fn(handle.connection)
  } catch (error) {
    const stderr = handle.getStderr().trim()
    const childExited = session.connectionHandle !== handle
    if (stderr || childExited) {
      log.error('[codex] app-server error:', error instanceof Error ? error.message : String(error))
      if (stderr) log.error('[codex] app-server stderr:', stderr)
      await closeSessionConnection(session)
      if (stderr) {
        const message = error instanceof Error ? error.message : String(error)
        const debugLogPath = String(log.transports.file.getFile().path)
        throw new Error(`${message}\n${stderr}\nDebug log: ${debugLogPath}`)
      }
    }
    throw error
  }
}

export function resolveCwd(session: CodexSession, projectPath: string, requestedCwd?: string): string {
  const cwd = requestedCwd || session.effectiveCwd || projectPath
  if (session.effectiveCwd && session.effectiveCwd !== cwd) {
    session.threadId = null
    session.threadReady = false
  }
  session.effectiveCwd = cwd
  return cwd
}

function buildThreadConfig(
  superoneSessionId: string,
  permissionProfile: {
    sandboxMode: CodexSandboxMode
    networkAccessEnabled: boolean
  },
): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {}
  if (permissionProfile.sandboxMode === 'workspace-write') {
    config.sandbox_workspace_write = {
      network_access: permissionProfile.networkAccessEnabled,
    }
  }
  const superoneMcpConfig = getCodexSuperoneMcpConfig(superoneSessionId)
  if (superoneMcpConfig) {
    config.mcp_servers = { superone: superoneMcpConfig }
  }
  return Object.keys(config).length > 0 ? config : undefined
}

function buildTurnSandboxPolicy(
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

export async function resolveThread(
  connection: AppServerConnection,
  session: CodexSession,
  projectPath: string,
  cwd: string,
  permissionProfile: ReturnType<typeof resolvePermissionProfile>,
): Promise<string> {
  const threadConfig = buildThreadConfig(session.superoneSessionId, permissionProfile)
  if (session.threadId && session.threadReady) {
    trace('codex.thread', 'reuse_ready', {
      threadId: session.threadId,
      cwd,
      model: session.model,
      permissionPreset: permissionProfile.permissionPreset,
    }, session.threadId)
    return session.threadId
  }

  const startNewThread = async () => {
    const startedAt = Date.now()
    const result = await connection.request(
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
    trace('codex.thread', 'start_response', {
      cwd,
      model: session.model,
      permissionPreset: permissionProfile.permissionPreset,
      durMs: Date.now() - startedAt,
    }, session.threadId ?? undefined)
    return result
  }

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
      ).catch((err) => {
        const failedThreadId = session.threadId
        const message = err instanceof Error ? err.message : String(err)
        log.info('[codex] thread/resume failed thread=%s: %s', failedThreadId ?? 'unknown', message)
        trace('codex.thread', 'resume_failed', {
          threadId: failedThreadId,
          cwd,
          model: session.model,
          permissionPreset: permissionProfile.permissionPreset,
          error: message,
        }, failedThreadId ?? undefined)
        session.threadId = null
        session.threadReady = false
        return startNewThread()
      })
    : await startNewThread()

  const thread = asRecord(threadResult.thread)
  const resolvedThreadId = readString(thread?.id)
  if (!resolvedThreadId) {
    throw new Error('Failed to resolve Codex thread id')
  }

  session.threadId = resolvedThreadId
  session.threadReady = true
  return resolvedThreadId
}

async function respondToPrewarmRequest(connection: AppServerConnection, notification: AppServerNotification): Promise<void> {
  if (notification.requestIdRaw === undefined) return
  const parsed = mapApprovalRequest(notification)
  if (parsed?.responseKind === 'user_input') {
    await connection.respond(notification.requestIdRaw, buildUserInputApprovalResponse(parsed.questions, false))
    return
  }
  if (parsed?.responseKind === 'decision') {
    await connection.respond(notification.requestIdRaw, { decision: 'decline' })
    return
  }
  if (parsed?.responseKind === 'elicitation') {
    await connection.respond(notification.requestIdRaw, { action: 'decline', content: null, _meta: null })
    return
  }
  await connection.respond(notification.requestIdRaw, {})
}

async function drainPrewarmNotifications(
  connection: AppServerConnection,
  session: CodexSession,
  deadlineMs = 12_000,
  idleMs = 750,
): Promise<void> {
  if (!connection.pollNotification) return
  const deadline = Date.now() + deadlineMs
  const pendingMcpServers = new Set<string>()
  while (Date.now() < deadline) {
    const timeoutMs = Math.max(1, Math.min(pendingMcpServers.size > 0 ? 1_000 : idleMs, deadline - Date.now()))
    const notification = await connection.pollNotification(timeoutMs)
    if (!notification) {
      if (pendingMcpServers.size === 0) return
      continue
    }

    const { method, params } = notification
    if (process.env.NODE_ENV === 'development') {
      trace('codex.prewarm.raw', method, {
        params,
        itemId: readItemId(params),
        itemType: readString(asRecord(params.item)?.type),
        deltaText: readDeltaText(params),
      }, session.threadId ?? undefined)
    }

    if (notification.requestIdRaw !== undefined) {
      await respondToPrewarmRequest(connection, notification)
      continue
    }

    if (method === 'thread/started') {
      const startedThreadId = readString(asRecord(params.thread)?.id)
      if (startedThreadId) {
        session.threadId = startedThreadId
        session.threadReady = true
      }
      continue
    }

    if (method === 'mcpServer/startupStatus/updated') {
      const name = readString(params.name)
      const status = readString(params.status)
      if (!name) continue
      if (status === 'starting') pendingMcpServers.add(name)
      else pendingMcpServers.delete(name)
    }
  }
}

export async function prewarmCodexSession(
  handle: AppServerConnectionHandle,
  session: CodexSession,
  cwd: string,
): Promise<string> {
  const permissionProfile = resolvePermissionProfile(session.permissionPreset)
  const threadId = await resolveThread(handle.connection, session, session.projectPath, cwd, permissionProfile)
  await drainPrewarmNotifications(handle.connection, session)
  return threadId
}

export async function streamTurnEvents(
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
      const fallbackResponse: PendingCodexApprovalResponse =
        parsedApprovalRequest.responseKind === 'user_input'
          ? buildUserInputApprovalResponse(parsedApprovalRequest.questions, false)
          : parsedApprovalRequest.responseKind === 'elicitation'
            ? { action: 'decline', content: null, _meta: null }
            : { decision: 'decline' }

      const respondToServer = (req: typeof notification.requestIdRaw, resp: PendingCodexApprovalResponse): Promise<void> =>
        connection.respond(req!, resp as unknown as Record<string, unknown>)

      if (parsedApprovalRequest.responseKind === 'elicitation') {
        const requestToolName = parsedApprovalRequest.request.toolName
        if (
          typeof requestToolName === 'string'
          && requestToolName.startsWith(MCP_SUPERONE_TOOL_PREFIX)
          && isToolPreapproved(requestToolName)
        ) {
          await respondToServer(notification.requestIdRaw, { action: 'accept', content: null, _meta: null })
          return true
        }
      }

      if (controller.signal.aborted) {
        await respondToServer(notification.requestIdRaw, fallbackResponse)
        return true
      }
      const canHandleRequest = parsedApprovalRequest.responseKind === 'user_input'
        ? callbacks?.onAskUserQuestion
        : callbacks?.onPermissionRequest
      if (!canHandleRequest) {
        await respondToServer(notification.requestIdRaw, fallbackResponse)
        return true
      }
      try {
        const responsePromise = new Promise<PendingCodexApprovalResponse>((resolve, reject) => {
          session.pendingApprovals.set(parsedApprovalRequest.request.requestId, {
            responseKind: parsedApprovalRequest.responseKind,
            questions: parsedApprovalRequest.responseKind === 'user_input'
              ? parsedApprovalRequest.questions
              : undefined,
            formFields: parsedApprovalRequest.responseKind === 'elicitation'
              ? parsedApprovalRequest.formFields
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
        await respondToServer(notification.requestIdRaw, response)
        return true
      } finally {
        session.pendingApprovals.delete(parsedApprovalRequest.request.requestId)
      }
    }

    await connection.respond(notification.requestIdRaw, {})
    return true
  }

  const isRelevantEvent = (params: Record<string, unknown>): boolean => {
    const notifThreadId = readNotificationThreadId(params)
    if (notifThreadId && subscribedChildThreads.has(notifThreadId)) return true
    if (!activeTurnId) return true
    const turnId = readNotificationTurnId(params)
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
        session.threadReady = true
        emitThreadStarted(startedThreadId)
      }
      continue
    }

    if (!isRelevantEvent(params)) {
      continue
    }

    const notifThreadId = readNotificationThreadId(params)
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
        for (const id of itemOrder) {
          const item = itemMap.get(id)
          if (!item) continue
          if ('status' in item && (item as { status?: string }).status === 'in_progress') {
            const finalized = { ...item, status: 'completed' } as CodexThreadItem
            itemMap.set(id, finalized)
            callbacks?.onItemDelta?.('completed', finalized)
          }
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

export async function prewarmCodexConnection(
  auth: CodexProjectAuth,
  signal?: AbortSignal,
): Promise<AppServerConnectionHandle> {
  return createAppServerConnection(auth, signal)
}

export async function runCodexTurn(
  session: CodexSession,
  auth: CodexProjectAuth,
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

  if (session.runningController) {
    throw new Error('Codex is already running for this project')
  }

  const controller = new AbortController()
  session.runningController = controller

  try {
    const permissionProfile = resolvePermissionProfile(session.permissionPreset)
    const effectiveCwd = resolveCwd(session, projectPath, request.cwd)
    const collaborationMode = buildCollaborationMode(
      request.collaborationMode,
      session.model,
      session.modelReasoningEffort,
    )

    const streamed = await withSessionConnection(session, auth, controller.signal, async (connection) => {
      const resolvedThreadId = await resolveThread(connection, session, projectPath, effectiveCwd, permissionProfile)

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
          ...(session.modelReasoningEffort ? { summary: 'concise' } : {}),
          approvalPolicy: permissionProfile.approvalPolicy,
          sandboxPolicy: buildTurnSandboxPolicy(effectiveCwd, permissionProfile),
          ...(collaborationMode ? { collaborationMode } : {}),
        }),
      )

      const turn = asRecord(turnStartResult.turn)
      const activeTurnId = readString(turn?.id)

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
        return await streamTurnEvents(connection, session, activeTurnId, controller, callbacks)
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
    rejectPendingApprovals(session, 'Codex run interrupted')
    cleanupPersistedImageAttachments(persistedImagePaths)
    if (session.runningController === controller) {
      session.runningController = null
    }
  }
}

export async function steerCodex(session: CodexSession, input: string): Promise<void> {
  if (!session.steerFn) {
    throw new Error('No active Codex turn to steer')
  }
  await session.steerFn(input)
}

export async function reviewCodexTurn(
  session: CodexSession,
  auth: CodexProjectAuth,
  projectPath: string,
  request: CodexReviewRequest,
  callbacks?: CodexRunStreamCallbacks,
): Promise<CodexRunResult> {
  if (session.runningController) {
    throw new Error('Codex is already running for this project')
  }

  const controller = new AbortController()
  session.runningController = controller

  try {
    const permissionProfile = resolvePermissionProfile(session.permissionPreset)
    const effectiveCwd = resolveCwd(session, projectPath, request.cwd)

    const streamed = await withSessionConnection(session, auth, controller.signal, async (connection) => {
      const resolvedThreadId = await resolveThread(connection, session, projectPath, effectiveCwd, permissionProfile)

      await connection.request('review/start', compactRecord({
        threadId: resolvedThreadId,
        delivery: 'inline',
        target: request.target,
      }))

      return streamTurnEvents(connection, session, null, controller, callbacks)
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
    rejectPendingApprovals(session, 'Codex run interrupted')
    if (session.runningController === controller) {
      session.runningController = null
    }
  }
}

export async function compactCodexTurn(
  session: CodexSession,
  auth: CodexProjectAuth,
  projectPath: string,
  request: CodexCompactRequest,
  callbacks?: CodexRunStreamCallbacks,
): Promise<CodexRunResult> {
  if (session.runningController) {
    throw new Error('Codex is already running for this project')
  }

  const controller = new AbortController()
  session.runningController = controller

  try {
    const permissionProfile = resolvePermissionProfile(session.permissionPreset)
    const effectiveCwd = resolveCwd(session, projectPath, request.cwd)

    const streamed = await withSessionConnection(session, auth, controller.signal, async (connection) => {
      const resolvedThreadId = await resolveThread(connection, session, projectPath, effectiveCwd, permissionProfile)

      await connection.request('thread/compact/start', { threadId: resolvedThreadId })

      return streamTurnEvents(connection, session, null, controller, callbacks)
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
    rejectPendingApprovals(session, 'Codex run interrupted')
    if (session.runningController === controller) {
      session.runningController = null
    }
  }
}

export function interruptCodex(session: CodexSession): boolean {
  if (!session.runningController) return false
  session.runningController.abort()
  return true
}

export function respondToCodexPermission(
  session: CodexSession,
  requestId: string,
  allow: boolean,
  alwaysAllow?: boolean,
  _reason?: string,
  decision?: 'cancel',
  formAnswers?: Record<string, unknown>,
): boolean {
  const pending = session.pendingApprovals.get(requestId)
  if (!pending) return false

  if (pending.responseKind === 'user_input') return false

  if (pending.responseKind === 'elicitation') {
    return respondToCodexElicitation(session, requestId, allow, alwaysAllow, decision, formAnswers)
  }

  session.pendingApprovals.delete(requestId)
  const resolvedDecision: CodexApprovalDecision = decision === 'cancel'
    ? 'cancel'
    : allow
      ? (alwaysAllow ? 'acceptForSession' : 'accept')
      : 'decline'
  pending.resolve({ decision: resolvedDecision })
  return true
}

export function respondToCodexElicitation(
  session: CodexSession,
  requestId: string,
  allow: boolean,
  alwaysAllow?: boolean,
  decision?: 'cancel',
  formAnswers?: Record<string, unknown>,
): boolean {
  const pending = session.pendingApprovals.get(requestId)
  if (!pending || pending.responseKind !== 'elicitation') return false

  session.pendingApprovals.delete(requestId)
  if (decision === 'cancel') {
    pending.resolve({ action: 'cancel', content: null, _meta: null })
    return true
  }
  if (allow) {
    const content = formAnswers && Object.keys(formAnswers).length > 0 ? formAnswers : null
    pending.resolve({
      action: 'accept',
      content,
      _meta: alwaysAllow ? { persist: 'always' } : null,
    })
    return true
  }
  pending.resolve({ action: 'decline', content: null, _meta: null })
  return true
}

export function respondToCodexQuestion(
  session: CodexSession,
  requestId: string,
  answers: Record<string, string>,
): boolean {
  const pending = session.pendingApprovals.get(requestId)
  if (!pending || pending.responseKind !== 'user_input') return false

  session.pendingApprovals.delete(requestId)
  pending.resolve(buildUserInputAnswersResponse(pending.questions ?? [], answers))
  return true
}

export function dismissCodexQuestion(session: CodexSession, requestId: string): boolean {
  const pending = session.pendingApprovals.get(requestId)
  if (!pending || pending.responseKind !== 'user_input') return false

  session.pendingApprovals.delete(requestId)
  pending.resolve(buildUserInputApprovalResponse(pending.questions ?? [], false))
  return true
}

export function resetCodexSession(session: CodexSession): void {
  rejectPendingApprovals(session, 'Codex run interrupted')
  if (session.runningController) session.runningController.abort()
  session.threadId = null
  session.threadReady = false
  session.effectiveCwd = null
  session.runningController = null
  void closeSessionConnection(session)
}
