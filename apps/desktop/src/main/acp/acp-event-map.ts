import type { AgentEvent, ContentBlock, SlashCommandInfo } from '@superone/shared/agent-types'
import type { SessionConfigOption, SessionUpdate, ToolCall, ToolCallUpdate } from '@agentclientprotocol/sdk'
import { extractModeConfig, extractModelConfig } from './acp-config'

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

/** Map agent-native tool ids / variants → Claude-shaped UI names. */
const TOOL_ID_TO_NAME: Record<string, string> = {
  read: 'Read',
  read_file: 'Read',
  readfile: 'Read',
  edit: 'Edit',
  search_replace: 'Edit',
  str_replace: 'Edit',
  apply_patch: 'Edit',
  write: 'Write',
  write_file: 'Write',
  writefile: 'Write',
  create_file: 'Write',
  bash: 'Bash',
  shell: 'Bash',
  run_terminal_command: 'Bash',
  run_terminal_cmd: 'Bash',
  run_command: 'Bash',
  execute: 'Bash',
  command: 'Bash',
  grep: 'Grep',
  search: 'Grep',
  ripgrep: 'Grep',
  glob: 'Glob',
  find_files: 'Glob',
  list_dir: 'LS',
  listdir: 'LS',
  ls: 'LS',
  web_fetch: 'WebFetch',
  webfetch: 'WebFetch',
  fetch: 'WebFetch',
  open_page: 'WebFetch',
  open_page_with_find: 'WebFetch',
  web_search: 'WebSearch',
  websearch: 'WebSearch',
  todo_write: 'TodoWrite',
  todowrite: 'TodoWrite',
  todo: 'TodoWrite',
  search_tool: 'SearchTools',
  searchtool: 'SearchTools',
  tool_search: 'SearchTools',
  toolsearch: 'SearchTools',
  use_tool: 'UseTool',
  usetool: 'UseTool',
  call_tool: 'UseTool',
  spawn_subagent: 'Task',
  spawn_agent: 'Task',
  task: 'Task',
  agent: 'Task',
  memory_search: 'MemorySearch',
  memorysearch: 'MemorySearch',
  search_memory: 'MemorySearch',
  ask_user_question: 'AskUserQuestion',
  askuserquestion: 'AskUserQuestion',
  get_task_output: 'TaskOutput',
  get_command_or_subagent_output: 'TaskOutput',
  get_terminal_command_output: 'TaskOutput',
  wait_tasks: 'TaskOutput',
  wait_commands_or_subagents: 'TaskOutput',
  kill_task: 'KillTask',
  kill_command_or_subagent: 'KillTask',
  kill_terminal_command: 'KillTask',
  enter_plan_mode: 'EnterPlanMode',
  exit_plan_mode: 'ExitPlanMode',
  skill: 'Skill',
  image_gen: 'ImageGen',
  image_edit: 'ImageEdit',
  image_to_video: 'ImageToVideo',
  reference_to_video: 'ReferenceToVideo',
  video_gen: 'VideoGen',
  monitor: 'Monitor',
  update_goal: 'UpdateGoal',
  scheduler_create: 'SchedulerCreate',
  scheduler_delete: 'SchedulerDelete',
  scheduler_list: 'SchedulerList',
}

function normalizeToolId(id: string): string {
  return id.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function nameFromToolId(id: string | undefined | null): string | null {
  if (!id || typeof id !== 'string') return null
  // Human titles like "List `/path`" or "Web search:" are not tool ids
  if (/[\s`/:]/.test(id) && !TOOL_ID_TO_NAME[normalizeToolId(id)]) return null
  const key = normalizeToolId(id)
  return TOOL_ID_TO_NAME[key] ?? null
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
    case 'Task': {
      const out: Record<string, unknown> = {}
      const desc = pickString(raw, ['description', 'prompt', 'name', 'task', 'objective'])
      if (desc) out.description = desc
      const sub = pickString(raw, ['subagent_type', 'agent_type', 'agent', 'type'])
      if (sub) out.subagent_type = sub
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
  const raw = asRecord(tool.rawInput)
  const mcp = unwrapMcpEnvelope(tool, raw)
  if (mcp) return mcp
  const diffs = extractDiffs(tool.content)
  const terminalId = extractEmbeddedTerminalId(tool.content)
  const toolName = resolveToolName(tool, raw, diffs, !!terminalId)
  if (!toolName) return null
  const filePath = extractFilePath(tool, raw, diffs)
  const input = normalizeInput(toolName, tool.kind, raw, filePath, diffs, opts?.terminalCommand)
  const title = typeof tool.title === 'string' && tool.title.trim() ? tool.title.trim() : undefined
  return {
    toolName,
    input,
    toolFilePath: filePath,
    toolSummary: title,
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


function bytesOrStringToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((n) => typeof n === 'number')) {
    try {
      return Buffer.from(value as number[]).toString('utf8')
    } catch {
      return ''
    }
  }
  return ''
}

function formatSearchToolPayload(obj: Record<string, unknown>): string | null {
  let data: unknown = obj
  if (typeof obj.content === 'string' && obj.content.trim()) {
    try {
      data = JSON.parse(obj.content)
    } catch {
      // content may already be a display string
      if (!obj.results) return obj.content
    }
  }
  if (!data || typeof data !== 'object') return null
  const root = data as Record<string, unknown>
  const results = root.results
  if (!Array.isArray(results)) {
    if (typeof root.content === 'string') return root.content
    return null
  }
  const lines: string[] = []
  const count = typeof obj.result_count === 'number' ? obj.result_count : results.length
  lines.push(`Found ${count} tool${count === 1 ? '' : 's'}`)
  for (const entry of results) {
    if (!entry || typeof entry !== 'object') continue
    const group = entry as Record<string, unknown>
    const server = typeof group.server === 'string' ? group.server : 'MCP'
    lines.push('')
    lines.push(`[${server}]`)
    const tools = group.tools
    if (!Array.isArray(tools)) continue
    for (const tool of tools) {
      if (!tool || typeof tool !== 'object') continue
      const t = tool as Record<string, unknown>
      const name = typeof t.tool_name === 'string' ? t.tool_name : typeof t.name === 'string' ? t.name : 'tool'
      const desc = typeof t.description === 'string' ? t.description : ''
      const score = typeof t.score === 'number' ? ` · ${t.score.toFixed(1)}` : ''
      lines.push(desc ? `  ${name}${score} — ${desc}` : `  ${name}${score}`)
    }
  }
  if (typeof root.note === 'string' && root.note.trim()) {
    lines.push('')
    lines.push(root.note)
  }
  return lines.join('\n').trim() || null
}

/**
 * Unwrap agent-native rawOutput envelopes (Grok Build / OpenCode / similar) into UI text.
 * Prefer the human tree/listing string over dumping the whole JSON wrapper.
 */
function isAgentOutputEnvelope(obj: Record<string, unknown>): boolean {
  const t = obj.type
  return (
    t === 'MCP'
    || t === 'ListDir'
    || t === 'list_dir'
    || t === 'LS'
    || t === 'Todo'
    || t === 'SearchTool'
    || t === 'GrepSearch'
    || t === 'grep'
    || obj.TodosUpdated != null
    || (obj.Content != null && typeof obj.Content === 'object')
    || Array.isArray(obj.results)
    || (obj.action != null && typeof obj.action === 'object')
  )
}

export function formatAcpRawOutput(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && isAgentOutputEnvelope(parsed as Record<string, unknown>)) {
          return formatAcpRawOutput(parsed)
        }
        return raw
      } catch {
        return raw
      }
    }
    return raw
  }
  if (typeof raw !== 'object') return String(raw)

  const obj = raw as Record<string, unknown>

  // MCP: { type: "MCP", server_name, tool_name, output: { OkayOutput: "<payload>" } }.
  // The output key is grok's serde variant tag — read the payload structurally so error
  // variants unwrap the same way without hardcoding the tag set.
  if (obj.type === 'MCP' && obj.output != null) {
    if (typeof obj.output === 'string') return obj.output
    if (typeof obj.output === 'object') {
      const values = Object.values(obj.output as Record<string, unknown>)
      if (values.length === 1 && typeof values[0] === 'string') return values[0]
    }
  }

  // ListDir: { type: "ListDir", Content: { content: "- /path\n  - a", absolute_root_path?: string } }
  const listContent = obj.Content ?? obj.content
  if (
    (obj.type === 'ListDir' || obj.type === 'list_dir' || obj.type === 'LS')
    && listContent
    && typeof listContent === 'object'
  ) {
    const body = listContent as Record<string, unknown>
    if (typeof body.content === 'string' && body.content.trim()) return body.content
    if (typeof body.text === 'string' && body.text.trim()) return body.text
  }
  // Sometimes Content is the tree string directly
  if ((obj.type === 'ListDir' || obj.type === 'list_dir') && typeof obj.Content === 'string') {
    return obj.Content
  }
  if (typeof obj.content === 'string' && obj.content.includes('\n') && (obj.type === 'ListDir' || obj.absolute_root_path != null)) {
    return obj.content
  }

  // Todo: { type: "Todo", TodosUpdated: { summary_for_prompt: "..." } }
  if (obj.type === 'Todo' || obj.TodosUpdated != null) {
    const todos = obj.TodosUpdated
    if (todos && typeof todos === 'object') {
      const t = todos as Record<string, unknown>
      if (typeof t.summary_for_prompt === 'string' && t.summary_for_prompt.trim()) return t.summary_for_prompt
      if (typeof t.summary === 'string' && t.summary.trim()) return t.summary
    }
  }

  // SearchTool: MCP tool discovery results (envelope or bare { results: [...] })
  if (
    obj.type === 'SearchTool'
    || Array.isArray(obj.results)
    || (obj.result_count != null && (obj.content != null || obj.results != null))
  ) {
    const formatted = formatSearchToolPayload(obj)
    if (formatted) return formatted
  }

  // GrepSearch: stdout may be a UTF-8 byte array
  if (obj.type === 'GrepSearch' || obj.type === 'grep' || Array.isArray(obj.stdout)) {
    const text = bytesOrStringToText(obj.stdout ?? obj.content ?? obj.output)
    if (text) return text
  }

  // Web search action payload: { action: { type: "search", query, sources: [...] } }
  const action = obj.action
  if (action && typeof action === 'object') {
    const a = action as Record<string, unknown>
    if (a.type === 'search') {
      const lines: string[] = []
      if (typeof a.query === 'string') lines.push(`Query: ${a.query}`)
      const sources = a.sources
      if (Array.isArray(sources)) {
        for (const s of sources) {
          if (s && typeof s === 'object') {
            const src = s as Record<string, unknown>
            if (typeof src.url === 'string') lines.push(src.url)
            else if (typeof src.title === 'string') lines.push(src.title)
          }
        }
      }
      if (typeof a.result === 'string') lines.push(a.result)
      if (typeof a.snippet === 'string') lines.push(a.snippet)
      if (lines.length > 0) return lines.join('\n')
    }
  }

  // Nested Content envelope without type (or type casing variants)
  if (listContent && typeof listContent === 'object') {
    const body = listContent as Record<string, unknown>
    for (const key of ['content', 'text', 'output', 'result']) {
      if (typeof body[key] === 'string' && (body[key] as string).trim()) {
        // Prefer tree-looking listings from ListDir-like payloads
        if (
          obj.type === 'ListDir'
          || obj.type === 'list_dir'
          || obj.type === 'LS'
          || body.absolute_root_path != null
          || /^[\s-]*\//.test(body[key] as string)
        ) {
          return body[key] as string
        }
      }
    }
  }

  // Generic nested result / output / text / stdout
  for (const key of ['result', 'output', 'text', 'stdout', 'message', 'summary']) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  if (listContent && typeof listContent === 'object') {
    const body = listContent as Record<string, unknown>
    for (const key of ['content', 'text', 'output', 'result']) {
      if (typeof body[key] === 'string' && (body[key] as string).trim()) return body[key] as string
    }
  }

  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

function toolResultFromUpdate(update: ToolCallUpdate, terminalOutput?: string): ContentBlock | null {
  if (update.status !== 'completed' && update.status !== 'failed') return null
  const parts: string[] = []
  for (const item of update.content ?? []) {
    if (item.type === 'content' && item.content?.type === 'text') {
      // Agent may put ListDir JSON envelope in text content — unwrap it.
      parts.push(formatAcpRawOutput(item.content.text))
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
  const capped = shouldKeepFullToolResult(summary) ? summary : summary.slice(0, 4000)
  return {
    type: 'tool_result',
    toolUseId: update.toolCallId,
    summary: capped || (update.status === 'failed' ? 'failed' : 'done'),
    isError: update.status === 'failed',
  }
}

function shouldKeepFullToolResult(summary: string): boolean {
  if (summary.length <= 4000) return true
  const trimmed = summary.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>
    return typeof obj.widget_code === 'string' && obj.widget_code.length > 0
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
        inputTokens: used,
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
        }
        if (typeof c.name !== 'string' || !c.name.trim()) continue
        const name = c.name.replace(/^\//, '').trim()
        if (!name) continue
        const hint =
          c.input && typeof c.input === 'object' && typeof c.input.hint === 'string'
            ? c.input.hint
            : ''
        commands.push({
          name,
          description: typeof c.description === 'string' ? c.description : '',
          argumentHint: hint,
          isSkill: false,
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
