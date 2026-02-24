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
  AskUserQuestion: 'Asking',
  EnterPlanMode: 'Planning',
  ExitPlanMode: 'Reviewing',
}

export function getToolVerb(toolName: string): string {
  if (toolName.startsWith('mcp__')) return 'Running'
  return TOOL_VERBS[toolName] ?? 'Running'
}

/** Shared tool name → icon key + summary extraction for ToolBlock & PermissionPrompt. */

export type ToolIcon = 'terminal' | 'file-text' | 'file-edit' | 'file-plus' | 'search' | 'folder-search' | 'globe' | 'message-circle' | 'wrench' | 'plug' | 'clipboard-list' | 'bot'

export interface ToolDisplay {
  icon: ToolIcon
  summary: string
}

/** Shorten an absolute file path: relative to cwd, or replace homedir with ~. */
export function shortenPath(filePath: string, cwd?: string, homedir?: string): string {
  if (!filePath) return filePath
  if (cwd && filePath.startsWith(cwd + '/')) {
    return filePath.slice(cwd.length + 1)
  }
  if (cwd && filePath === cwd) {
    return '.'
  }
  if (homedir && filePath.startsWith(homedir + '/')) {
    return '~/' + filePath.slice(homedir.length + 1)
  }
  if (homedir && filePath === homedir) {
    return '~'
  }
  return filePath
}

/** Parse MCP tool name pattern `mcp__{serverName}__{toolName}`. */
export function parseMcpToolName(toolName: string): { serverName: string; mcpToolName: string } | null {
  const match = toolName.match(/^mcp__(.+?)__(.+)$/)
  if (!match) return null
  return { serverName: match[1], mcpToolName: match[2] }
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
    case 'Read':
      return { icon: 'file-text', summary: sp(String(input.file_path ?? '')) }
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
    case 'TodoList': {
      const total = Number(input.total ?? 0)
      const completed = Number(input.completed ?? 0)
      return { icon: 'clipboard-list', summary: total > 0 ? `${completed}/${total} completed` : '' }
    }
    case 'EnterPlanMode':
      return { icon: 'wrench', summary: 'Entered plan mode' }
    case 'ExitPlanMode':
      return { icon: 'wrench', summary: 'Exited plan mode' }
    default:
      return { icon: 'wrench', summary: '' }
  }
}

/** Parse a JSON string into a Record for tool display. */
export function parseToolInput(input: string): Record<string, unknown> {
  try { return JSON.parse(input) } catch { return {} }
}
