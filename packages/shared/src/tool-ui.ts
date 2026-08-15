/**
 * Pure, browser-safe tool UI helpers shared by ACP live mapping and
 * transcript/JSONL replay (workflow full view, subagent full view).
 *
 * Keep this free of Node-only APIs (no Buffer) so the renderer can import it.
 */

/** Map agent-native / Grok tool ids → Claude-shaped UI names for ToolBlock. */
export const TOOL_ID_TO_UI_NAME: Record<string, string> = {
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
  spawn_subagent: 'Agent',
  spawn_agent: 'Agent',
  agent: 'Agent',
  task: 'Task',
  workflow: 'Workflow',
  run_workflow: 'Workflow',
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

export function normalizeToolIdKey(id: string): string {
  return id.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * Claude Agent SDK uses `Agent`; Grok spawn_subagent maps to `Agent` now but
 * older transcripts / generic task ids may still be `Task`. Both launch the
 * SubagentBlock card / status-bar agent row.
 */
export function isSubagentToolName(name: string | undefined | null): boolean {
  return name === 'Agent' || name === 'Task'
}

/**
 * Resolve a machine tool id to a Claude-shaped UI name.
 * Returns null for human titles (spaces, path punctuation) that are not ids.
 */
export function uiToolNameFromId(id: string | undefined | null): string | null {
  if (!id || typeof id !== 'string') return null
  // Human titles like "List `/path`" or "Web search:" are not tool ids
  if (/[\s`/:]/.test(id) && !TOOL_ID_TO_UI_NAME[normalizeToolIdKey(id)]) return null
  const key = normalizeToolIdKey(id)
  return TOOL_ID_TO_UI_NAME[key] ?? null
}

/**
 * Normalize a transcript / chat_history tool name + raw args into ToolBlock shape.
 * Grok uses ids like `read_file` and aliases like `target_file`; live ACP mapping
 * does the same — JSONL replay must stay aligned.
 */
export function normalizeTranscriptTool(
  rawName: string,
  rawInput: Record<string, unknown>,
): { toolName: string; input: Record<string, unknown> } {
  // Grok MCP envelope: use_tool { tool_name: "server__tool", tool_input }
  const envelopeId = typeof rawInput.tool_name === 'string' ? rawInput.tool_name : ''
  const isUseTool =
    normalizeToolIdKey(rawName) === 'use_tool'
    || rawInput.variant === 'UseTool'
  if (isUseTool && envelopeId.includes('__')) {
    const mcpInput = rawInput.tool_input && typeof rawInput.tool_input === 'object' && !Array.isArray(rawInput.tool_input)
      ? rawInput.tool_input as Record<string, unknown>
      : {}
    return { toolName: `mcp__${envelopeId}`, input: mcpInput }
  }

  const toolName = uiToolNameFromId(rawName) ?? rawName
  const input = { ...rawInput }

  if (toolName === 'Read') {
    if (input.file_path == null && input.target_file != null) input.file_path = input.target_file
    if (input.file_path == null && input.path != null) input.file_path = input.path
  } else if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Delete' || toolName === 'FileChange') {
    if (input.file_path == null && input.target_file != null) input.file_path = input.target_file
    if (input.file_path == null && input.path != null) input.file_path = input.path
    if (toolName === 'Write' && input.content == null && input.contents != null) input.content = input.contents
    if (toolName === 'Write' && input.content == null && input.fileText != null) input.content = input.fileText
    if (toolName === 'Edit' && input.diff == null && input.diffString != null) input.diff = input.diffString
  } else if (toolName === 'Bash') {
    if (input.command == null && input.cmd != null) input.command = input.cmd
  } else if (toolName === 'LS') {
    if (input.path == null && input.target_directory != null) input.path = input.target_directory
    if (input.path == null && input.directory != null) input.path = input.directory
  } else if (toolName === 'Grep') {
    if (input.pattern == null && input.query != null) input.pattern = input.query
  } else if (toolName === 'Glob') {
    if (input.pattern == null && input.globPattern != null) input.pattern = input.globPattern
    if (input.pattern == null && input.glob_pattern != null) input.pattern = input.glob_pattern
    if (input.path == null && input.targetDirectory != null) input.path = input.targetDirectory
    if (input.path == null && input.target_directory != null) input.path = input.target_directory
  } else if (toolName === 'WebFetch') {
    if (input.url == null && input.uri != null) input.url = input.uri
  } else if (toolName === 'WebSearch' || toolName === 'SearchTools' || toolName === 'ToolSearch' || toolName === 'SemanticSearch') {
    if (input.query == null && input.q != null) input.query = input.q
  }

  return { toolName, input }
}

function bytesOrStringToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === 'number')) {
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(value as number[]))
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

/** Cursor/Claude-style shell result: `{ stdout, stderr?, exitCode, signal? }`. */
function isShellCommandResult(obj: Record<string, unknown>): boolean {
  const hasStream = typeof obj.stdout === 'string' || typeof obj.stderr === 'string'
  if (!hasStream) return false
  return typeof obj.exitCode === 'number'
    || typeof obj.exit_code === 'number'
    || typeof obj.signal === 'string'
    || typeof obj.executionTime === 'number'
}

function formatShellCommandResult(obj: Record<string, unknown>): string {
  const stdout = typeof obj.stdout === 'string' ? obj.stdout : ''
  const stderr = typeof obj.stderr === 'string' ? obj.stderr : ''
  if (stdout && stderr) {
    return stdout.endsWith('\n') ? `${stdout}${stderr}` : `${stdout}\n${stderr}`
  }
  if (stdout || stderr) return stdout || stderr
  const code = typeof obj.exitCode === 'number' ? obj.exitCode : obj.exit_code
  if (typeof code === 'number' && code !== 0) return `Exit code ${code}`
  return ''
}

/** Cursor Grep success: `{ workspaceResults?: Record<root, GrepUnion>, activeEditorResult? }`. */
function isCursorGrepResult(obj: Record<string, unknown>): boolean {
  const workspaces = obj.workspaceResults
  if (workspaces && typeof workspaces === 'object' && !Array.isArray(workspaces)) return true
  return obj.activeEditorResult != null && typeof obj.activeEditorResult === 'object'
}

function formatGrepUnion(result: unknown): string {
  const rec = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown>
    : null
  if (!rec) return ''
  const output = rec.output && typeof rec.output === 'object' && !Array.isArray(rec.output)
    ? rec.output as Record<string, unknown>
    : rec
  const type = typeof rec.type === 'string' ? rec.type : ''
  if (type === 'files' || Array.isArray(output.files)) {
    const files = Array.isArray(output.files) ? output.files.filter((f) => typeof f === 'string') : []
    return files.join('\n')
  }
  if (type === 'count' || Array.isArray(output.counts)) {
    const counts = Array.isArray(output.counts) ? output.counts : []
    const lines: string[] = []
    for (const entry of counts) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      const file = typeof row.file === 'string' ? row.file : ''
      const count = typeof row.count === 'number' ? row.count : ''
      if (file) lines.push(count === '' ? file : `${file}:${count}`)
    }
    return lines.join('\n')
  }
  const matches = Array.isArray(output.matches) ? output.matches : []
  const lines: string[] = []
  for (const entry of matches) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const file = typeof row.file === 'string' ? row.file : ''
    if (!file) continue
    const lineNo = typeof row.lineNumber === 'number' ? row.lineNumber : null
    const line = typeof row.line === 'string' ? row.line : ''
    if (lineNo != null && line) lines.push(`${file}:${lineNo}:${line}`)
    else if (line) lines.push(`${file}:${line}`)
    else lines.push(file)
  }
  return lines.join('\n')
}

function formatCursorGrepResult(obj: Record<string, unknown>): string {
  const chunks: string[] = []
  const editor = formatGrepUnion(obj.activeEditorResult)
  if (editor) chunks.push(editor)
  const workspaces = asPlainRecord(obj.workspaceResults)
  if (workspaces) {
    const roots = Object.keys(workspaces)
    const multi = roots.length > 1
    for (const root of roots) {
      const body = formatGrepUnion(workspaces[root])
      if (!body) continue
      chunks.push(multi ? `${root}\n${body}` : body)
    }
  }
  return chunks.join('\n')
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Cursor Glob success: `{ files, totalFiles, clientTruncated?, ripgrepTruncated? }`. */
function isCursorGlobResult(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj.files)
    && obj.files.every((f) => typeof f === 'string')
    && typeof obj.totalFiles === 'number'
}

function formatCursorGlobResult(obj: Record<string, unknown>): string {
  return (obj.files as string[]).join('\n')
}

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
    || isShellCommandResult(obj)
    || isCursorGrepResult(obj)
    || isCursorGlobResult(obj)
  )
}

/**
 * Unwrap agent-native rawOutput envelopes (Grok / OpenCode / similar) into UI text.
 * Prefer human tree/listing strings over dumping the whole JSON wrapper.
 * Browser-safe (no Buffer).
 */
export function formatAgentToolOutput(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && isAgentOutputEnvelope(parsed as Record<string, unknown>)) {
          return formatAgentToolOutput(parsed)
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

  if (obj.type === 'MCP' && obj.output != null) {
    if (typeof obj.output === 'string') return obj.output
    if (typeof obj.output === 'object') {
      const values = Object.values(obj.output as Record<string, unknown>)
      if (values.length === 1 && typeof values[0] === 'string') return values[0]
    }
  }

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
  if ((obj.type === 'ListDir' || obj.type === 'list_dir') && typeof obj.Content === 'string') {
    return obj.Content
  }
  if (typeof obj.content === 'string' && obj.content.includes('\n') && (obj.type === 'ListDir' || obj.absolute_root_path != null)) {
    return obj.content
  }

  if (obj.type === 'Todo' || obj.TodosUpdated != null) {
    const todos = obj.TodosUpdated
    if (todos && typeof todos === 'object') {
      const t = todos as Record<string, unknown>
      if (typeof t.summary_for_prompt === 'string' && t.summary_for_prompt.trim()) return t.summary_for_prompt
      if (typeof t.summary === 'string' && t.summary.trim()) return t.summary
    }
  }

  if (
    obj.type === 'SearchTool'
    || Array.isArray(obj.results)
    || (obj.result_count != null && (obj.content != null || obj.results != null))
  ) {
    const formatted = formatSearchToolPayload(obj)
    if (formatted) return formatted
  }

  if (obj.type === 'GrepSearch' || obj.type === 'grep' || Array.isArray(obj.stdout)) {
    const text = bytesOrStringToText(obj.stdout ?? obj.content ?? obj.output)
    if (text) return text
  }

  if (isShellCommandResult(obj)) {
    return formatShellCommandResult(obj)
  }

  if (isCursorGrepResult(obj)) {
    return formatCursorGrepResult(obj)
  }

  if (isCursorGlobResult(obj)) {
    return formatCursorGlobResult(obj)
  }

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

  if (listContent && typeof listContent === 'object') {
    const body = listContent as Record<string, unknown>
    for (const key of ['content', 'text', 'output', 'result']) {
      if (typeof body[key] === 'string' && (body[key] as string).trim()) {
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

  // WorkflowToolOutput: keep compact JSON so run_id/task_id survive for correlation.
  if (typeof obj.run_id === 'string' || typeof obj.runId === 'string') {
    try {
      return JSON.stringify(raw)
    } catch {
      return String(raw)
    }
  }

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

/** Cap huge tool results in transcript replay so a long agent does not bloat React state. */
export const MAX_TRANSCRIPT_TOOL_RESULT_CHARS = 48_000

export function truncateTranscriptToolResult(text: string, max = MAX_TRANSCRIPT_TOOL_RESULT_CHARS): string {
  if (text.length <= max) return text
  const omitted = text.length - max
  return `${text.slice(0, max)}\n\n… truncated ${omitted.toLocaleString()} characters`
}

/**
 * Format + optionally cap a tool_result payload for transcript ToolBlock display.
 */
export function formatTranscriptToolResult(content: unknown, opts?: { maxChars?: number }): string {
  const formatted = formatAgentToolOutput(content)
  if (!formatted) return ''
  const max = opts?.maxChars ?? MAX_TRANSCRIPT_TOOL_RESULT_CHARS
  return truncateTranscriptToolResult(formatted, max)
}
