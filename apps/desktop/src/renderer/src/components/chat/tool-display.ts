import { shortenPath } from '@/lib/path-utils'
import { extractJsonStringValue } from '@superone/shared/partial-json'

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
}

export function getToolVerb(toolName: string): string {
  if (toolName.startsWith('mcp__')) return 'Running'
  return TOOL_VERBS[toolName] ?? 'Running'
}

/** Shared tool name → icon key + summary extraction for ToolBlock & PermissionPrompt. */

export type ToolIcon = 'terminal' | 'file-text' | 'file-edit' | 'file-plus' | 'search' | 'folder-search' | 'globe' | 'message-circle' | 'wrench' | 'plug' | 'clipboard-list' | 'bot' | 'book-open' | 'canvas' | 'toolbox' | 'package' | 'pencil' | 'image'

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
export function isHiddenToolBlock(toolName: string): boolean {
  if (HIDDEN_TASK_TOOLS.has(toolName)) return true
  const mcp = parseMcpToolName(toolName)
  return (
    mcp?.serverName === 'superone' &&
    (mcp.mcpToolName === 'session_rename' || mcp.mcpToolName === 'media_generate_image')
  )
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
    case 'Task':
      return { icon: 'bot', summary: String(input.name ?? input.subagent_type ?? input.description ?? '') }
    case 'TaskOutput':
      return { icon: 'clipboard-list', summary: String(input.task_id ?? '') }
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
    case 'ToolSearch':
      return { icon: 'toolbox', summary: String(input.query ?? '') }
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
