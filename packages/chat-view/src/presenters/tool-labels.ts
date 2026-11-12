import { parseMcpToolName } from '@superone/shared/tool-ui'
import { formatCompactDuration } from './duration-format'

export function durationSummary(input: Record<string, unknown>): string {
  const sec = input.durationSeconds ?? input.DurationSeconds ?? input.seconds
  const num = typeof sec === 'number' ? sec : typeof sec === 'string' && /^\d+(?:\.\d+)?$/.test(sec.trim()) ? Number(sec.trim()) : undefined
  return num !== undefined && Number.isFinite(num) && num > 0 ? formatCompactDuration(num * 1000) : ''
}

const TOOL_VERBS: Record<string, string> = {
  Bash: 'Running',
  Patch: 'Applying patch',
  CodeExecution: 'Executing code',
  Read: 'Reading',
  Edit: 'Editing',
  Delete: 'Deleting',
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
  AgentWait: 'Waiting',
  Wait: 'Waiting',
  TaskCreate: 'Adding task',
  TaskUpdate: 'Updating task',
  TaskGet: 'Reading task',
  TaskList: 'Listing tasks',
  AskUserQuestion: 'Asking questions',
  EnterPlanMode: 'Planning',
  ExitPlanMode: 'Reviewing',
  ReportFindings: 'Reporting findings',
  ListAgents: 'Listing agents',
  ManageTask: 'Managing task',
  manage_task: 'Managing task',
  ManageSubagents: 'Managing subagents',
  manage_subagents: 'Managing subagents',
  DefineSubagent: 'Defining subagent',
  define_subagent: 'Defining subagent',
  Schedule: 'Scheduling',
  schedule: 'Scheduling',
  ListMcpResources: 'Listing resources',
  list_resources: 'Listing resources',
  ReadMcpResource: 'Reading resource',
  read_resource: 'Reading resource',
  ManageInbox: 'Checking inbox',
  manage_inbox: 'Checking inbox',
  SendMessage: 'Sending message',
  SubagentHandback: 'Handing back',
  EnterWorktree: 'Entering worktree',
  ExitWorktree: 'Leaving worktree',
  KillTask: 'Stopping task',
  ImageGen: 'Generating image',
  ImageEdit: 'Editing image',
  Monitor: 'Monitoring',
  CronCreate: 'Scheduling',
  CronDelete: 'Cancelling schedule',
  CronList: 'Listing schedules',
  ScheduleWakeup: 'Scheduling wakeup',
  SchedulerCreate: 'Scheduling',
  SchedulerDelete: 'Cancelling schedule',
  SchedulerList: 'Listing schedules',
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
  if (parseMcpToolName(toolName)) return 'Running'
  return TOOL_VERBS[toolName] ?? 'Running'
}

const TOOL_LABELS: Record<string, string> = {
  Bash: 'Bash',
  Patch: 'Patch',
  CodeExecution: 'Execute Code',
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
  AgentWait: 'Wait for Agents',
  Wait: 'Wait',
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
  ManageTask: 'Manage Task',
  manage_task: 'Manage Task',
  ManageSubagents: 'Manage Subagents',
  manage_subagents: 'Manage Subagents',
  DefineSubagent: 'Define Subagent',
  define_subagent: 'Define Subagent',
  Schedule: 'Schedule',
  schedule: 'Schedule',
  ListMcpResources: 'List MCP Resources',
  list_resources: 'List MCP Resources',
  ReadMcpResource: 'Read MCP Resource',
  read_resource: 'Read MCP Resource',
  ManageInbox: 'Manage Inbox',
  manage_inbox: 'Manage Inbox',
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
  SendMessage: 'Send Message',
  SubagentHandback: 'Hand Back',
  EnterWorktree: 'Enter Worktree',
  ExitWorktree: 'Exit Worktree',
}

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
