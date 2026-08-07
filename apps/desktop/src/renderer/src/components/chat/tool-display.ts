import { shortenPath } from '@/lib/path-utils'
import { extractJsonStringValue } from '@superone/shared/partial-json'
import {
  isMediaGenerateImageTool,
  isMediaVideoStatusTool,
  isSuccessfulGenerationResult,
  isVideoStatusStillRunning,
} from './media-generation'
import { isWorkflowSmokeCheck, workflowToolTargetLabel } from './workflow-utils'

const PARTIAL_STRING_FIELDS: Record<string, string[]> = {
  Edit: ['file_path', 'old_string', 'new_string'],
  Write: ['file_path', 'content'],
  FileChange: ['file_path', 'kind', 'diff'],
  NotebookEdit: ['notebook_path', 'new_source', 'old_source'],
}

const TOOL_VERBS: Record<string, string> = {
  Bash: 'Running command',
  Read: 'Reading',
  Edit: 'Editing',
  Write: 'Writing',
  FileChange: 'Editing',
  NotebookEdit: 'Editing',
  Grep: 'Searching',
  Glob: 'Searching',
  WebSearch: 'Searching',
  WebFetch: 'Fetching',
  Skill: 'Running',
  Task: 'Spawning',
  TaskOutput: 'Waiting',
  TaskCreate: 'Adding task',
  TaskUpdate: 'Updating task',
  TaskGet: 'Reading task',
  TaskList: 'Listing tasks',
  AskUserQuestion: 'Asking questions',
  EnterPlanMode: 'Planning',
  ExitPlanMode: 'Reviewing',
  KillTask: 'Stopping task',
  ImageGen: 'Generating image',
  ImageEdit: 'Editing image',
  Monitor: 'Monitoring',
  UpdateGoal: 'Updating goal',
  LS: 'Listing',
  SearchTools: 'Searching tools',
  UseTool: 'Calling tool',
  MemorySearch: 'Searching memory',
}

export function getToolVerb(toolName: string): string {
  if (toolName.startsWith('mcp__')) return 'Running'
  return TOOL_VERBS[toolName] ?? 'Running'
}

/** Shared tool name → icon key + summary extraction for ToolBlock & PermissionPrompt. */

export type ToolIcon = 'terminal' | 'file-text' | 'file-edit' | 'file-plus' | 'search' | 'folder-search' | 'globe' | 'download' | 'message-circle' | 'wrench' | 'plug' | 'clipboard-list' | 'bot' | 'book-open' | 'canvas' | 'toolbox' | 'package' | 'pencil' | 'image'

export interface ToolDisplay {
  icon: ToolIcon
  summary: string
}

export { shortenPath } from '@/lib/path-utils'

/** Parse MCP tool name pattern `mcp__{serverName}__{toolName}`. */
export function parseMcpToolName(toolName: string): { serverName: string; mcpToolName: string } | null {
  const match = toolName.match(/^mcp__(.+?)__(.+)$/)
  if (!match) return null
  return { serverName: match[1], mcpToolName: match[2] }
}

/** Tools whose chat block is suppressed entirely (meta-operations the model runs
 * mid-turn, not conversational content). Shared by ToolBlock (renders null) and
 * groupContent (emits no segment, so surrounding thinking blocks stay adjacent). */
const HIDDEN_TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])

export function isAlwaysHiddenToolBlock(toolName: string): boolean {
  if (HIDDEN_TASK_TOOLS.has(toolName)) return true
  const mcp = parseMcpToolName(toolName)
  return mcp?.serverName === 'superone'
    && (mcp.mcpToolName === 'session_rename'
      || mcp.mcpToolName === 'session_collab_list_agents'
      || mcp.mcpToolName === 'session_list_agents')
}

export function isHiddenToolBlock(toolName: string, result?: string): boolean {
  if (isAlwaysHiddenToolBlock(toolName)) return true
  if (isMediaGenerateImageTool(toolName)) return !result || isSuccessfulGenerationResult(result)
  // The submit block stays visible: it is the only progress affordance during the minutes a video
  // renders, and the gallery card cannot stand in for it because the completing poll usually lands
  // in a later message. Polls are hidden while running (pure noise) and on success (the gallery
  // shows the video); a failed poll keeps its block so the error is visible.
  if (isMediaVideoStatusTool(toolName)) {
    return !result || isVideoStatusStillRunning(result) || isSuccessfulGenerationResult(result)
  }
  return false
}


/** Human-readable tool title for chat UI (internal toolName stays PascalCase / id). */
const TOOL_LABELS: Record<string, string> = {
  Bash: 'Bash',
  Read: 'Read',
  Edit: 'Edit',
  Write: 'Write',
  FileChange: 'File Change',
  NotebookEdit: 'Notebook Edit',
  Grep: 'Grep',
  Glob: 'Glob',
  WebSearch: 'Web Search',
  WebFetch: 'Web Fetch',
  LS: 'List Dir',
  ToolSearch: 'ToolSearch',
  SearchTools: 'Search Tools',
  UseTool: 'Use Tool',
  MemorySearch: 'Memory Search',
  Skill: 'Skill',
  Task: 'Task',
  TaskOutput: 'Task Output',
  TaskCreate: 'Task Create',
  TaskUpdate: 'Task Update',
  TaskGet: 'Task Get',
  TaskList: 'Task List',
  TodoList: 'Todo List',
  TodoWrite: 'Todo Write',
  AskUserQuestion: 'Ask User',
  SandboxNetworkAccess: 'Network Access',
  EnterPlanMode: 'Enter Plan Mode',
  ExitPlanMode: 'Exit Plan Mode',
  KillTask: 'Kill Task',
  ImageGen: 'Image Gen',
  ImageEdit: 'Image Edit',
  ImageToVideo: 'Image To Video',
  ReferenceToVideo: 'Reference To Video',
  VideoGen: 'Video Gen',
  Monitor: 'Monitor',
  UpdateGoal: 'Update Goal',
  SchedulerCreate: 'Scheduler Create',
  SchedulerDelete: 'Scheduler Delete',
  SchedulerList: 'Scheduler List',
  Agent: 'Agent',
  Workflow: 'Workflow',
}

/** Split camel/PascalCase and underscores into Title Case words for unknown tools. */
export function formatToolLabel(toolName: string): string {
  if (!toolName) return toolName
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName]
  const mcp = parseMcpToolName(toolName)
  if (mcp) return mcp.mcpToolName.replace(/_/g, ' ')
  return toolName
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getToolLabel(toolName: string): string {
  return formatToolLabel(toolName)
}

export function getToolDisplay(toolName: string, input: Record<string, unknown>, cwd?: string, homedir?: string): ToolDisplay {
  const sp = (p: string): string => shortenPath(p, cwd, homedir)

  // MCP tools: mcp__{serverName}__{toolName}
  if (toolName.startsWith('mcp__')) {
    return { icon: 'plug', summary: '' }
  }

  switch (toolName) {
    case 'Bash':
      return { icon: 'terminal', summary: String(input.command ?? '') }
    case 'Read': {
      const readPath = sp(String(input.file_path ?? ''))
      const readMeta = formatReadMeta(input)
      return { icon: 'file-text', summary: readMeta ? `${readPath} (${readMeta})` : readPath }
    }
    case 'Edit':
      return { icon: 'file-edit', summary: sp(String(input.file_path ?? '')) }
    case 'FileChange': {
      const filePath = sp(String(input.file_path ?? ''))
      const kind = String(input.kind ?? '')
      return { icon: 'file-edit', summary: [filePath, kind].filter(Boolean).join(' · ') }
    }
    case 'Write':
    case 'NotebookEdit':
      return { icon: 'file-plus', summary: sp(String(input.file_path ?? input.notebook_path ?? '')) }
    case 'Grep':
      return { icon: 'search', summary: `${input.pattern ?? ''}${input.path ? ` in ${sp(String(input.path))}` : ''}` }
    case 'Glob':
      return { icon: 'folder-search', summary: `${input.pattern ?? ''}${input.path ? ` in ${sp(String(input.path))}` : ''}` }
    case 'WebSearch':
      return { icon: 'globe', summary: String(input.query ?? '') }
    case 'WebFetch':
      return { icon: 'globe', summary: String(input.url ?? '') }
    case 'Skill':
      return { icon: 'wrench', summary: String(input.skill ?? '') }
    case 'AskUserQuestion': {
      const questions = Array.isArray(input.questions) ? input.questions : []
      return { icon: 'message-circle', summary: questions.length > 0 ? `${questions.length} question${questions.length !== 1 ? 's' : ''}` : '' }
    }
    case 'Agent':
    case 'Task':
      return { icon: 'bot', summary: String(input.name ?? input.subagent_type ?? input.description ?? '') }
    case 'Workflow': {
      // Smoke-check (validate_only) renders as a normal ToolBlock; live runs use WorkflowBlock.
      const target = workflowToolTargetLabel(input)
      if (isWorkflowSmokeCheck(input)) {
        return { icon: 'wrench', summary: target ? `smoke-check · ${target}` : 'smoke-check' }
      }
      return { icon: 'wrench', summary: target }
    }
    case 'TaskOutput': {
      const ids = Array.isArray(input.task_ids)
        ? input.task_ids.filter((id): id is string => typeof id === 'string')
        : []
      const id = String(input.task_id ?? ids[0] ?? '')
      const extra = ids.length > 1 ? ` (+${ids.length - 1})` : ''
      return { icon: 'clipboard-list', summary: id ? `${id}${extra}` : '' }
    }
    case 'KillTask':
      return { icon: 'clipboard-list', summary: String(input.task_id ?? input.taskId ?? '') }
    case 'ImageGen':
    case 'ImageEdit':
      return { icon: 'image', summary: String(input.prompt ?? '') }
    case 'Monitor':
      return { icon: 'terminal', summary: String(input.description ?? input.command ?? '') }
    case 'UpdateGoal':
      return { icon: 'wrench', summary: String(input.message ?? input.blocked_reason ?? '') }
    case 'TaskCreate':
      return { icon: 'clipboard-list', summary: String(input.subject ?? '') }
    case 'TaskUpdate': {
      const status = input.status ? String(input.status) : 'update'
      const target = input.subject ?? input.taskId ?? ''
      return { icon: 'clipboard-list', summary: target ? `${status}: ${target}` : status }
    }
    case 'TaskGet':
      return { icon: 'clipboard-list', summary: String(input.taskId ?? '') }
    case 'TaskList':
      return { icon: 'clipboard-list', summary: input.status ? `status: ${input.status}` : '' }
    case 'TodoList': {
      const total = Number(input.total ?? 0)
      const completed = Number(input.completed ?? 0)
      return { icon: 'clipboard-list', summary: total > 0 ? `${completed}/${total} completed` : '' }
    }
    case 'SandboxNetworkAccess':
      return { icon: 'globe', summary: String(input.host ?? '') }
    case 'LS':
      return { icon: 'folder-search', summary: sp(String(input.path ?? input.target_directory ?? input.directory ?? '')) }
    case 'ToolSearch':
    case 'SearchTools':
      return { icon: 'toolbox', summary: String(input.query ?? '') }
    case 'UseTool': {
      const name = String(input.tool_name ?? input.name ?? input.tool ?? '')
      const server = input.server ? String(input.server) : ''
      return { icon: 'plug', summary: server && name ? `${server} · ${name}` : name }
    }
    case 'MemorySearch':
      return { icon: 'book-open', summary: String(input.query ?? input.text ?? '') }
    case 'EnterPlanMode':
      return { icon: 'wrench', summary: 'Entered plan mode' }
    case 'ExitPlanMode':
      return { icon: 'wrench', summary: 'Exited plan mode' }
    default:
      return { icon: 'wrench', summary: '' }
  }
}

export function formatReadMeta(input: Record<string, unknown>): string {
  if (input.pages != null) return `Page ${input.pages}`
  const offset = input.offset != null ? Number(input.offset) : 0
  const limit = input.limit != null ? Number(input.limit) : undefined
  const start = offset || 1
  if (limit != null) return `L${start}–${start + limit - 1}`
  if (offset > 0) return `L${offset}+`
  return ''
}

/** Parse a JSON string into a Record for tool display. */
export function parseToolInput(input: string, toolName?: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return extractPartialToolInput(input, toolName)
  }
}

export function extractPartialToolInput(input: string, toolName?: string): Record<string, unknown> {
  if (toolName === 'Bash' && input.trim()) return { command: input }
  const partial: Record<string, unknown> = {}
  const fields = toolName && PARTIAL_STRING_FIELDS[toolName]
  if (fields) {
    for (const key of fields) {
      const v = extractJsonStringValue(input, key)
      if (v !== undefined) partial[key] = v
    }
    return partial
  }
  const pathMatch = input.match(/"file_path"\s*:\s*"([^"]*)"/)
  if (pathMatch) partial.file_path = pathMatch[1]
  const nbMatch = input.match(/"notebook_path"\s*:\s*"([^"]*)"/)
  if (nbMatch) partial.notebook_path = nbMatch[1]
  return partial
}
