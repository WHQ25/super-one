/**
 * Pure, browser-safe tool UI helpers shared by harness live mapping and
 * transcript/JSONL replay (workflow full view, subagent full view).
 *
 * Keep this free of Node-only APIs (no Buffer) so the renderer can import it.
 */

import { extractJsonStringValue } from './partial-json'
import {
  BUILT_IN_SUPERONE_TOOL_NAMES,
  COMPUTER_USE_TOOL_NAMES,
  MINIAPP_CALL_BARE_NAME,
  MINIAPP_LIST_BARE_NAME,
} from './superone-host-owned-tools'
import {
  formatAgentToolOutput,
  formatTranscriptToolResult,
  MAX_TRANSCRIPT_TOOL_RESULT_CHARS,
  truncateTranscriptToolResult,
} from './tool-output-format'

export {
  formatAgentToolOutput,
  formatTranscriptToolResult,
  MAX_TRANSCRIPT_TOOL_RESULT_CHARS,
  truncateTranscriptToolResult,
}

/** Map agent-native / Grok tool ids → Claude-shaped UI names for ToolBlock. */
export const TOOL_ID_TO_UI_NAME: Record<string, string> = {
  read: 'Read',
  read_file: 'Read',
  readfile: 'Read',
  view_file: 'Read',
  client_view_file: 'Read',
  view_file_outline: 'Read',
  view_code_item: 'Read',
  edit: 'Edit',
  edit_file: 'Edit',
  client_edit_file: 'Edit',
  replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit',
  delete_file: 'Delete',
  search_replace: 'Edit',
  str_replace: 'Edit',
  apply_patch: 'Edit',
  hashline_edit: 'Edit',
  hashlineedit: 'Edit',
  write: 'Write',
  write_file: 'Write',
  write_to_file: 'Write',
  writefile: 'Write',
  create_file: 'Write',
  client_create_file: 'Write',
  bash: 'Bash',
  shell: 'Bash',
  run_terminal_command: 'Bash',
  run_terminal_cmd: 'Bash',
  run_command: 'Bash',
  execute: 'Bash',
  command: 'Bash',
  grep: 'Grep',
  grep_search: 'Grep',
  search_directory: 'Grep',
  search: 'Grep',
  ripgrep: 'Grep',
  glob: 'Glob',
  find_files: 'Glob',
  find_by_name: 'Glob',
  find_file: 'Glob',
  list_dir: 'LS',
  list_directory: 'LS',
  listdir: 'LS',
  ls: 'LS',
  web_fetch: 'WebFetch',
  read_url_content: 'WebFetch',
  webfetch: 'WebFetch',
  fetch: 'WebFetch',
  open_page: 'WebFetch',
  open_page_with_find: 'WebFetch',
  web_search: 'WebSearch',
  search_web: 'WebSearch',
  websearch: 'WebSearch',
  x_search: 'XSearch',
  xsearch: 'XSearch',
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
  start_subagent: 'Agent',
  invoke_subagent: 'Agent',
  agent: 'Agent',
  task: 'Task',
  workflow: 'Workflow',
  run_workflow: 'Workflow',
  memory_search: 'MemorySearch',
  memorysearch: 'MemorySearch',
  search_memory: 'MemorySearch',
  memory_get: 'MemoryGet',
  memoryget: 'MemoryGet',
  ask_user_question: 'AskUserQuestion',
  ask_question: 'AskUserQuestion',
  askuserquestion: 'AskUserQuestion',
  get_task_output: 'TaskOutput',
  get_command_or_subagent_output: 'TaskOutput',
  get_terminal_command_output: 'TaskOutput',
  get_task_or_subagent_output: 'TaskOutput',
  wait_tasks: 'TaskOutput',
  wait_commands_or_subagents: 'TaskOutput',
  wait_tasks_or_subagents: 'TaskOutput',
  kill_task: 'KillTask',
  kill_command_or_subagent: 'KillTask',
  kill_terminal_command: 'KillTask',
  kill_task_or_subagent: 'KillTask',
  enter_plan_mode: 'EnterPlanMode',
  exit_plan_mode: 'ExitPlanMode',
  skill: 'Skill',
  generate_image: 'ImageGen',
  image_gen: 'ImageGen',
  image_edit: 'ImageEdit',
  image_to_video: 'ImageToVideo',
  reference_to_video: 'ReferenceToVideo',
  video_gen: 'VideoGen',
  send_message: 'SendMessage',
  monitor: 'Monitor',
  update_goal: 'UpdateGoal',
  scheduler_create: 'SchedulerCreate',
  scheduler_delete: 'SchedulerDelete',
  scheduler_list: 'SchedulerList',
  deploy_app: 'DeployApp',
  deployapp: 'DeployApp',
  lsp: 'Lsp',
  report_findings: 'ReportFindings',
  reportfindings: 'ReportFindings',
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

const GENERIC_SUBAGENT_TYPES = new Set(['general-purpose', 'general'])
const DESCRIPTION_PERSONA_RE = /^\[([a-zA-Z][a-zA-Z0-9_-]*)\]\s*/

/**
 * Grok skills encode a persona as a leading `[tag]` on spawn `description`
 * (`spawn_subagent` has no persona field; type stays `general-purpose`).
 * Promote that tag when the type is generic, and strip the prefix from the
 * displayed description — same contract as Grok pager `format_subagent_label`.
 */
export function applyDescriptionPersonaLabel(
  description: string,
  subagentType: string,
): { description: string; subagentType: string } {
  const match = DESCRIPTION_PERSONA_RE.exec(description)
  if (!match) return { description, subagentType }
  const label = match[1]
  const rest = description.slice(match[0].length)
  const typeKey = subagentType.trim().toLowerCase()
  const generic = !typeKey || GENERIC_SUBAGENT_TYPES.has(typeKey)
  return {
    description: rest,
    subagentType: generic ? label : subagentType,
  }
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

const OPENCODE_SUPERONE_TOOL_NAMES = new Set<string>([
  ...BUILT_IN_SUPERONE_TOOL_NAMES,
  ...COMPUTER_USE_TOOL_NAMES,
  MINIAPP_CALL_BARE_NAME,
  MINIAPP_LIST_BARE_NAME,
])

/**
 * Claude/Codex: `mcp__{server}__{tool}`. Grok's wire id is `{server}__{tool}`
 * (exactly one `__` delimiter) until ACP unwrap adds the `mcp__` prefix.
 * OpenCode: `superone_{tool}` for the known host catalog only. A single `_`
 * cannot otherwise distinguish a server name from a native/third-party tool id.
 */
const MCP_BARE_SEGMENT_RE = /^[a-zA-Z0-9_.-]+$/

export function parseMcpToolName(toolName: string): { serverName: string; mcpToolName: string } | null {
  if (!toolName) return null
  const prefixed = /^mcp__(.+?)__(.+)$/.exec(toolName)
  if (prefixed) {
    if (/\s/.test(prefixed[1]) || /\s/.test(prefixed[2])) return null
    return { serverName: prefixed[1], mcpToolName: prefixed[2] }
  }
  if (toolName.startsWith('superone_')) {
    const bare = toolName.slice('superone_'.length)
    if (OPENCODE_SUPERONE_TOOL_NAMES.has(bare)) return { serverName: 'superone', mcpToolName: bare }
  }
  const delimiter = toolName.indexOf('__')
  if (delimiter <= 0) return null
  if (toolName.indexOf('__', delimiter + 2) !== -1) return null
  const serverName = toolName.slice(0, delimiter)
  const mcpToolName = toolName.slice(delimiter + 2)
  if (!serverName || !mcpToolName) return null
  if (!MCP_BARE_SEGMENT_RE.test(serverName) || !MCP_BARE_SEGMENT_RE.test(mcpToolName)) return null
  return { serverName, mcpToolName }
}

/**
 * Claude Code's name segment for an MCP server or tool: characters outside
 * `[a-zA-Z0-9_-]` become `_`; claude.ai connector names also collapse runs of
 * `_` and trim them at the ends.
 */
function normalizeClaudeMcpName(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  return name.startsWith('claude.ai ') ? normalized.replace(/_+/g, '_').replace(/^_|_$/g, '') : normalized
}

/** The `mcp__{server}__{tool}` name Claude Code gives a tool, as permission rules spell it. */
export function claudeMcpToolRuleName(serverName: string, toolName: string): string {
  return `mcp__${normalizeClaudeMcpName(serverName)}__${normalizeClaudeMcpName(toolName)}`
}

/** Tools whose chat row is never useful (meta / discovery / MCP envelope). */
const HIDDEN_UI_TOOL_NAMES = new Set([
  'TodoWrite',
  // Drawn by the turn-end gallery, not as a row.
  'ImageGeneration',
  'TaskCreate',
  'TaskUpdate',
  'UseTool',
  'SearchTools',
  'ToolSearch',
])

const HIDDEN_HARNESS_TOOL_KEYS = new Set(['toolsearch', 'searchtool', 'searchtools'])

const HIDDEN_SUPERONE_MCP_TOOLS = new Set([
  'session_rename',
  'session_tag_list',
  // Layout changes show on screen; a row for them reads as plumbing.
  'layout_snapshot',
  'layout_act',
  'session_collab_list_agents',
  'session_list_agents',
  'miniapp_list',
])

/**
 * Name-only hide rule for chat ToolBlocks. Accepts wire ids (`todo_write`) and
 * UI names (`TodoWrite`). Grok streams `tool_call_delta_chunk` with the wire
 * name before `_meta` arrives — callers must hide at that first name, not wait
 * for the refined tool_call.
 */
export function isAlwaysHiddenToolName(toolName: string): boolean {
  const ui = uiToolNameFromId(toolName) ?? toolName
  if (HIDDEN_UI_TOOL_NAMES.has(ui)) return true
  const harnessKey = ui.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  if (HIDDEN_HARNESS_TOOL_KEYS.has(harnessKey)) return true
  const mcp = parseMcpToolName(ui) ?? parseMcpToolName(toolName)
  return mcp?.serverName === 'superone' && HIDDEN_SUPERONE_MCP_TOOLS.has(mcp.mcpToolName)
}

/**
 * Resolve the ToolBlock name while Grok is still streaming arguments.
 * `use_tool` stays the envelope until `tool_name` is visible in the JSON.
 */
export function resolveGrokStreamingToolName(
  wireName: string | null | undefined,
  argumentsJson?: string,
): string | null {
  if (!wireName) return null
  const ui = uiToolNameFromId(wireName) ?? wireName
  if (ui === 'UseTool' && argumentsJson) {
    // requireClosed: an unclosed `"tool_name":"GitHub__` would otherwise unwrap
    // early and freeze the chip (or flash a hidden superone__sess* MCP name).
    const id = extractJsonStringValue(argumentsJson, 'tool_name', { requireClosed: true })
    if (id && id.includes('__')) return `mcp__${id}`
  }
  return ui
}

/** Collaboration calls whose chat row reads the inner arguments, not the `use_tool` envelope. */
const SESSION_COLLAB_TOOL_NAMES = new Set([
  'session_collab_request',
  'session_request_agents_collab',
  'session_collab_start',
  'session_start',
  'session_collab_send',
  'session_send',
  'session_collab_retrieve',
  'session_collab_wait',
  'session_wait',
])

/** True for `session_collab_*` and its short aliases, in wire or `mcp__` form. */
export function isSessionCollabToolName(toolName: string): boolean {
  if (!toolName) return false
  const mcp = parseMcpToolName(toolName)
  return SESSION_COLLAB_TOOL_NAMES.has(mcp?.mcpToolName ?? toolName)
}

/**
 * Inner arguments of a streamed Grok `use_tool` call once `tool_input` is a
 * complete object. Null while the JSON is still incomplete. A direct call
 * (no envelope) is returned as itself.
 *
 * Collab rows read `launches` / `content` / `task` at the top of the tool
 * input. Leaving the envelope in place makes those fields look missing.
 */
export function grokCollabStreamingInput(argumentsJson: string | undefined): string | null {
  if (!argumentsJson) return null
  let parsed: unknown
  try { parsed = JSON.parse(argumentsJson) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const inner = record.tool_input
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) return JSON.stringify(inner)
  if ('tool_name' in record || 'tool_input' in record) return null
  return JSON.stringify(record)
}

/**
 * Normalize a transcript / chat_history tool name + raw args into ToolBlock shape.
 * Grok uses ids like `read_file` and aliases like `target_file`; OpenCode uses
 * `path` / `filePath` and skill `id` / `name`. Live mapping and replay must agree.
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
    if (input.file_path == null && input.filePath != null) input.file_path = input.filePath
    if (input.file_path == null && input.AbsolutePath != null) input.file_path = input.AbsolutePath
    if (input.file_path == null && input.Path != null) input.file_path = input.Path
    if (input.file_path == null && input.path != null) input.file_path = input.path
    if (input.offset == null && input.StartLine != null) input.offset = input.StartLine
  } else if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Delete' || toolName === 'FileChange') {
    if (input.file_path == null && input.target_file != null) input.file_path = input.target_file
    if (input.file_path == null && input.filePath != null) input.file_path = input.filePath
    if (input.file_path == null && input.AbsolutePath != null) input.file_path = input.AbsolutePath
    if (input.file_path == null && input.TargetFile != null) input.file_path = input.TargetFile
    if (input.file_path == null && input.Path != null) input.file_path = input.Path
    if (input.file_path == null && input.path != null) input.file_path = input.path
    if (toolName === 'Write' && input.content == null && input.contents != null) input.content = input.contents
    if (toolName === 'Write' && input.content == null && input.fileText != null) input.content = input.fileText
    if (toolName === 'Write' && input.content == null && input.Content != null) input.content = input.Content
    if (toolName === 'Write' && input.content == null && input.CodeContent != null) input.content = input.CodeContent
    if (toolName === 'Edit' && input.diff == null && input.diffString != null) input.diff = input.diffString
    if (toolName === 'Edit' && input.old_string == null && input.oldString != null) input.old_string = input.oldString
    if (toolName === 'Edit' && input.old_string == null && input.Target != null) input.old_string = input.Target
    if (toolName === 'Edit' && input.new_string == null && input.newString != null) input.new_string = input.newString
    if (toolName === 'Edit' && input.new_string == null && input.Replacement != null) input.new_string = input.Replacement
    if (toolName === 'Edit' && input.replace_all == null && input.replaceAll != null) input.replace_all = input.replaceAll
  } else if (toolName === 'Skill') {
    if (input.skill == null && input.id != null) input.skill = input.id
    if (input.skill == null && input.name != null) input.skill = input.name
  } else if (toolName === 'Bash') {
    if (input.command == null && input.cmd != null) input.command = input.cmd
    if (input.command == null && input.CommandLine != null) input.command = input.CommandLine
    if (input.description == null && input.toolSummary != null) input.description = input.toolSummary
  } else if (toolName === 'LS') {
    if (input.path == null && input.target_directory != null) input.path = input.target_directory
    if (input.path == null && input.directory != null) input.path = input.directory
    if (input.path == null && input.DirectoryPath != null) input.path = input.DirectoryPath
  } else if (toolName === 'Grep') {
    if (input.pattern == null && input.query != null) input.pattern = input.query
    if (input.pattern == null && input.Pattern != null) input.pattern = input.Pattern
    if (input.pattern == null && input.Query != null) input.pattern = input.Query
    if (input.path == null && input.SearchPath != null) input.path = input.SearchPath
  } else if (toolName === 'Glob') {
    if (input.pattern == null && input.globPattern != null) input.pattern = input.globPattern
    if (input.pattern == null && input.glob_pattern != null) input.pattern = input.glob_pattern
    if (input.pattern == null && input.Pattern != null) input.pattern = input.Pattern
    if (input.path == null && input.targetDirectory != null) input.path = input.targetDirectory
    if (input.path == null && input.target_directory != null) input.path = input.target_directory
    if (input.path == null && input.SearchDirectory != null) input.path = input.SearchDirectory
  } else if (toolName === 'WebFetch') {
    if (input.url == null && input.uri != null) input.url = input.uri
    if (input.url == null && input.Url != null) input.url = input.Url
  } else if (toolName === 'WebSearch' || toolName === 'SearchTools' || toolName === 'ToolSearch' || toolName === 'SemanticSearch') {
    if (input.query == null && input.q != null) input.query = input.q
    if (input.query == null && input.Query != null) input.query = input.Query
  } else if (toolName === 'ImageGen' || toolName === 'ImageEdit') {
    if (input.prompt == null && input.Prompt != null) input.prompt = input.Prompt
    if (input.aspect_ratio == null && input.AspectRatio != null) input.aspect_ratio = input.AspectRatio
    if (input.aspect_ratio == null && input.aspectRatio != null) input.aspect_ratio = input.aspectRatio
  } else if (toolName === 'SendMessage') {
    if (input.to == null && input.Recipient != null) input.to = input.Recipient
    if (input.message == null && input.Message != null) input.message = input.Message
  }

  return { toolName, input }
}
