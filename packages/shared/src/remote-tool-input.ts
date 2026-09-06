/**
 * Block type a tool call is remapped to before it leaves for a remote surface, so the
 * phone's reducer can group and route without re-deriving it from the tool name.
 */
const REMOTE_TOOL_BLOCK_TYPES: Record<string, string> = {
  Read: 'read', Edit: 'edit', Write: 'write',
  NotebookEdit: 'notebook_edit', FileChange: 'file_change',
  Bash: 'bash', Grep: 'grep', Glob: 'glob',
  WebSearch: 'web_search', WebFetch: 'web_fetch',
  Agent: 'agent', Skill: 'skill', Workflow: 'workflow',
}

export function remoteToolBlockType(toolName: string): string {
  return REMOTE_TOOL_BLOCK_TYPES[toolName] ?? 'tool_use'
}

const REMOTE_TOOL_INPUT_SUFFIXES = [
  '__widget_show',
  '__mobile_share_file',
  '__media_generate_image',
  '__media_generate_video',
] as const

const REMOTE_TOOL_INPUT_NAMES = new Set(['ReportFindings'])

/** Full tool inputs required by a mobile presenter or native host action. */
export function shouldKeepRemoteToolInput(toolName: string): boolean {
  return REMOTE_TOOL_INPUT_NAMES.has(toolName)
    || REMOTE_TOOL_INPUT_SUFFIXES.some((suffix) => toolName.endsWith(suffix))
}

/**
 * Fields the shared tool row reads out of a built-in tool's input.
 *
 * Every field listed here already reaches the phone in another form — `computeToolMeta`
 * folds `command`, `pattern`, `query`, `url` and the `Read` line range into `toolSummary`,
 * `file_path` into `toolFilePath`, and the whole edited body into `toolDiff` — so naming
 * them costs no privacy a lost phone did not already hold. It just spares the presenter
 * from re-deriving what it was written to read.
 *
 * Content-bearing fields stay stripped: `old_string` / `new_string` / `content` (rows draw
 * from `toolDiff`), `script`, question and option text, and every tool absent from this map.
 */
const BUILTIN_TOOL_INPUT_FIELDS: Record<string, readonly string[]> = {
  Bash: ['command', 'description', 'timeout', 'run_in_background', 'background'],
  Monitor: ['description', 'command'],
  Read: ['file_path', 'offset', 'limit', 'pages'],
  Edit: ['file_path'],
  Write: ['file_path', 'notebook_path'],
  NotebookEdit: ['file_path', 'notebook_path'],
  Delete: ['file_path', 'path'],
  FileChange: ['file_path', 'kind'],
  Grep: ['pattern', 'path'],
  Glob: ['pattern', 'path'],
  LS: ['path', 'target_directory', 'directory'],
  WebSearch: ['query'],
  SemanticSearch: ['query'],
  XSearch: ['query'],
  MemorySearch: ['query', 'text'],
  MemoryGet: ['path', 'file_path'],
  WebFetch: ['url'],
  Skill: ['skill'],
  Agent: ['name', 'subagent_type', 'description', 'model', 'team_name', 'prompt', 'run_in_background'],
  Task: ['name', 'subagent_type', 'description', 'model', 'team_name', 'prompt', 'run_in_background'],
  Workflow: ['name', 'script_path', 'scriptPath', 'validate_only', 'validateOnly'],
  TaskOutput: ['task_id', 'task_ids'],
  KillTask: ['task_id', 'taskId'],
  TaskCreate: ['subject'],
  TaskUpdate: ['status', 'subject', 'taskId'],
  TaskGet: ['taskId'],
  TaskList: ['status'],
  TodoList: ['total', 'completed'],
  UpdateGoal: ['message', 'blocked_reason'],
  Artifact: ['action', 'scope', 'title'],
  SandboxNetworkAccess: ['host'],
  ToolSearch: ['query'],
  SearchTools: ['query'],
  UseTool: ['tool_name', 'name', 'tool', 'server'],
  Lsp: ['operation', 'method'],
  DeployApp: ['name', 'url'],
  ImageGen: ['prompt'],
  ImageEdit: ['prompt'],
}

/**
 * `AskUserQuestion` headers count the questions and nothing else — the answered
 * pairs render from the tool result, which the phone already receives. Keeping the
 * array's length while emptying its entries gives the row its count with no text.
 */
function sanitizeAskUserQuestionInput(source: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  if (Array.isArray(source.questions)) safe.questions = source.questions.map(() => ({}))
  copyDefined(source, safe, ['previewFormat'])
  return safe
}

function sanitizeBuiltinInput(toolName: string, input: string): string {
  const fields = BUILTIN_TOOL_INPUT_FIELDS[toolName]
  if ((!fields && toolName !== 'AskUserQuestion') || !input) return ''
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { return '' }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
  const source = parsed as Record<string, unknown>
  const safe = toolName === 'AskUserQuestion'
    ? sanitizeAskUserQuestionInput(source)
    : {}
  if (fields) copyDefined(source, safe, fields)
  return Object.keys(safe).length > 0 ? JSON.stringify(safe) : ''
}

function superoneBareName(toolName: string): string | null {
  const match = toolName.match(/^mcp__superone(?:__|\.)([a-z_]+)$/)
  return match?.[1] ?? null
}

function copyDefined(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    if (source[key] !== undefined) target[key] = source[key]
  }
}

/**
 * Keep only the Browser fields needed to select the shared presenter and show the
 * agent-written description. Typed text, selectors, URLs, and page-tool arguments
 * remain stripped from the remote transcript.
 */
function sanitizeBrowserInput(toolName: string, input: string): string {
  const bare = superoneBareName(toolName)
  if (!bare?.startsWith('browser_')) return ''
  return sanitizePresenterInput(bare, input)
}

function actionTypes(value: unknown, keepKeyboardState = false): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.flatMap((action) => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) return []
    const source = action as Record<string, unknown>
    if (typeof source.type !== 'string') return []
    return [{
      type: source.type,
      ...(keepKeyboardState && source.type === 'keyboard' && typeof source.connected === 'boolean'
        ? { connected: source.connected }
        : {}),
    }]
  })
}

function sanitizePresenterInput(bare: string, input: string): string {
  if (!bare || !input) return ''
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { return '' }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
  const source = parsed as Record<string, unknown>
  const safe: Record<string, unknown> = {}
  copyDefined(source, safe, ['description'])
  switch (bare) {
    case 'browser_snapshot':
      copyDefined(source, safe, ['include'])
      break
    case 'browser_query':
      copyDefined(source, safe, ['op'])
      break
    case 'browser_act':
      if (Array.isArray(source.actions)) safe.actions = actionTypes(source.actions)
      break
    case 'browser_network': {
      copyDefined(source, safe, ['action', 'preset', 'reset', 'width', 'height'])
      const fullEmulationFields = [
        'deviceScaleFactor', 'mobile', 'userAgent', 'colorScheme', 'timezone',
        'locale', 'latitude', 'longitude',
      ]
      for (const key of fullEmulationFields) {
        if (source[key] !== undefined) safe[key] = true
      }
      break
    }
    case 'browser_action':
      copyDefined(source, safe, ['action', 'domain', 'name'])
      break
    case 'browser_tabs':
      copyDefined(source, safe, ['action'])
      break
    case 'browser_tools_call':
      copyDefined(source, safe, ['name'])
      break
  }
  return Object.keys(safe).length > 0 ? JSON.stringify(safe) : ''
}

/** Device/computer rows need only operation kinds; coordinates, text, refs, and app ids stay private. */
function sanitizeInteractiveInput(toolName: string, input: string): string {
  const bare = superoneBareName(toolName)
  if (!bare || (!bare.startsWith('device_') && !bare.startsWith('computer_'))) return ''
  if (!input) return ''
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { return '' }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
  const source = parsed as Record<string, unknown>
  const safe: Record<string, unknown> = {}
  copyDefined(source, safe, ['description'])

  if (bare === 'device_snapshot') copyDefined(source, safe, ['mode'])
  else if (bare === 'device_query') copyDefined(source, safe, ['op'])
  else if (bare === 'device_act' && Array.isArray(source.actions)) {
    safe.actions = actionTypes(source.actions, true)
  } else if (bare === 'computer_apps') copyDefined(source, safe, ['action'])
  else if (bare === 'computer_snapshot') copyDefined(source, safe, ['mode', 'capture'])
  else if (bare === 'computer_query') copyDefined(source, safe, ['op'])
  else if (bare === 'computer_act' && Array.isArray(source.actions)) {
    safe.actions = actionTypes(source.actions)
  }
  return Object.keys(safe).length > 0 ? JSON.stringify(safe) : ''
}

function sanitizeCollabInput(toolName: string, input: string): string {
  const bare = superoneBareName(toolName)
  const requestTools = new Set(['session_collab_request', 'session_request_agents_collab'])
  const sendTools = new Set(['session_collab_send', 'session_send'])
  if (!bare || (!requestTools.has(bare) && !sendTools.has(bare)) || !input) return ''
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { return '' }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
  const source = parsed as Record<string, unknown>
  if (sendTools.has(bare)) {
    return typeof source.content === 'string' ? JSON.stringify({ content: source.content }) : ''
  }
  if (!Array.isArray(source.launches)) return ''
  const launches = source.launches.flatMap((launch) => {
    if (!launch || typeof launch !== 'object' || Array.isArray(launch)) return []
    const item = launch as Record<string, unknown>
    const safe: Record<string, unknown> = {}
    copyDefined(item, safe, ['name', 'role', 'launchId'])
    if (item.config && typeof item.config === 'object' && !Array.isArray(item.config)) {
      const config: Record<string, unknown> = {}
      copyDefined(item.config as Record<string, unknown>, config, ['name', 'role'])
      if (Object.keys(config).length > 0) safe.config = config
    }
    return Object.keys(safe).length > 0 ? [safe] : []
  })
  return launches.length > 0 ? JSON.stringify({ launches }) : ''
}

function sanitizeWorkflowInput(toolName: string, input: string): string {
  const bare = superoneBareName(toolName)
  const supported = new Set([
    'automation_list',
    'automation_apply',
    'automation_delete',
    'config_apply',
    'project_list',
    'session_list',
    'session_search',
    'session_read',
    'session_cleanup',
    'miniapp_call',
    'miniapp_dev_pack',
  ])
  if (!bare || !supported.has(bare) || !input) return ''
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { return '' }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
  const source = parsed as Record<string, unknown>
  const safe: Record<string, unknown> = {}

  if (bare === 'automation_list') {
    copyDefined(source, safe, ['id'])
  } else if (bare === 'automation_apply') {
    copyDefined(source, safe, ['action', 'name', 'enabled'])
  } else if (bare === 'automation_delete' && Array.isArray(source.ids)) {
    safe.ids = source.ids.map(() => '')
  } else if (bare === 'config_apply') {
    const resource = source.resource && typeof source.resource === 'object' && !Array.isArray(source.resource)
      ? source.resource as Record<string, unknown>
      : null
    if (resource && typeof resource.operation === 'string') {
      safe.resource = { operation: resource.operation }
    }
  } else if (bare === 'session_list') {
    copyDefined(source, safe, ['harness'])
  } else if (bare === 'session_read') {
    copyDefined(source, safe, ['view'])
  } else if (bare === 'miniapp_call') {
    // The card names the app and the tool it ran; the tool's own arguments stay private.
    copyDefined(source, safe, ['appId', 'tool'])
  } else if (bare === 'miniapp_dev_pack') {
    copyDefined(source, safe, ['appDir', 'outputDir'])
  } else if (bare === 'session_cleanup') {
    copyDefined(source, safe, ['action'])
    if (Array.isArray(source.sessionIds)) safe.sessionIds = source.sessionIds.map(() => '')
  }
  return Object.keys(safe).length ? JSON.stringify(safe) : ''
}

/** Privacy-preserving tool input projected into the remote transcript. */
export function sanitizeRemoteToolInput(toolName: string, input: string): string {
  if (shouldKeepRemoteToolInput(toolName)) return input
  return sanitizeBuiltinInput(toolName, input)
    || sanitizeBrowserInput(toolName, input)
    || sanitizeInteractiveInput(toolName, input)
    || sanitizeCollabInput(toolName, input)
    || sanitizeWorkflowInput(toolName, input)
}
