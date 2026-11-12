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
  manage_task: 'ManageTask',
  managetask: 'ManageTask',
  manage_subagents: 'ManageSubagents',
  managesubagents: 'ManageSubagents',
  schedule: 'Schedule',
  define_subagent: 'DefineSubagent',
  definesubagent: 'DefineSubagent',
  list_resources: 'ListMcpResources',
  list_mcp_resources: 'ListMcpResources',
  listmcpresources: 'ListMcpResources',
  listmcpresourcestool: 'ListMcpResources',
  read_resource: 'ReadMcpResource',
  read_mcp_resource: 'ReadMcpResource',
  readmcpresource: 'ReadMcpResource',
  readmcpresourcetool: 'ReadMcpResource',
  sendmessage: 'SendMessage',
  call_mcp_tool: 'UseTool',
  callmcptool: 'UseTool',
  command_status: 'TaskOutput',
  commandstatus: 'TaskOutput',
  taskoutput: 'TaskOutput',
  killtask: 'KillTask',
  send_command_input: 'ManageTask',
  sendcommandinput: 'ManageTask',
  notebook_edit: 'NotebookEdit',
  notebookedit: 'NotebookEdit',
  edit_notebook: 'NotebookEdit',
  notebook_execution: 'NotebookEdit',
  execute_notebook: 'NotebookEdit',
  read_notebook: 'Read',
  wait: 'Wait',
  wait_5_seconds: 'Wait',
  skill_search: 'SearchTools',
  skillsearch: 'SearchTools',
  open_browser_url: 'WebFetch',
  sed: 'Edit',
  manage_inbox: 'ManageInbox',
  manageinbox: 'ManageInbox',
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

export const SUPERONE_KNOWN_MCP_BARE_TOOLS = new Set<string>([
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
const SUPERONE_MCP_SERVER_NAMES = new Set(['superone', 'superone-alpha', 'superone-dev'])

export function isSuperoneMcpServerName(name: string): boolean {
  return SUPERONE_MCP_SERVER_NAMES.has(name)
}

export function parseMcpToolName(toolName: string): { serverName: string; mcpToolName: string } | null {
  if (!toolName) return null
  const prefixed = /^mcp__(.+?)__(.+)$/.exec(toolName)
  if (prefixed) {
    if (/\s/.test(prefixed[1]) || /\s/.test(prefixed[2])) return null
    return { serverName: prefixed[1], mcpToolName: prefixed[2] }
  }
  for (const serverName of SUPERONE_MCP_SERVER_NAMES) {
    for (const prefix of [`${serverName}_`, `mcp_${serverName}_`]) {
      if (toolName.startsWith(prefix)) {
        const bare = toolName.slice(prefix.length)
        if (SUPERONE_KNOWN_MCP_BARE_TOOLS.has(bare)) return { serverName, mcpToolName: bare }
      }
    }
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
  return Boolean(mcp && isSuperoneMcpServerName(mcp.serverName) && HIDDEN_SUPERONE_MCP_TOOLS.has(mcp.mcpToolName))
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

export {
  FULL_RESULT_TOOL_NAMES,
  normalizeCustomBuiltinInput,
  normalizeTranscriptTool,
  resolveCustomVariantToolName,
} from './tool-ui-builtin'
