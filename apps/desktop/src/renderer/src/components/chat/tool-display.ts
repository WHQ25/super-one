import { shortenPath } from '@/lib/path-utils'
import { isAlwaysHiddenToolName } from '@superone/shared/tool-ui'
import { DEVICE_AGENT_TOOL_NAMES } from '@superone/shared/superone-host-owned-tools'
import { extractPartialToolInput } from '@/stores/chat-store/event-reducer/partial-tool-input'
import {
  isGrokVideoGenTool,
  isMediaGenerateImageTool,
  isMediaVideoStatusTool,
  isSuccessfulGenerationResult,
  isWidgetShowTool,
  nativeWidgetImages,
  nativeWidgetVideos,
  isVideoStatusStillRunning,
} from './media-generation'
import { topFindingSummary } from './report-findings-display'
import { isWorkflowSmokeCheck, workflowToolTargetLabel } from './workflow-utils'

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
  ReportFindings: 'Reporting findings',
  ListAgents: 'Listing agents',
  KillTask: 'Stopping task',
  ImageGen: 'Generating image',
  ImageEdit: 'Editing image',
  Monitor: 'Monitoring',
  UpdateGoal: 'Updating goal',
  LS: 'Listing',
  SearchTools: 'Searching tools',
  UseTool: 'Calling tool',
  MemorySearch: 'Searching memory',
  MemoryGet: 'Reading memory',
  Lsp: 'Querying language server',
  DeployApp: 'Deploying',
  XSearch: 'Searching X',
}

export function getToolVerb(toolName: string): string {
  if (toolName.startsWith('mcp__')) return 'Running'
  return TOOL_VERBS[toolName] ?? 'Running'
}

/** Shared tool name → icon key + summary extraction for ToolBlock & PermissionPrompt. */

export type ToolIcon = 'terminal' | 'file-text' | 'file-edit' | 'file-plus' | 'search' | 'folder-search' | 'globe' | 'download' | 'message-circle' | 'wrench' | 'plug' | 'clipboard-list' | 'bot' | 'book-open' | 'canvas' | 'toolbox' | 'package' | 'pencil' | 'image' | 'smartphone'

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

export function isAlwaysHiddenToolBlock(toolName: string): boolean {
  return isAlwaysHiddenToolName(toolName)
}

export function isHiddenToolBlock(toolName: string, result?: string): boolean {
  if (isAlwaysHiddenToolBlock(toolName)) return true
  // A native-template widget_show *is* the gallery, so its row would only narrate what the user can
  // already see. A code widget, a still-streaming call, and a failed build all keep their row —
  // this reads the same parse the gallery collects from, so the two cannot disagree.
  if (isWidgetShowTool(toolName)) return nativeWidgetImages(result).length > 0 || nativeWidgetVideos(result).length > 0
  if (isMediaGenerateImageTool(toolName)) return !result || isSuccessfulGenerationResult(result)
  // Grok native video is synchronous (path on complete) — hide the tool row when the gallery
  // will render the file, same as ImageGen.
  if (isGrokVideoGenTool(toolName)) return !result || isSuccessfulGenerationResult(result)
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
  MemoryGet: 'Memory Read',
  Lsp: 'LSP',
  DeployApp: 'Deploy App',
  XSearch: 'X Search',
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
  ReportFindings: 'Code Review',
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

const DEVICE_TOOL_NAMES = new Set<string>(DEVICE_AGENT_TOOL_NAMES)

function deviceToolSummary(toolName: string, input: Record<string, unknown>): string | null {
  const mcp = parseMcpToolName(toolName)
  // Matched against the shared name set, not a `device_` prefix: a third-party MCP
  // server is free to ship its own device_* tool, and this row is not about it.
  if (!mcp || mcp.serverName !== 'superone' || !DEVICE_TOOL_NAMES.has(mcp.mcpToolName)) return null
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  const device = typeof input.device === 'string' ? input.device.trim() : ''
  // The runtime rides along on the control request, where the same model exists on
  // every installed one and the name alone does not say which is being handed over.
  const platform = typeof input.platform === 'string' ? input.platform.trim() : ''
  return [device, platform, description].filter(Boolean).join(' · ')
}

export function getToolDisplay(toolName: string, input: Record<string, unknown>, cwd?: string, homedir?: string): ToolDisplay {
  const sp = (p: string): string => shortenPath(p, cwd, homedir)

  // Device tools all carry a `description` written for the person watching, which is
  // exactly the summary this row wants — and it is what makes the *standard*
  // permission prompt readable for device_request_control, which has no bespoke
  // dialog of its own.
  const deviceSummary = deviceToolSummary(toolName, input)
  if (deviceSummary !== null) return { icon: 'smartphone', summary: deviceSummary }

  // MCP tools: mcp__{serverName}__{toolName}
  if (toolName.startsWith('mcp__')) {
    return { icon: 'plug', summary: '' }
  }

  switch (toolName) {
    case 'Bash':
      return { icon: 'terminal', summary: String(input.command ?? '') }
    case 'ReportFindings':
      // Compact surfaces get the top finding — the list is ranked most-severe first,
      // so the first entry is the one worth the single line they have room for.
      return { icon: 'clipboard-list', summary: topFindingSummary(input) }
    // The roster is the result, not the args (which are usually `{}`), so the header
    // stays empty here and `ListAgentsToolBlock` derives its summary from the output.
    case 'ListAgents':
      return { icon: 'bot', summary: '' }
    case 'Read': {
      const readPath = sp(String(input.file_path ?? ''))
      const readMeta = formatReadMeta(input)
      return { icon: 'file-text', summary: readMeta ? `${readPath} (${readMeta})` : readPath }
    }
    case 'Edit':
      return { icon: 'file-edit', summary: sp(String(input.file_path ?? '')) }
    case 'Delete':
      return { icon: 'file-edit', summary: sp(String(input.file_path ?? input.path ?? '')) }
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
    case 'SemanticSearch':
      return { icon: 'search', summary: String(input.query ?? '') }
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
    case 'Artifact': {
      switch (String(input.action ?? 'publish')) {
        case 'list':
          return { icon: 'canvas', summary: input.scope === 'all' ? 'list · all' : 'list' }
        case 'upload_asset':
          return { icon: 'canvas', summary: 'upload asset' }
        case 'list_assets':
          return { icon: 'canvas', summary: 'list assets' }
        case 'read_asset':
          return { icon: 'canvas', summary: 'read asset' }
        case 'delete_asset':
          return { icon: 'canvas', summary: 'delete asset' }
        default:
          // Publish is the unlabeled action; the title is its only header-worthy
          // input, and once the call settles the chip carries it instead.
          return { icon: 'canvas', summary: String(input.title ?? '') }
      }
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
    case 'MemoryGet':
      return { icon: 'book-open', summary: sp(String(input.path ?? input.file_path ?? '')) }
    case 'XSearch':
      return { icon: 'globe', summary: String(input.query ?? '') }
    case 'Lsp':
      return { icon: 'wrench', summary: String(input.operation ?? input.method ?? '') }
    case 'DeployApp':
      return { icon: 'package', summary: String(input.name ?? input.url ?? '') }
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

export { extractPartialToolInput }
