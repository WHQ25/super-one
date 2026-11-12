import { claudeMcpToolRuleName, isSuperoneMcpServerName, normalizeToolIdKey, parseMcpToolName, uiToolNameFromId } from './tool-ui'

export const FULL_RESULT_TOOL_NAMES = new Set([
  'Bash',
  'ManageTask',
  'ManageSubagents',
  'Schedule',
  'DefineSubagent',
  'ListMcpResources',
  'ReadMcpResource',
])

const CUSTOM_VARIANT_TOOLS = new Set([
  'ManageTask',
  'ManageSubagents',
  'Schedule',
  'DefineSubagent',
  'ListMcpResources',
  'ReadMcpResource',
  'SendMessage',
  'NotebookEdit',
  'Wait',
  'ManageInbox',
])

export function resolveCustomVariantToolName(variant: string): string | null {
  return CUSTOM_VARIANT_TOOLS.has(variant) ? variant : null
}

function unwrapStringValue(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined
  const trimmed = val.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === 'string') return parsed
    } catch {
      void 0
    }
  }
  return val
}

function pickStr(obj: Record<string, unknown>, keys: readonly string[], trim = true): string | undefined {
  for (const key of keys) {
    const raw = unwrapStringValue(obj[key])
    if (raw === undefined) continue
    const val = trim ? raw.trim() : raw
    if (val.length > 0 || !trim) return val
  }
  return undefined
}

function pickNum(obj: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const val = obj[key]
    if (typeof val === 'number' && Number.isFinite(val)) return val
    if (typeof val === 'string' && /^-?\d+(?:\.\d+)?$/.test(val.trim())) {
      const parsed = Number(val.trim())
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

function pickBool(obj: Record<string, unknown>, keys: readonly string[]): boolean | undefined {
  for (const key of keys) {
    const val = obj[key]
    if (typeof val === 'boolean') return val
    if (val === 'true') return true
    if (val === 'false') return false
  }
  return undefined
}

function pickStrArray(obj: Record<string, unknown>, keys: readonly string[]): string[] | undefined {
  for (const key of keys) {
    const val = obj[key]
    if (Array.isArray(val)) {
      return val
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    }
    if (typeof val === 'string') {
      const trimmed = val.trim()
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed)
          if (Array.isArray(parsed)) {
            return parsed
              .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
              .map((item) => item.trim())
          }
        } catch {
          void 0
        }
      }
    }
  }
  return undefined
}

export function normalizeCustomBuiltinInput(
  toolName: string,
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  switch (toolName) {
    case 'ManageTask': {
      const out: Record<string, unknown> = {}
      const terminate = pickBool(raw, ['Terminate', 'terminate'])
      const input = pickStr(raw, ['input', 'Input'], false)
      const explicitAction = pickStr(raw, ['action', 'Action'])?.toLowerCase()
      const commandId = pickStr(raw, ['CommandId', 'commandId', 'command_id'])
      const action = explicitAction ?? (terminate === true ? 'kill' : commandId && input !== undefined ? 'send_input' : undefined)
      if (action) out.action = action
      const taskId = pickStr(raw, ['taskId', 'TaskId', 'task_id', 'CommandId', 'commandId', 'command_id'])
      if (taskId) out.taskId = taskId
      if (input !== undefined) out.input = input
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'ManageSubagents': {
      const out: Record<string, unknown> = {}
      const action = pickStr(raw, ['action', 'Action'])
      if (action) out.action = action.toLowerCase()
      const conversationIds = pickStrArray(raw, ['conversationIds', 'ConversationIds', 'conversation_ids'])
      if (conversationIds) out.conversationIds = conversationIds
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'Schedule': {
      const out: Record<string, unknown> = {}
      const prompt = pickStr(raw, ['prompt', 'Prompt'])
      if (prompt) out.prompt = prompt
      const durationSeconds = pickNum(raw, ['durationSeconds', 'DurationSeconds', 'duration_seconds'])
      if (durationSeconds !== undefined) out.durationSeconds = durationSeconds
      const cronExpression = pickStr(raw, ['cronExpression', 'CronExpression', 'cron_expression', 'cron'])
      if (cronExpression) out.cronExpression = cronExpression
      const isDaemon = pickBool(raw, ['isDaemon', 'IsDaemon', 'is_daemon'])
      if (isDaemon !== undefined) out.isDaemon = isDaemon
      const exactTiming = pickBool(raw, ['exactTiming', 'ExactTiming', 'exact_timing'])
      if (exactTiming !== undefined) out.exactTiming = exactTiming
      const maxIterations = pickNum(raw, ['maxIterations', 'MaxIterations', 'max_iterations'])
      if (maxIterations !== undefined) out.maxIterations = maxIterations
      const timerCondition = pickStr(raw, ['timerCondition', 'TimerCondition', 'timer_condition'])
      if (timerCondition) out.timerCondition = timerCondition
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'DefineSubagent': {
      const out: Record<string, unknown> = {}
      const name = pickStr(raw, ['name', 'Name'])
      if (name) out.name = name
      const description = pickStr(raw, ['description', 'Description'])
      if (description) out.description = description
      const systemPrompt = pickStr(raw, ['systemPrompt', 'SystemPrompt', 'system_prompt'])
      if (systemPrompt) out.systemPrompt = systemPrompt
      const enableWriteTools = pickBool(raw, ['enableWriteTools', 'EnableWriteTools', 'enable_write_tools'])
      if (enableWriteTools !== undefined) out.enableWriteTools = enableWriteTools
      const enableMcpTools = pickBool(raw, ['enableMcpTools', 'EnableMCPTools', 'EnableMcpTools', 'enable_mcp_tools'])
      if (enableMcpTools !== undefined) out.enableMcpTools = enableMcpTools
      const enableSubagentTools = pickBool(raw, ['enableSubagentTools', 'EnableSubagentTools', 'enable_subagent_tools'])
      if (enableSubagentTools !== undefined) out.enableSubagentTools = enableSubagentTools
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'ListMcpResources': {
      const out: Record<string, unknown> = {}
      const server = pickStr(raw, ['server', 'ServerName', 'server_name', 'serverName'])
      if (server) out.server = server
      const cursor = pickStr(raw, ['cursor', 'Cursor'])
      if (cursor) out.cursor = cursor
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'ReadMcpResource': {
      const out: Record<string, unknown> = {}
      const server = pickStr(raw, ['server', 'ServerName', 'server_name', 'serverName'])
      if (server) out.server = server
      const uri = pickStr(raw, ['uri', 'Uri', 'url', 'Url'])
      if (uri) out.uri = uri
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'SendMessage': {
      const out: Record<string, unknown> = {}
      const to = pickStr(raw, ['to', 'Recipient', 'recipient'])
      if (to) out.to = to
      const message = pickStr(raw, ['message', 'Message'], false)
      if (message !== undefined) out.message = message
      const summary = pickStr(raw, ['summary', 'Summary'])
      if (summary) out.summary = summary
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'NotebookEdit': {
      const out: Record<string, unknown> = { ...raw }
      const nbPath = pickStr(raw, ['notebook_path', 'notebookPath', 'NotebookPath', 'file_path', 'filePath', 'Path', 'path'])
      if (nbPath) {
        if (!out.notebook_path) out.notebook_path = nbPath
        if (!out.file_path) out.file_path = nbPath
      }
      return out
    }
    case 'Wait': {
      const out: Record<string, unknown> = {}
      const durationSeconds = pickNum(raw, ['durationSeconds', 'DurationSeconds', 'duration_seconds', 'seconds', 'Seconds'])
      if (durationSeconds !== undefined) out.durationSeconds = durationSeconds
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    case 'ManageInbox': {
      const out: Record<string, unknown> = {}
      const action = pickStr(raw, ['action', 'Action'])?.toLowerCase()
      if (action) out.action = action
      const messageId = pickStr(raw, ['messageId', 'MessageId', 'message_id'])
      if (messageId) out.messageId = messageId
      return Object.keys(out).length > 0 ? out : { ...raw }
    }
    default:
      return null
  }
}

function parseTranscriptMcpArgs(rawArgs: unknown): Record<string, unknown> | null {
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    return rawArgs as Record<string, unknown>
  }
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
      } catch {
        return null
      }
    }
  }
  return null
}

export function normalizeTranscriptTool(
  rawName: string,
  rawInput: Record<string, unknown>,
): { toolName: string; input: Record<string, unknown> } {
  const normalizedRawKey = normalizeToolIdKey(rawName)
  const envelopeId = typeof rawInput.tool_name === 'string' ? rawInput.tool_name : ''
  const isUseTool = normalizedRawKey === 'use_tool' || rawInput.variant === 'UseTool'
  if (isUseTool && envelopeId.includes('__')) {
    const mcpInput = rawInput.tool_input && typeof rawInput.tool_input === 'object' && !Array.isArray(rawInput.tool_input)
      ? rawInput.tool_input as Record<string, unknown>
      : {}
    return { toolName: `mcp__${envelopeId}`, input: mcpInput }
  }
  if (normalizedRawKey === 'call_mcp_tool') {
    const server = pickStr(rawInput, ['ServerName', 'server', 'serverName', 'server_name']) ?? ''
    const tool = pickStr(rawInput, ['ToolName', 'tool', 'toolName', 'tool_name']) ?? ''
    if (server && tool) {
      const canonicalServer = isSuperoneMcpServerName(server) ? 'superone' : server
      const args = parseTranscriptMcpArgs(rawInput.Arguments) ?? parseTranscriptMcpArgs(rawInput.arguments) ?? {}
      return { toolName: claudeMcpToolRuleName(canonicalServer, tool), input: { ...args } }
    }
  }
  const parsedMcp = parseMcpToolName(rawName)
  if (parsedMcp) {
    const input = { ...rawInput }
    if (!rawName.startsWith('mcp__')) {
      delete input.toolSummary
      delete input.toolAction
    }
    const canonicalServer = isSuperoneMcpServerName(parsedMcp.serverName) ? 'superone' : parsedMcp.serverName
    return { toolName: claudeMcpToolRuleName(canonicalServer, parsedMcp.mcpToolName), input }
  }

  const toolName = uiToolNameFromId(rawName) ?? rawName
  const input = { ...rawInput }

  const customNormalized = normalizeCustomBuiltinInput(toolName, input)
  if (customNormalized) {
    if (toolName === 'Wait' && normalizedRawKey === 'wait_5_seconds' && customNormalized.durationSeconds === undefined) {
      customNormalized.durationSeconds = 5
    }
    return { toolName, input: { ...input, ...customNormalized } }
  }

  if (toolName === 'Read') {
    const fp = pickStr(input, ['file_path', 'target_file', 'filePath', 'AbsolutePath', 'NotebookPath', 'notebookPath', 'Path', 'path'])
    if (input.file_path == null && fp != null) input.file_path = fp
    if (input.offset == null && input.StartLine != null) input.offset = input.StartLine
  } else if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Delete' || toolName === 'FileChange') {
    const fp = pickStr(input, ['file_path', 'target_file', 'filePath', 'AbsolutePath', 'TargetFile', 'Path', 'path'])
    if (input.file_path == null && fp != null) input.file_path = fp
    if (toolName === 'Write' && input.content == null) {
      const c = input.contents ?? input.fileText ?? input.Content ?? input.CodeContent
      if (c != null) input.content = c
    }
    if (toolName === 'Edit') {
      if (input.diff == null && input.diffString != null) input.diff = input.diffString
      if (input.old_string == null && input.oldString != null) input.old_string = input.oldString
      if (input.old_string == null && input.Target != null) input.old_string = input.Target
      if (input.new_string == null && input.newString != null) input.new_string = input.newString
      if (input.new_string == null && input.Replacement != null) input.new_string = input.Replacement
      if (input.replace_all == null && input.replaceAll != null) input.replace_all = input.replaceAll
    }
  } else if (toolName === 'Skill') {
    if (input.skill == null && input.id != null) input.skill = input.id
    if (input.skill == null && input.name != null) input.skill = input.name
  } else if (toolName === 'Bash') {
    if (input.command == null && input.cmd != null) input.command = input.cmd
    if (input.command == null && input.CommandLine != null) input.command = input.CommandLine
    if (input.description == null && input.toolSummary != null) input.description = input.toolSummary
  } else if (toolName === 'LS') {
    const p = pickStr(input, ['path', 'target_directory', 'directory', 'DirectoryPath'])
    if (input.path == null && p != null) input.path = p
  } else if (toolName === 'Grep') {
    const pat = pickStr(input, ['pattern', 'query', 'Pattern', 'Query'])
    if (input.pattern == null && pat != null) input.pattern = pat
    if (input.path == null && input.SearchPath != null) input.path = input.SearchPath
  } else if (toolName === 'Glob') {
    const pat = pickStr(input, ['pattern', 'globPattern', 'glob_pattern', 'Pattern'])
    if (input.pattern == null && pat != null) input.pattern = pat
    const p = pickStr(input, ['path', 'targetDirectory', 'target_directory', 'SearchDirectory'])
    if (input.path == null && p != null) input.path = p
  } else if (toolName === 'WebFetch') {
    const u = pickStr(input, ['url', 'uri', 'Url', 'Uri'])
    if (input.url == null && u != null) input.url = u
  } else if (toolName === 'WebSearch' || toolName === 'SearchTools' || toolName === 'ToolSearch' || toolName === 'SemanticSearch') {
    const q = pickStr(input, ['query', 'q', 'Query'])
    if (input.query == null && q != null) input.query = q
  } else if (toolName === 'ImageGen' || toolName === 'ImageEdit') {
    const p = pickStr(input, ['prompt', 'Prompt'])
    if (input.prompt == null && p != null) input.prompt = p
    const ar = pickStr(input, ['aspect_ratio', 'AspectRatio', 'aspectRatio'])
    if (input.aspect_ratio == null && ar != null) input.aspect_ratio = ar
  } else if (toolName === 'TaskOutput') {
    const taskId = pickStr(input, ['task_id', 'taskId', 'CommandId', 'commandId', 'command_id'])
    if (input.task_id == null && taskId != null) input.task_id = taskId
  }

  return { toolName, input }
}
