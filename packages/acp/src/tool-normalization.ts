import type { ContentBlock } from '@superone/shared/agent-types'
import type { ToolCall, ToolCallUpdate } from '@agentclientprotocol/sdk'
import { getBuiltinCapability } from '@superone/shared/capability-prompt-tags'
import { normalizeToolIdKey, uiToolNameFromId } from '@superone/shared/tool-ui'

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

export function textFromContent(content: { type?: string; text?: string } | undefined): string {
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
export function queryFromWebSearchRawOutput(raw: unknown): string | undefined {
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
      if (desc) out.description = desc
      const sub = pickString(raw, ['subagent_type', 'agent_type', 'agent', 'type'])
      if (sub) out.subagent_type = sub
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
function unwrapMcpEnvelope(tool: AcpToolLike, raw: Record<string, unknown>): NormalizedAcpTool | null {
  const isEnvelope = nameFromGrokMeta(tool) === 'UseTool' || raw.variant === 'UseTool'
  if (!isEnvelope) return null
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
  const mcp = unwrapMcpEnvelope(tool, asRecord(tool.rawInput))
  if (mcp) return mcp
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

export function toolUseBlock(tool: AcpToolLike, opts?: { terminalCommand?: string }): ContentBlock | null {
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
