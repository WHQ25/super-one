import { normalizeCustomBuiltinInput, normalizeSwarmTool, normalizeToolIdKey, uiToolNameFromId } from '@superone/shared/tool-ui'
export {
  isAntigravityTranscriptOutputTool,
  resolveAntigravityManageSubagentsOutput,
  resolveAntigravityManageTaskOutput,
  resolveAntigravityTranscriptToolOutput,
} from './antigravity-transcript-tool-output'

function unwrapStringArg(val: unknown): string | undefined {
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

function pickStringArg(obj: Record<string, unknown>, keys: readonly string[], trim = true): string | undefined {
  for (const key of keys) {
    const raw = unwrapStringArg(obj[key])
    if (raw === undefined) continue
    const val = trim ? raw.trim() : raw
    if (val.length > 0 || !trim) return val
  }
  return undefined
}

export function compactDiffPair(oldText: string, newText: string): { oldText: string; newText: string } {
  if (!oldText || !newText || oldText === newText) return { oldText, newText }
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const minLen = Math.min(oldLines.length, newLines.length)
  let prefix = 0
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) prefix++
  let suffix = 0
  while (suffix < minLen - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++
  if (prefix + suffix <= 6) return { oldText, newText }
  const start = Math.max(0, prefix - 3)
  return {
    oldText: oldLines.slice(start, Math.min(oldLines.length, oldLines.length - suffix + 3)).join('\n'),
    newText: newLines.slice(start, Math.min(newLines.length, newLines.length - suffix + 3)).join('\n'),
  }
}

const NON_BASH_EXECUTE_TOOLS = new Set([
  'ImageGen',
  'ImageEdit',
  'TaskOutput',
  'ManageTask',
  'KillTask',
  'NotebookEdit',
  'Workflow',
])

export function isAntigravityNonBashExecuteTool(mappedUiName: string | null | undefined): boolean {
  return Boolean(mappedUiName && NON_BASH_EXECUTE_TOOLS.has(mappedUiName))
}

function unquoteTitleValue(raw: string): string {
  const trimmed = raw.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function inferAntigravityWireTool(
  strippedToolName: string | undefined,
  title: string | undefined,
  kind: string | null | undefined,
  inObj: Record<string, unknown>,
  mutateInput = false,
): { mappedUiName: string | null; inferredTitle?: string } {
  const swarmCandidate = strippedToolName ?? title
  if (swarmCandidate && normalizeToolIdKey(swarmCandidate) === 'swarm') {
    const swarm = normalizeSwarmTool(inObj)
    if (mutateInput) Object.assign(inObj, swarm.input)
    return { mappedUiName: swarm.toolName, inferredTitle: swarm.toolName }
  }
  const direct =
    uiToolNameFromId(strippedToolName ?? title) ??
    (typeof inObj.variant === 'string' ? uiToolNameFromId(inObj.variant) ?? inObj.variant : null)
  if (direct) return { mappedUiName: direct }

  const trimmedTitle = typeof title === 'string' ? title.trim() : ''
  const hasToolField = Boolean(pickStringArg(inObj, ['ToolName', 'tool', 'tool_name']))
  const serverName = pickStringArg(inObj, ['ServerName', 'server_name', 'serverName'])
  const uriVal = pickStringArg(inObj, ['Uri', 'uri'])

  const resourceTitleMatch = /^Resource\s+(.+?)(?:\s+on Web)?$/i.exec(trimmedTitle)
  if (resourceTitleMatch && !/^Resource\s*\(/i.test(trimmedTitle)) {
    const parsedUri = unquoteTitleValue(resourceTitleMatch[1]!)
    if (mutateInput && parsedUri && !inObj.uri && !inObj.Uri) inObj.uri = parsedUri
    return { mappedUiName: 'ReadMcpResource', inferredTitle: 'ReadMcpResource' }
  }
  if (!hasToolField && serverName && uriVal) {
    return { mappedUiName: 'ReadMcpResource', inferredTitle: 'ReadMcpResource' }
  }
  if (!hasToolField && serverName && !uriVal && kind !== 'execute') {
    return { mappedUiName: 'ListMcpResources', inferredTitle: 'ListMcpResources' }
  }

  const urlTitleMatch =
    /^URL\s+(https?:\/\/\S+)$/i.exec(trimmedTitle) ??
    /^\*Opened the URL\s+(https?:\/\/\S+?)\s*\*$/i.exec(trimmedTitle)
  if (urlTitleMatch) {
    if (mutateInput && !inObj.url && !inObj.Url) inObj.url = urlTitleMatch[1]!
    return { mappedUiName: 'WebFetch', inferredTitle: 'WebFetch' }
  }
  const hasExplicitFile = Boolean(
    pickStringArg(inObj, ['file_path', 'AbsolutePath', 'TargetFile', 'FilePath', 'filePath', 'target_file', 'Path', 'path', 'NotebookPath', 'notebookPath']),
  )
  const httpUrl = pickStringArg(inObj, ['Url', 'url'])
  if (kind === 'read' && !hasExplicitFile && httpUrl && /^https?:\/\//i.test(httpUrl)) {
    return { mappedUiName: 'WebFetch', inferredTitle: 'WebFetch' }
  }

  const commandId = pickStringArg(inObj, ['CommandId', 'commandId', 'command_id'])
  const hasSendInput = inObj.Input !== undefined || inObj.input !== undefined || inObj.Terminate !== undefined || inObj.terminate !== undefined
  if (trimmedTitle === 'Waiting for command completion' || (commandId && !hasSendInput)) {
    return { mappedUiName: 'TaskOutput', inferredTitle: 'TaskOutput' }
  }
  if (/^Send\s+.+\s+to command$/i.test(trimmedTitle) || (commandId && hasSendInput)) {
    return { mappedUiName: 'ManageTask', inferredTitle: 'ManageTask' }
  }

  const notebookTitleMatch = /^Notebook\s+(.+)$/.exec(trimmedTitle)
  const notebookPath = pickStringArg(inObj, ['NotebookPath', 'notebookPath', 'notebook_path']) ??
    (notebookTitleMatch ? unquoteTitleValue(notebookTitleMatch[1]!) : undefined)
  if (notebookPath) {
    const nbTool = kind === 'read' ? 'Read' : 'NotebookEdit'
    if (mutateInput) {
      if (!inObj.notebook_path) inObj.notebook_path = notebookPath
      if (!inObj.file_path) inObj.file_path = notebookPath
    }
    return { mappedUiName: nbTool, inferredTitle: nbTool }
  }

  if (trimmedTitle === 'Waiting...' && kind === 'think') {
    return { mappedUiName: 'Wait', inferredTitle: 'Wait' }
  }

  return { mappedUiName: null }
}

export function applyAntigravityManageTaskInput(inObj: Record<string, unknown>): void {
  const normalized = normalizeCustomBuiltinInput('ManageTask', inObj)
  if (normalized) Object.assign(inObj, normalized)
}

export function applyAntigravityManageSubagentsInput(inObj: Record<string, unknown>): void {
  const normalized = normalizeCustomBuiltinInput('ManageSubagents', inObj)
  if (normalized) Object.assign(inObj, normalized)
}

export function applyAntigravityBuiltinToolInput(
  mappedUiName: string | null,
  inObj: Record<string, unknown>,
  strippedToolName?: string,
): void {
  if (!mappedUiName) return
  const normalized = normalizeCustomBuiltinInput(mappedUiName, inObj)
  if (normalized) {
    for (const [key, val] of Object.entries(normalized)) {
      if (inObj[key] === undefined) inObj[key] = val
    }
  }
  if (mappedUiName === 'TaskOutput') {
    const taskId = pickStringArg(inObj, ['task_id', 'taskId', 'CommandId', 'commandId', 'command_id'])
    if (taskId && typeof inObj.task_id !== 'string') inObj.task_id = taskId
  } else if (mappedUiName === 'Wait' && strippedToolName === 'wait_5_seconds' && inObj.durationSeconds === undefined) {
    inObj.durationSeconds = 5
  }
}
