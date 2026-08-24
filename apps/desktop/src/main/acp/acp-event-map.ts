import type { AgentEvent, ContentBlock, SlashCommandInfo } from '@superone/shared/agent-types'
import type { SessionConfigOption, SessionUpdate, ToolCall, ToolCallUpdate } from '@agentclientprotocol/sdk'
import { readArgumentHintFromMarkdownFile } from '@superone/runtime/fs'
import { getBuiltinCapability } from '@superone/shared/capability-prompt-tags'
import {
  isSessionArchiveToolName,
  looksLikeSessionArchiveJson,
  looksLikeSessionArchiveToon,
} from '@superone/shared/session-archive-result-shape'
import {
  isComputerUseToolName,
  looksLikeComputerUseOutline,
  looksLikeComputerUseResult,
} from '@superone/shared/computer-use-result-shape'
import {
  applyDescriptionPersonaLabel,
  formatAgentToolOutput,
  normalizeToolIdKey,
  uiToolNameFromId,
} from '@superone/shared/tool-ui'
import { extractModeConfig, extractModelConfig } from './acp-config'
import { isHiddenAcpPermissionSlashCommand } from './acp-slash-filter'

export interface AcpMapContext {
  messageId: string
}

type AcpToolLike = ToolCall | ToolCallUpdate

interface AcpDiff {
  path?: string
  oldText?: string | null
  newText?: string
}

export interface NormalizedAcpTool {
  toolName: string
  input: Record<string, unknown>
  toolFilePath?: string
  toolSummary?: string
  terminalId?: string
}

function textFromContent(content: { type?: string; text?: string } | undefined): string {
  if (!content) return ''
  if (content.type === 'text' && typeof content.text === 'string') return content.text
  return ''
}

function toolInputJson(raw: unknown): string {
  if (raw == null) return '{}'
  if (typeof raw === 'string') return raw
  try {
    return JSON.stringify(raw)
  } catch {
    return '{}'
  }
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  return {}
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function pickUnknown(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key]
  }
  return undefined
}

function extractDiffs(content: AcpToolLike['content']): AcpDiff[] {
  if (!Array.isArray(content)) return []
  const diffs: AcpDiff[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    if (item.type !== 'diff') continue
    diffs.push({
      path: typeof item.path === 'string' ? item.path : undefined,
      oldText: item.oldText,
      newText: typeof item.newText === 'string' ? item.newText : undefined,
    })
  }
  return diffs
}

export function extractEmbeddedTerminalId(content: AcpToolLike['content']): string | undefined {
  if (!Array.isArray(content)) return undefined
  for (const item of content) {
    if (item && typeof item === 'object' && item.type === 'terminal' && typeof item.terminalId === 'string') {
      return item.terminalId
    }
  }
  return undefined
}

function extractFilePath(
  tool: AcpToolLike,
  raw: Record<string, unknown>,
  diffs: AcpDiff[],
): string | undefined {
  return (
    tool.locations?.[0]?.path
    || diffs[0]?.path
    || pickString(raw, [
      'file_path', 'path', 'filePath', 'file', 'target_file', 'targetFile',
      'target', 'destination', 'to',
    ])
  )
}

function normalizeToolId(id: string): string {
  return normalizeToolIdKey(id)
}

function nameFromToolId(id: string | undefined | null): string | null {
  return uiToolNameFromId(id)
}

function nameFromVariant(raw: Record<string, unknown>): string | null {
  const variant = pickString(raw, ['variant', 'tool', 'name', 'toolName', 'tool_name'])
  if (variant) {
    const mapped = nameFromToolId(variant)
    if (mapped) return mapped
    // PascalCase variants: ListDir, WebSearch, Todo, TaskOutput, AskUserQuestion, …
    if (variant === 'ListDir') return 'LS'
    if (variant === 'WebSearch') return 'WebSearch'
    if (variant === 'SearchTool') return 'SearchTools'
    if (variant === 'ToolSearch') return 'ToolSearch'
    if (variant === 'UseTool') return 'UseTool'
    if (variant === 'Todo' || variant === 'TodoWrite') return 'TodoWrite'
    if (variant === 'Grep' || variant === 'GrepSearch') return 'Grep'
    if (variant === 'MemorySearch') return 'MemorySearch'
    if (variant === 'AskUserQuestion') return 'AskUserQuestion'
    if (variant === 'TaskOutput') return 'TaskOutput'
    if (variant === 'EnterPlanMode') return 'EnterPlanMode'
    if (variant === 'ExitPlanMode') return 'ExitPlanMode'
    if (variant === 'KillTask') return 'KillTask'
    if (variant === 'Skill') return 'Skill'
    if (variant === 'HashlineEdit') return 'Edit'
    if (variant === 'MemoryGet') return 'MemoryGet'
    if (variant === 'DeployApp') return 'DeployApp'
    if (variant === 'Lsp') return 'Lsp'
    if (variant === 'XSearch') return 'XSearch'
  }
  if (Array.isArray(raw.questions) && raw.questions.length > 0) return 'AskUserQuestion'
  if (Array.isArray(raw.task_ids) || raw.task_id != null || raw.taskId != null) {
    if (pickString(raw, ['command', 'cmd']) == null) return 'TaskOutput'
  }
  const action = raw.action
  if (action && typeof action === 'object' && !Array.isArray(action)) {
    const t = (action as { type?: string }).type
    if (t === 'search') return 'WebSearch'
  }
  if (raw.TodosUpdated != null || raw.todos != null) return 'TodoWrite'
  return null
}

function resolveMappedToolName(
  kind: string | null | undefined,
  raw: Record<string, unknown>,
  diffs: AcpDiff[],
  hasTerminal: boolean,
): string | null {
  if (hasTerminal) return 'Bash'
  const fromVariant = nameFromVariant(raw)
  if (fromVariant) return fromVariant

  switch (kind) {
    case 'read':
      return 'Read'
    case 'edit': {
      const first = diffs[0]
      const hasOld =
        (first?.oldText != null && first.oldText !== '')
        || pickString(raw, ['old_string', 'oldText', 'old']) != null
      const hasNew =
        first?.newText != null
        || pickString(raw, ['new_string', 'newText', 'new', 'content', 'contents', 'text']) != null
      if (!hasOld && hasNew) return 'Write'
      return 'Edit'
    }
    case 'delete':
      return 'Edit'
    case 'search': {
      const pattern = pickString(raw, ['pattern', 'regex', 'query'])
      // Grep often includes a `glob` *filter* alongside pattern — stay Grep.
      if (pattern && (raw.glob != null || raw.path != null || raw.head_limit != null || raw.regex != null)) {
        return 'Grep'
      }
      // Pure file-pattern search → Glob
      if (
        raw.glob != null
        || raw.glob_pattern != null
        || raw.globPattern != null
        || (typeof raw.pattern === 'string' && /[*?\[\]{}]/.test(raw.pattern) && raw.path == null && raw.query == null)
      ) {
        return 'Glob'
      }
      if (pattern) return 'Grep'
      return 'Grep'
    }
    case 'execute':
      return 'Bash'
    case 'fetch':
      return pickString(raw, ['query', 'q', 'search']) && !pickString(raw, ['url', 'uri', 'href'])
        ? 'WebSearch'
        : 'WebFetch'
    case 'ask_user':
      return 'AskUserQuestion'
    default:
      return null
  }
}

/**
 * Resolve UI tool name.
 * Prefer stable machine ids (title when it is a tool id, rawInput.variant) over human titles.
 * Returns null when the update is too sparse to name the tool — caller should skip tool_use overwrite.
 */
function nameFromGrokMeta(tool: AcpToolLike): string | null {
  const meta = (tool as { _meta?: Record<string, unknown> | null })._meta
  if (!meta || typeof meta !== 'object') return null
  const xai = meta['x.ai/tool']
  if (!xai || typeof xai !== 'object') return null
  const name = (xai as { name?: string }).name
  return nameFromToolId(name)
}

/** Canonical projection under `_meta["x.ai/tool"].input` (Grep has pattern; WebSearch omits). */
function grokMetaInput(tool: AcpToolLike): Record<string, unknown> {
  const meta = (tool as { _meta?: Record<string, unknown> | null })._meta
  if (!meta || typeof meta !== 'object') return {}
  const xai = meta['x.ai/tool']
  if (!xai || typeof xai !== 'object') return {}
  const input = (xai as { input?: unknown }).input
  return asRecord(input)
}

/** Grok refine title: `Web search: "query"` or `Web search: query`. Bare `Web search:` → undefined. */
function queryFromWebSearchTitle(title: string | undefined): string | undefined {
  if (!title) return undefined
  const m = title.match(/^Web\s+search:\s*(?:"([^"]*)"|(.*))$/i)
  if (!m) return undefined
  const q = (m[1] ?? m[2] ?? '').trim()
  return q || undefined
}

/** Wire/function names that must not be treated as a Grep pattern when used as title. */
const GREP_NON_PATTERN_TITLES = new Set([
  'grep', 'Grep', 'search', 'Search', 'ripgrep', 'GrepSearch', 'code_search',
])

/** After refine, Grok sets Grep title to the pattern itself. Skip tool ids / empty. */
function patternFromGrepTitle(title: string | undefined): string | undefined {
  if (!title) return undefined
  const t = title.trim()
  if (!t || GREP_NON_PATTERN_TITLES.has(t)) return undefined
  if (nameFromToolId(t)) return undefined
  return t
}

/**
 * Backend web_search completion puts query on raw_output
 * (`{ query, sources }` or `{ action: { type: "search", query } }`), never on raw_input.
 */
function queryFromWebSearchRawOutput(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  const action = obj.action
  if (action && typeof action === 'object' && !Array.isArray(action)) {
    const a = action as Record<string, unknown>
    if (a.type === 'search' && typeof a.query === 'string' && a.query.trim()) {
      return a.query.trim()
    }
  }
  if (typeof obj.query === 'string' && obj.query.trim()) {
    // Prefer shapes that look like search results, not arbitrary JSON with a query field.
    if (
      Array.isArray(obj.sources)
      || obj.type === 'web_search_call'
      || obj.type === 'WebSearch'
      || typeof obj.status === 'string'
    ) {
      return obj.query.trim()
    }
  }
  return undefined
}

function enrichSearchInput(
  toolName: string,
  input: Record<string, unknown>,
  title: string | undefined,
): Record<string, unknown> {
  if (toolName === 'WebSearch') {
    if (typeof input.query === 'string' && input.query.trim()) return input
    const fromTitle = queryFromWebSearchTitle(title)
    return fromTitle ? { ...input, query: fromTitle } : input
  }
  if (toolName === 'Grep') {
    if (typeof input.pattern === 'string' && input.pattern.trim()) return input
    const fromTitle = patternFromGrepTitle(title)
    return fromTitle ? { ...input, pattern: fromTitle } : input
  }
  return input
}

/** Prefer query/pattern for UI chip over human titles like "Web search:". */
function displayToolSummary(
  toolName: string,
  input: Record<string, unknown>,
  title: string | undefined,
): string | undefined {
  if (toolName === 'WebSearch') {
    const q = typeof input.query === 'string' ? input.query.trim() : ''
    if (q) return q
    return queryFromWebSearchTitle(title) ?? (title && title !== 'Web search:' ? title : undefined)
  }
  if (toolName === 'Grep') {
    const p = typeof input.pattern === 'string' ? input.pattern.trim() : ''
    if (p) {
      const path = typeof input.path === 'string' ? input.path.trim() : ''
      if (path) {
        const base = path.split(/[/\\]/).filter(Boolean).pop() || path
        return `${p} in ${base}`
      }
      return p
    }
    return patternFromGrepTitle(title)
  }
  if (title?.trim()) return title.trim()
  return undefined
}

function resolveToolName(
  tool: AcpToolLike,
  raw: Record<string, unknown>,
  diffs: AcpDiff[],
  hasTerminal: boolean,
): string | null {
  // Grok Build stamps stable tool ids in _meta — highest priority.
  const fromMeta = nameFromGrokMeta(tool)
  if (fromMeta) return fromMeta

  const fromTitleId = typeof tool.title === 'string' ? nameFromToolId(tool.title) : null
  if (fromTitleId) return fromTitleId

  const mapped = resolveMappedToolName(tool.kind, raw, diffs, hasTerminal)
  if (mapped) return mapped

  // Human-readable title only as last resort for initial display (never "tool")
  if (typeof tool.title === 'string' && tool.title.trim() && Object.keys(raw).length > 0) {
    return tool.title.trim()
  }
  if (typeof tool.kind === 'string' && tool.kind.trim() && tool.kind !== 'other') {
    return tool.kind.trim()
  }
  return null
}

function normalizeInput(
  toolName: string,
  kind: string | null | undefined,
  raw: Record<string, unknown>,
  filePath: string | undefined,
  diffs: AcpDiff[],
  terminalCommand?: string,
): Record<string, unknown> {
  switch (toolName) {
    case 'Read': {
      const out: Record<string, unknown> = {}
      if (filePath) out.file_path = filePath
      const offset = pickUnknown(raw, ['offset', 'start_line', 'startLine', 'line'])
      if (offset != null) out.offset = offset
      const limit = pickUnknown(raw, ['limit', 'num_lines', 'numLines', 'lines'])
      if (limit != null) out.limit = limit
      return out
    }
    case 'Edit': {
      const out: Record<string, unknown> = {}
      if (filePath) out.file_path = filePath
      const diff = diffs[0]
      const oldString =
        (diff?.oldText != null ? diff.oldText : undefined)
        ?? pickString(raw, ['old_string', 'oldText', 'old'])
      const newString =
        (diff?.newText != null ? diff.newText : undefined)
        ?? pickString(raw, ['new_string', 'newText', 'new'])
      if (oldString != null) out.old_string = oldString
      if (kind === 'delete') {
        out.new_string = newString ?? ''
      } else if (newString != null) {
        out.new_string = newString
      }
      return out
    }
    case 'Write': {
      const out: Record<string, unknown> = {}
      if (filePath) out.file_path = filePath
      const content =
        (diffs[0]?.newText != null ? diffs[0].newText : undefined)
        ?? pickString(raw, ['content', 'newText', 'new_string', 'contents', 'text'])
      if (content != null) out.content = content
      return out
    }
    case 'Bash': {
      const out: Record<string, unknown> = {}
      const command = pickString(raw, ['command', 'cmd', 'script', 'code']) ?? terminalCommand
      if (command) out.command = command
      const description = pickString(raw, ['description', 'desc'])
      if (description) out.description = description
      if (raw.run_in_background === true || raw.background === true) out.run_in_background = true
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'LS': {
      const out: Record<string, unknown> = {}
      const path = filePath
        ?? pickString(raw, ['target_directory', 'targetDirectory', 'directory', 'dir', 'path'])
      if (path) out.path = path
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'Grep': {
      const out: Record<string, unknown> = {}
      const pattern = pickString(raw, ['pattern', 'query', 'regex', 'search'])
      if (pattern) out.pattern = pattern
      const path = filePath ?? pickString(raw, ['path', 'directory', 'dir', 'cwd'])
      if (path) out.path = path
      const glob = pickString(raw, ['glob', 'glob_pattern', 'globPattern'])
      if (glob) out.glob = glob
      if (raw.case_insensitive != null) out.case_insensitive = raw.case_insensitive
      if (raw.output_mode != null) out.output_mode = raw.output_mode
      if (raw.head_limit != null) out.head_limit = raw.head_limit
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'Glob': {
      const out: Record<string, unknown> = {}
      const pattern = pickString(raw, ['pattern', 'glob', 'glob_pattern', 'globPattern'])
      if (pattern) out.pattern = pattern
      const path = filePath ?? pickString(raw, ['path', 'directory', 'dir'])
      if (path) out.path = path
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'WebFetch': {
      // Also covers Grok open_page / open_page_with_find
      const out: Record<string, unknown> = {}
      const url = pickString(raw, ['url', 'uri', 'href'])
      if (url) out.url = url
      const prompt = pickString(raw, ['prompt', 'question', 'pattern'])
      if (prompt) out.prompt = prompt
      const startLine = pickUnknown(raw, ['start_line', 'startLine', 'offset'])
      if (startLine != null) out.offset = startLine
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'WebSearch': {
      const out: Record<string, unknown> = {}
      const query = pickString(raw, ['query', 'q', 'search'])
      if (query) out.query = query
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'ToolSearch':
    case 'SearchTools': {
      const out: Record<string, unknown> = {}
      const query = pickString(raw, ['query', 'q', 'search', 'pattern'])
      if (query) out.query = query
      if (raw.limit != null) out.limit = raw.limit
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'UseTool': {
      const out: Record<string, unknown> = {}
      const toolName = pickString(raw, ['tool_name', 'toolName', 'name', 'tool', 'qualified_name'])
      if (toolName) out.tool_name = toolName
      const args = raw.arguments ?? raw.args ?? raw.input ?? raw.params
      if (args != null) out.arguments = args
      const server = pickString(raw, ['server', 'server_name', 'serverName'])
      if (server) out.server = server
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'MemorySearch': {
      const out: Record<string, unknown> = {}
      const query = pickString(raw, ['query', 'q', 'search', 'text'])
      if (query) out.query = query
      if (raw.limit != null) out.limit = raw.limit
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'Agent':
    case 'Task': {
      const out: Record<string, unknown> = {}
      const desc = pickString(raw, ['description', 'prompt', 'name', 'task', 'objective'])
      const sub = pickString(raw, ['subagent_type', 'agent_type', 'agent', 'type'])
      if (desc || sub) {
        const labeled = applyDescriptionPersonaLabel(desc ?? '', sub ?? '')
        if (labeled.description) out.description = labeled.description
        if (labeled.subagentType) out.subagent_type = labeled.subagentType
      }
      const prompt = pickString(raw, ['prompt'])
      if (prompt) out.prompt = prompt
      const model = pickString(raw, ['model'])
      if (model) out.model = model
      // Grok spawn_subagent uses `background`; Claude uses run_in_background.
      // Do not default true on subagent_type alone — Claude foreground Agents also set type.
      if (raw.run_in_background === true || raw.background === true) out.run_in_background = true
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'AskUserQuestion': {
      const out: Record<string, unknown> = {}
      if (Array.isArray(raw.questions)) out.questions = raw.questions
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'TaskOutput': {
      const out: Record<string, unknown> = {}
      const taskIds = Array.isArray(raw.task_ids)
        ? raw.task_ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
      const single =
        pickString(raw, ['task_id', 'taskId', 'id'])
        ?? (taskIds.length > 0 ? taskIds[0] : undefined)
      if (single) out.task_id = single
      if (taskIds.length > 0) out.task_ids = taskIds
      if (raw.timeout_ms != null) out.timeout_ms = raw.timeout_ms
      if (raw.timeout != null && out.timeout_ms == null) out.timeout_ms = raw.timeout
      if (raw.block === true || raw.block === false) out.block = raw.block
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'KillTask': {
      const out: Record<string, unknown> = {}
      const id = pickString(raw, ['task_id', 'taskId', 'id'])
      if (id) out.task_id = id
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'EnterPlanMode':
    case 'ExitPlanMode':
      return { ...raw }
    case 'Skill': {
      const out: Record<string, unknown> = {}
      const skill = pickString(raw, ['skill', 'name', 'skill_name', 'skillName'])
      if (skill) out.skill = skill
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'ImageGen':
    case 'ImageEdit': {
      const out: Record<string, unknown> = {}
      const prompt = pickString(raw, ['prompt', 'description', 'text'])
      if (prompt) out.prompt = prompt
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'Monitor':
    case 'UpdateGoal':
    case 'SchedulerCreate':
    case 'SchedulerDelete':
    case 'SchedulerList':
      return { ...raw }
    default:
      return { ...raw }
  }
}

/**
 * Grok routes every MCP call through a generic `use_tool` envelope: title and _meta
 * both read "use_tool", while the real id and arguments sit in rawInput.tool_name /
 * rawInput.tool_input. Rebuild the canonical `mcp__<server>__<tool>` the renderer's
 * parseMcpToolName expects — grok's tool_name is already `<server>__<tool>`.
 */
function isUseToolEnvelope(tool: AcpToolLike, raw: Record<string, unknown>): boolean {
  return nameFromGrokMeta(tool) === 'UseTool'
    || raw.variant === 'UseTool'
    || uiToolNameFromId(typeof tool.title === 'string' ? tool.title : null) === 'UseTool'
}

function unwrapMcpEnvelope(tool: AcpToolLike, raw: Record<string, unknown>): NormalizedAcpTool | null {
  if (!isUseToolEnvelope(tool, raw)) return null
  const id = raw.tool_name
  if (typeof id !== 'string' || !id.includes('__')) return null
  return { toolName: `mcp__${id}`, input: asRecord(raw.tool_input) }
}

export function normalizeAcpTool(
  tool: AcpToolLike,
  opts?: { terminalCommand?: string },
): NormalizedAcpTool | null {
  // Meta projection first; rawInput wins on key conflict (full args, not sparse projection).
  const raw = { ...grokMetaInput(tool), ...asRecord(tool.rawInput) }
  const rawInput = asRecord(tool.rawInput)
  const mcp = unwrapMcpEnvelope(tool, rawInput)
  if (mcp) return mcp
  // Sparse use_tool (no tool_name yet) must not paint a fallback chip or
  // overwrite a delta-chunk that already unwrapped the inner MCP name.
  if (isUseToolEnvelope(tool, rawInput) && typeof rawInput.tool_name !== 'string') return null
  const diffs = extractDiffs(tool.content)
  const terminalId = extractEmbeddedTerminalId(tool.content)
  const toolName = resolveToolName(tool, raw, diffs, !!terminalId)
  if (!toolName) return null
  const filePath = extractFilePath(tool, raw, diffs)
  const title = typeof tool.title === 'string' && tool.title.trim() ? tool.title.trim() : undefined
  const input = enrichSearchInput(
    toolName,
    normalizeInput(toolName, tool.kind, raw, filePath, diffs, opts?.terminalCommand),
    title,
  )
  return {
    toolName,
    input,
    toolFilePath: filePath,
    toolSummary: displayToolSummary(toolName, input, title),
    terminalId,
  }
}

function toolUseBlock(tool: AcpToolLike, opts?: { terminalCommand?: string }): ContentBlock | null {
  const normalized = normalizeAcpTool(tool, opts)
  if (!normalized) return null
  const status =
    tool.status === 'completed' || tool.status === 'failed'
      ? 'complete'
      : 'streaming'
  return {
    type: 'tool_use',
    toolName: normalized.toolName,
    toolUseId: tool.toolCallId,
    input: toolInputJson(normalized.input),
    status,
    toolSummary: normalized.toolSummary,
    toolFilePath: normalized.toolFilePath,
  }
}


/**
 * Unwrap agent-native rawOutput envelopes into UI text.
 * Shared with transcript replay via @superone/shared/tool-ui.
 */
export function formatAcpRawOutput(raw: unknown): string {
  return formatAgentToolOutput(raw)
}

/**
 * Grok Imagine / video tools return a typed MediaGenOutput as raw_output:
 * `{ type: "ImageGen"|"ImageEdit"|…, path, filename, session_folder }`.
 * SuperOne's chat gallery expects the same shape as media_generate_image
 * (`status` + `savedPaths`). Normalize here so the renderer can show the file
 * without special-casing every agent.
 */
function mediaGenGallerySummary(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const type = typeof obj.type === 'string' ? obj.type : ''
  const isImage = type === 'ImageGen' || type === 'ImageEdit'
  const isVideo = type === 'ImageToVideo' || type === 'ReferenceToVideo'
  if (!isImage && !isVideo) {
    // prompt_text JSON (no type tag): { path, filename, session_folder, message }
    const path = typeof obj.path === 'string' ? obj.path.trim() : ''
    const hasMediaKeys = typeof obj.filename === 'string' || typeof obj.session_folder === 'string'
    if (!path || !hasMediaKeys) return null
    return JSON.stringify({
      status: 'generated',
      savedPaths: [path],
      provider: 'grok',
    })
  }
  const path = typeof obj.path === 'string' ? obj.path.trim() : ''
  if (!path) {
    // ZDR upload-only or empty path — keep default text formatting.
    return null
  }
  return JSON.stringify({
    status: 'generated',
    savedPaths: [path],
    provider: 'grok',
  })
}

function toolResultFromUpdate(update: ToolCallUpdate, terminalOutput?: string): ContentBlock | null {
  if (update.status !== 'completed' && update.status !== 'failed') return null

  // Prefer structured gallery summary for Grok media tools before text unwrapping.
  if (update.status === 'completed' && update.rawOutput != null) {
    const gallery = mediaGenGallerySummary(update.rawOutput)
    if (gallery) {
      return {
        type: 'tool_result',
        toolUseId: update.toolCallId,
        summary: gallery,
        isError: false,
      }
    }
  }

  const parts: string[] = []
  for (const item of update.content ?? []) {
    if (item.type === 'content' && item.content?.type === 'text') {
      // Agent may put ListDir JSON envelope in text content — unwrap it.
      // Also upgrade Grok prompt_text media JSON into gallery shape when present.
      const text = item.content.text
      const gallery = mediaGenGallerySummary(
        (() => {
          try { return JSON.parse(typeof text === 'string' ? text : '') } catch { return null }
        })(),
      )
      parts.push(gallery ?? formatAcpRawOutput(text))
    } else if (item.type === 'diff') {
      const path = typeof item.path === 'string' ? item.path : ''
      const oldLen = typeof item.oldText === 'string' ? item.oldText.split('\n').length : 0
      const newLen = typeof item.newText === 'string' ? item.newText.split('\n').length : 0
      parts.push(path ? `Updated ${path} (−${oldLen}/+${newLen})` : 'Updated file')
    } else if (item.type === 'terminal') {
      if (terminalOutput) parts.push(terminalOutput)
      else {
        const id = typeof item.terminalId === 'string' ? item.terminalId : ''
        if (id) parts.push(`terminal ${id}`)
      }
    }
  }
  if (terminalOutput && parts.length === 0) parts.push(terminalOutput)
  if (update.rawOutput != null) {
    const formatted = formatAcpRawOutput(update.rawOutput)
    // Prefer unwrapped rawOutput when content parts are empty OR still look like JSON envelopes
    if (parts.length === 0) {
      parts.push(formatted)
    } else if (parts.every((p) => p.trimStart().startsWith('{') || p.trimStart().startsWith('['))) {
      parts.length = 0
      parts.push(formatted)
    }
  }
  const summary = parts
    .map((p) => formatAcpRawOutput(p))
    .join('\n')
  const toolName = normalizeAcpTool(update)?.toolName
  const capped = shouldKeepFullToolResult(summary, toolName) ? summary : summary.slice(0, 4000)
  return {
    type: 'tool_result',
    toolUseId: update.toolCallId,
    summary: capped || (update.status === 'failed' ? 'failed' : 'done'),
    isError: update.status === 'failed',
  }
}

/**
 * session_collab_* results are structured JSON the renderer JSON.parse()s
 * (status/messages/peers); slicing at 4000 chars truncates mid-object and
 * makes it unparsable, so a real reply silently renders as "no messages".
 */
function isCollabToolName(toolName: string | undefined): boolean {
  if (!toolName) return false
  const prefix = getBuiltinCapability('collab')?.toolPrefix
  return !!prefix && toolName.includes(prefix)
}

/**
 * Completion-only ACP updates can be sparse (no title/rawInput to re-derive
 * toolName from), so also recognize the collab envelope by shape — mirrors
 * the same fallback already used below for widget_code.
 */
function looksLikeCollabResult(obj: Record<string, unknown>): boolean {
  return typeof obj.status === 'string'
    && (Array.isArray(obj.messages) || Array.isArray(obj.peers) || Array.isArray(obj.launches) || typeof obj.sessionId === 'string')
}

function shouldKeepFullToolResult(summary: string, toolName?: string): boolean {
  if (summary.length <= 4000) return true
  if (isCollabToolName(toolName)) return true
  if (isSessionArchiveToolName(toolName)) return true
  if (looksLikeSessionArchiveToon(summary)) return true
  if (isComputerUseToolName(toolName)) return true
  if (looksLikeComputerUseOutline(summary)) return true
  const trimmed = summary.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>
    return (typeof obj.widget_code === 'string' && obj.widget_code.length > 0)
      || looksLikeCollabResult(obj)
      || looksLikeSessionArchiveJson(obj)
      || looksLikeComputerUseResult(obj)
  } catch {
    return false
  }
}

/**
 * Whether this update carries enough tool_use payload to re-emit.
 * Status-only completed/failed updates must NOT re-emit tool_use — that overwrites
 * a good name/input with toolName "tool" / {} (see event-trace acp tool sequences).
 */
function shouldEmitToolUseUpdate(update: ToolCallUpdate): boolean {
  return !!(
    update.title
    || update.kind
    || update.rawInput !== undefined
    || (update.content && update.content.length > 0)
    || (update.locations && update.locations.length > 0)
    || update.status === 'in_progress'
    || update.status === 'pending'
  )
}

function mapPlanToTodoEvents(messageId: string, entries: Array<{ content?: string; status?: string; priority?: string }>): AgentEvent[] {
  const todos = entries
    .filter((e) => typeof e.content === 'string' && e.content.trim())
    .map((e) => {
      const status =
        e.status === 'completed' || e.status === 'in_progress' || e.status === 'pending'
          ? e.status
          : 'pending'
      const item: { content: string; status: string; activeForm?: string } = {
        content: e.content!.trim(),
        status,
      }
      if (status === 'in_progress') item.activeForm = e.content!.trim()
      return item
    })
  const toolUseId = `acp-plan:${messageId}`
  const input = JSON.stringify({ todos })
  return [
    {
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_use',
        toolName: 'TodoWrite',
        toolUseId,
        input,
        status: 'complete',
      },
    },
    {
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_result',
        toolUseId,
        summary: `Plan: ${todos.filter((t) => t.status === 'completed').length}/${todos.length}`,
        isError: false,
      },
    },
  ]
}

export interface MapSessionUpdateOptions {
  /** Resolve command line for an embedded terminal id (for Bash UI). */
  resolveTerminalCommand?: (terminalId: string) => string | undefined
  /** Resolve live/final terminal output for tool_result summary. */
  resolveTerminalOutput?: (terminalId: string) => string | undefined
  /** Called when a tool_use embeds a terminal, so runtime can bind streaming. */
  onTerminalEmbedded?: (terminalId: string, toolUseId: string) => void
}

/** Map one ACP session update into zero or more SuperOne AgentEvents. */
export function mapSessionUpdate(
  update: SessionUpdate,
  ctx: AcpMapContext,
  opts?: MapSessionUpdateOptions,
): AgentEvent[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content = update.content
      if (content?.type === 'text') {
        const text = textFromContent(content)
        if (!text) return []
        return [{
          type: 'content_delta',
          messageId: ctx.messageId,
          delta: { type: 'text', text },
        }]
      }
      if (content?.type === 'image' && typeof content.data === 'string') {
        // Surface as markdown data-uri text so chat still shows something without a dedicated image block path.
        const mime = typeof content.mimeType === 'string' ? content.mimeType : 'image/png'
        return [{
          type: 'content_delta',
          messageId: ctx.messageId,
          delta: { type: 'text', text: `\n![image](data:${mime};base64,${content.data})\n` },
        }]
      }
      return []
    }
    case 'agent_thought_chunk': {
      const text = textFromContent(update.content)
      if (!text) return []
      return [{
        type: 'content_delta',
        messageId: ctx.messageId,
        delta: { type: 'thinking', thinking: text },
      }]
    }
    case 'tool_call':
    case 'tool_call_update': {
      const terminalId = extractEmbeddedTerminalId(update.content)
      const terminalCommand = terminalId ? opts?.resolveTerminalCommand?.(terminalId) : undefined
      const terminalOutput = terminalId ? opts?.resolveTerminalOutput?.(terminalId) : undefined
      if (terminalId) {
        opts?.onTerminalEmbedded?.(terminalId, update.toolCallId)
      }

      const events: AgentEvent[] = []
      const wantUse =
        update.sessionUpdate === 'tool_call'
        || shouldEmitToolUseUpdate(update)
      if (wantUse) {
        const block = toolUseBlock(update, { terminalCommand })
        if (block) {
          events.push({
            type: 'content_delta',
            messageId: ctx.messageId,
            delta: block,
          })
        }
      }
      if (update.sessionUpdate === 'tool_call_update') {
        // Backend web_search never puts query on raw_input; backfill from raw_output on complete.
        const webQuery = queryFromWebSearchRawOutput(update.rawOutput)
        if (webQuery) {
          events.push({
            type: 'content_delta',
            messageId: ctx.messageId,
            delta: {
              type: 'tool_use',
              toolName: 'WebSearch',
              toolUseId: update.toolCallId,
              input: JSON.stringify({ query: webQuery }),
              toolSummary: webQuery,
              status:
                update.status === 'completed' || update.status === 'failed'
                  ? 'complete'
                  : 'streaming',
            },
          })
        }
        const result = toolResultFromUpdate(update, terminalOutput)
        if (result) {
          events.push({
            type: 'content_delta',
            messageId: ctx.messageId,
            delta: result,
          })
        }
      }
      return events
    }
    case 'plan': {
      return mapPlanToTodoEvents(ctx.messageId, update.entries ?? [])
    }
    case 'usage_update': {
      // ACP usage_update is context occupancy (used/size), not turn billing in/out.
      const used = typeof (update as { used?: number }).used === 'number' ? (update as { used: number }).used : null
      const size = typeof (update as { size?: number }).size === 'number' ? (update as { size: number }).size : null
      if (used == null) return []
      const cost = (update as { cost?: { amount?: number; currency?: string } | null }).cost
      const costUsd =
        cost && typeof cost.amount === 'number' && (cost.currency === 'USD' || !cost.currency)
          ? cost.amount
          : undefined
      return [{
        type: 'message_usage',
        messageId: ctx.messageId,
        inputTokens: 0,
        outputTokens: 0,
        contextTokens: used,
        ...(size != null ? { contextWindow: size } : {}),
        ...(costUsd != null ? { costUsd } : {}),
      }]
    }
    case 'config_option_update': {
      const configOptions = (update as { configOptions?: SessionConfigOption[] }).configOptions
      if (!configOptions?.length) return []
      const events: AgentEvent[] = []
      const models = extractModelConfig(configOptions)
      if (models) {
        events.push({
          type: 'acp_models',
          models: models.models,
          selectedModelId: models.selectedModelId,
          configId: models.configId,
          status: 'ready',
        })
      }
      const modes = extractModeConfig(configOptions)
      if (modes) {
        events.push({
          type: 'acp_modes',
          modes: modes.modes,
          selectedModeId: modes.selectedModeId,
          configId: modes.configId,
          status: 'ready',
        })
      }
      return events
    }
    case 'available_commands_update': {
      const raw = (update as { availableCommands?: unknown[] }).availableCommands
      if (!Array.isArray(raw)) return []
      const commands: SlashCommandInfo[] = []
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const c = item as {
          name?: string
          description?: string
          input?: { hint?: string } | null
          _meta?: { path?: string; workflowSource?: string; workflowPath?: string } | null
        }
        if (typeof c.name !== 'string' || !c.name.trim()) continue
        const name = c.name.replace(/^\//, '').trim()
        if (!name) continue
        // Host owns permission baseline via the status-bar selector — hide Grok's
        // /always-approve so users don't have two competing controls.
        if (isHiddenAcpPermissionSlashCommand(name)) continue
        let hint =
          c.input && typeof c.input === 'object' && typeof c.input.hint === 'string'
            ? c.input.hint.trim()
            : ''
        // Grok only fills input.hint for `argument-hint:`. Skills that still use
        // Claude's `arguments:` arrive with input:null — re-read the skill path
        // so SuperOne slash menus accept both frontmatter keys.
        if (!hint && c._meta && typeof c._meta === 'object' && typeof c._meta.path === 'string') {
          hint = readArgumentHintFromMarkdownFile(c._meta.path)
        }
        const isSkill = Boolean(
          c._meta && typeof c._meta === 'object' && typeof c._meta.path === 'string' &&
          /SKILL\.md$/i.test(c._meta.path),
        )
        const workflowSource =
          c._meta && typeof c._meta === 'object' && typeof c._meta.workflowSource === 'string'
            ? c._meta.workflowSource
            : undefined
        const workflowPath =
          c._meta && typeof c._meta === 'object' && typeof c._meta.workflowPath === 'string'
            ? c._meta.workflowPath
            : undefined
        const isWorkflow = Boolean(workflowSource) || Boolean(workflowPath)
          || (typeof c.description === 'string' && /^Workflow:\s/i.test(c.description))
        commands.push({
          name,
          description: typeof c.description === 'string' ? c.description : '',
          argumentHint: hint,
          isSkill,
          ...(isWorkflow
            ? {
                isWorkflow: true,
                workflowSource: workflowSource ?? 'workflow',
                ...(workflowPath ? { workflowPath } : {}),
              }
            : {}),
        })
      }
      return [{ type: 'acp_commands', commands }]
    }
    default:
      return []
  }
}

export function mapStopReason(stopReason: string): { complete: boolean; interrupted: boolean } {
  if (stopReason === 'cancelled') return { complete: false, interrupted: true }
  return { complete: true, interrupted: false }
}

const FILE_MENTION_RE = /(?:^|\s)@([^\s]+)/g

/** Extract @path-like file mentions from user text. */
export function extractFileMentions(text: string): string[] {
  const out: string[] = []
  const re = new RegExp(FILE_MENTION_RE)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const value = m[1]
    if (!value) continue
    // skip bare words without path/extension-ish shape (agents/miniapps)
    if (!value.includes('/') && !value.includes('.')) continue
    if (value.endsWith('/')) continue
    out.push(value)
  }
  return [...new Set(out)]
}

export interface BuildAcpPromptOptions {
  images?: Array<{ mimeType: string; base64: string; name?: string }>
  /** Absolute project cwd for resolving relative @file mentions. */
  cwd?: string
  getUnsaved?: (absolutePath: string) => string | null | undefined
  /** Optional file reader (tests inject). Defaults to fs readFile. */
  readFile?: (absolutePath: string) => Promise<string | null>
  maxResourceBytes?: number
}

/** Build ACP prompt ContentBlocks from SuperOne send payload (sync images + text only). */
export function buildAcpPromptContent(
  text: string,
  images?: Array<{ mimeType: string; base64: string; name?: string }>,
): Array<{ type: string; [k: string]: unknown }> {
  return buildAcpPromptContentSync(text, { images })
}

function buildAcpPromptContentSync(
  text: string,
  opts: BuildAcpPromptOptions,
): Array<{ type: string; [k: string]: unknown }> {
  const blocks: Array<{ type: string; [k: string]: unknown }> = []
  if (text.trim()) {
    blocks.push({ type: 'text', text })
  }
  for (const img of opts.images ?? []) {
    if (!img?.base64 || !img.mimeType) continue
    blocks.push({
      type: 'image',
      mimeType: img.mimeType,
      data: img.base64,
      ...(img.name ? { uri: `attachment://${img.name}` } : {}),
    })
  }
  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: text || '' })
  }
  return blocks
}

/** Build prompt including embedded file resources for @file mentions. */
export async function buildAcpPromptContentAsync(
  text: string,
  opts: BuildAcpPromptOptions = {},
): Promise<Array<{ type: string; [k: string]: unknown }>> {
  const blocks = buildAcpPromptContentSync(text, opts)
  const mentions = extractFileMentions(text)
  if (mentions.length === 0) return blocks

  const { resolve, isAbsolute } = await import('node:path')
  const maxBytes = opts.maxResourceBytes ?? 512 * 1024
  const defaultRead = async (abs: string): Promise<string | null> => {
    try {
      const { readFile, stat } = await import('node:fs/promises')
      const info = await stat(abs)
      if (!info.isFile() || info.size > maxBytes) return null
      return await readFile(abs, 'utf8')
    } catch {
      return null
    }
  }
  const readFile = opts.readFile ?? defaultRead
  const cwd = opts.cwd

  for (const mention of mentions) {
    const abs = isAbsolute(mention)
      ? resolve(mention)
      : cwd
        ? resolve(cwd, mention)
        : resolve(mention)
    const unsaved = opts.getUnsaved?.(abs)
    const body = typeof unsaved === 'string' ? unsaved : await readFile(abs)
    if (body == null) continue
    const uri = abs.startsWith('/') ? `file://${abs}` : `file:///${abs}`
    blocks.push({
      type: 'resource',
      resource: {
        uri,
        mimeType: 'text/plain',
        text: body,
      },
    })
  }
  return blocks
}

/** Track open tool call ids from mapped tool events (for cancel). */
export function trackOpenTools(
  open: Set<string>,
  events: AgentEvent[],
): void {
  for (const event of events) {
    if (event.type !== 'content_delta') continue
    if (event.delta.type === 'tool_use' && event.delta.status !== 'complete') {
      open.add(event.delta.toolUseId)
    }
    if (event.delta.type === 'tool_use' && event.delta.status === 'complete') {
      // still open until result? mark complete tools as closed if TodoWrite etc.
      if (event.delta.toolName === 'TodoWrite') open.delete(event.delta.toolUseId)
    }
    if (event.delta.type === 'tool_result') {
      open.delete(event.delta.toolUseId)
    }
  }
}

/** Emit cancelled tool_result for remaining open tools (prompt cancel). */
export function cancelOpenToolEvents(messageId: string, open: Set<string>): AgentEvent[] {
  const events: AgentEvent[] = []
  for (const toolUseId of open) {
    events.push({
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_use',
        toolName: 'tool',
        toolUseId,
        input: '{}',
        status: 'complete',
      },
    })
    events.push({
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_result',
        toolUseId,
        summary: 'cancelled',
        isError: true,
      },
    })
  }
  open.clear()
  return events
}

export function getAgentChunkMessageId(update: SessionUpdate): string | null {
  if (update.sessionUpdate !== 'agent_message_chunk' && update.sessionUpdate !== 'agent_thought_chunk') {
    return null
  }
  const mid = (update as { messageId?: string | null }).messageId
  return typeof mid === 'string' && mid.trim() ? mid : null
}
