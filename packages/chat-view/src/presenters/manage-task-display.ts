export type ManageTaskAction = 'list' | 'status' | 'kill' | 'send_input' | 'unknown'

export type ManageTaskStatus = 'running' | 'done' | 'error' | 'cancelled' | 'unknown'

export interface ListedBackgroundTask {
  startTime: string
  displayStartTime: string
  taskId: string
  shortTaskId: string
  tool: string
  description: string
}

export interface ManageTaskStatusInfo {
  taskId?: string
  shortTaskId?: string
  status: ManageTaskStatus
  rawStatus: string
  logPath?: string
  truncatedLines?: number
  logOutput: string
  lastProgress?: string
}

export interface ManageTaskInfo {
  action: ManageTaskAction
  taskId?: string
  shortTaskId?: string
  sentInput?: string
  sentInputPreview?: string
  tasks: ListedBackgroundTask[]
  emptyList: boolean
  statusInfo?: ManageTaskStatusInfo
  confirmedMessage?: string
  errorMessage?: string
  extraText?: string
  hasPlaceholderResult: boolean
  raw: string
}

const STEP_TIMESTAMP_HEADER_RE = /^(?:Created At:\s*[^\r\n]+\r?\n(?:Completed At:\s*[^\r\n]+\r?\n)?|Completed At:\s*[^\r\n]+\r?\n)/
const STEP_ERROR_PREFIX_RE = /^Encountered error in step execution:\s*/i
const EMPTY_LIST_RE = /^No background tasks are currently running\.?$/i
const CANCELLED_TASK_RE = /^Task\s+"([^"]+)"\s+cancel+ed\.?$/i
const INPUT_SENT_RE = /^Input sent to task\s+"([^"]+)"\.?$/i
const CANNOT_KILL_TASK_RE = /cannot kill task\s+"([^"]+)"/i
const TRUNCATED_LINES_RE = /^<truncated\s+(\d+)\s+lines?>\r?\n?/i
const LAST_PROGRESS_RE = /(?:\r?\n)+Last progress:\s*([^\r\n]+?)\s*$/i
const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})/

export function shortenTaskId(taskId: string | undefined | null): string | undefined {
  if (typeof taskId !== 'string') return undefined
  const trimmed = taskId.trim()
  if (!trimmed) return undefined
  if (!trimmed.startsWith('/') && trimmed.includes('/')) {
    const tail = trimmed.slice(trimmed.lastIndexOf('/') + 1).trim()
    if (tail) return tail
  }
  return trimmed
}

export function formatTaskStartTime(raw: string): string {
  const trimmed = raw.trim()
  const match = ISO_TIME_RE.exec(trimmed)
  return match?.[1] ?? trimmed
}

export function formatSentInputPreview(input: string | undefined): string | undefined {
  if (typeof input !== 'string' || input.length === 0) return undefined
  const singleLine = input.replace(/\r?\n/g, '↵').replace(/\t/g, '→').trim()
  if (!singleLine) return '"↵"'
  const clipped = singleLine.length > 40 ? `${singleLine.slice(0, 40)}…` : singleLine
  return `"${clipped}"`
}

function parseAction(raw: unknown): ManageTaskAction {
  if (typeof raw !== 'string') return 'unknown'
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'list' || normalized === 'status' || normalized === 'kill' || normalized === 'send_input') {
    return normalized
  }
  return 'unknown'
}

function mapTaskStatus(raw: string): ManageTaskStatus {
  const key = raw.trim().toUpperCase()
  if (key === 'RUNNING' || key === 'IN_PROGRESS' || key === 'ACTIVE' || key === 'PENDING') return 'running'
  if (key === 'DONE' || key === 'COMPLETED' || key === 'COMPLETE' || key === 'SUCCEEDED' || key === 'SUCCESS' || key === 'FINISHED') {
    return 'done'
  }
  if (key === 'ERROR' || key === 'FAILED' || key === 'FAILURE') return 'error'
  if (key === 'CANCELED' || key === 'CANCELLED' || key === 'KILLED' || key === 'STOPPED' || key === 'ABORTED' || key === 'TERMINATED') {
    return 'cancelled'
  }
  return 'unknown'
}

function stripFileUri(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.toLowerCase().startsWith('file://')) return trimmed
  try {
    return decodeURIComponent(new URL(trimmed).pathname).replace(/^\/([A-Za-z]:)/, '$1')
  } catch {
    return trimmed.replace(/^file:\/\//i, '')
  }
}

function splitMarkdownCells(line: string): string[] {
  const trimmed = line.trim()
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const withoutEnd = inner.endsWith('|') && !inner.endsWith('\\|') ? inner.slice(0, -1) : inner
  return withoutEnd
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim())
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))
}

function parseTaskTable(text: string): ListedBackgroundTask[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) return null

  const headerIdx = lines.findIndex((line) => {
    if (!line.includes('|')) return false
    const cells = splitMarkdownCells(line).map((c) => c.toLowerCase())
    return cells.includes('task id') && (cells.includes('start time') || cells.includes('tool'))
  })
  if (headerIdx < 0) return null

  const headers = splitMarkdownCells(lines[headerIdx]!).map((c) => c.toLowerCase())
  const startIdx = headers.indexOf('start time')
  const taskIdIdx = headers.indexOf('task id')
  const toolIdx = headers.indexOf('tool')
  const descIdx = headers.indexOf('description')

  const tasks: ListedBackgroundTask[] = []
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i]!
    if (!line.includes('|')) break
    const cells = splitMarkdownCells(line)
    if (isSeparatorRow(cells)) continue
    const taskId = (taskIdIdx >= 0 ? cells[taskIdIdx] : cells[1]) ?? ''
    if (!taskId) continue
    const startTime = (startIdx >= 0 ? cells[startIdx] : cells[0]) ?? ''
    const tool = (toolIdx >= 0 ? cells[toolIdx] : cells[2]) ?? ''
    const description = (descIdx >= 0 ? cells[descIdx] : cells[3]) ?? ''
    tasks.push({
      startTime,
      displayStartTime: formatTaskStartTime(startTime),
      taskId,
      shortTaskId: shortenTaskId(taskId) ?? taskId,
      tool,
      description,
    })
  }
  return tasks
}

function parseStatusBlock(text: string, fallbackTaskId?: string): ManageTaskStatusInfo | null {
  const statusMatch = /^Status:\s*([^\r\n]+)$/im.exec(text)
  if (!statusMatch) return null

  const taskMatch = /^Task:\s*([^\r\n]+)$/im.exec(text)
  const logMatch = /^Log:\s*([^\r\n]+)$/im.exec(text)
  const taskId = taskMatch?.[1]?.trim() || fallbackTaskId
  const rawStatus = statusMatch[1]!.trim()

  let working = text
  let lastProgress: string | undefined
  const progressMatch = LAST_PROGRESS_RE.exec(working)
  if (progressMatch) {
    lastProgress = progressMatch[1]!.trim()
    working = working.slice(0, progressMatch.index)
  } else {
    const inlineProgress = /^Last progress:\s*([^\r\n]+)$/im.exec(working)
    if (inlineProgress && !/^Log output:/im.test(working)) {
      lastProgress = inlineProgress[1]!.trim()
    }
  }

  let logOutput = ''
  let truncatedLines: number | undefined
  const logHeaderMatch = /^Log output:\s*\r?\n?/im.exec(working)
  if (logHeaderMatch) {
    let body = working.slice(logHeaderMatch.index + logHeaderMatch[0].length)
    const truncMatch = TRUNCATED_LINES_RE.exec(body)
    if (truncMatch) {
      truncatedLines = Number(truncMatch[1])
      body = body.slice(truncMatch[0].length)
    }
    logOutput = body.trim()
  }

  return {
    ...(taskId ? { taskId, shortTaskId: shortenTaskId(taskId) } : {}),
    status: mapTaskStatus(rawStatus),
    rawStatus,
    ...(logMatch?.[1] ? { logPath: stripFileUri(logMatch[1]) } : {}),
    ...(truncatedLines != null && Number.isFinite(truncatedLines) ? { truncatedLines } : {}),
    logOutput,
    ...(lastProgress ? { lastProgress } : {}),
  }
}

function pickParamString(params: Record<string, unknown>, keys: readonly string[], trim = true): string | undefined {
  for (const key of keys) {
    const val = params[key]
    if (typeof val !== 'string') continue
    const out = trim ? val.trim() : val
    if (out.length > 0 || !trim) return out
  }
  return undefined
}

export function parseManageTask(
  params: Record<string, unknown>,
  result?: string | null,
  isError?: boolean,
): ManageTaskInfo {
  let action = parseAction(params.action ?? params.Action)
  let taskId = pickParamString(params, ['taskId', 'TaskId', 'task_id'])
  const sentInput = pickParamString(params, ['input', 'Input'], false)
  const sentInputPreview = formatSentInputPreview(sentInput)

  const strippedResult = typeof result === 'string'
    ? result.replace(STEP_TIMESTAMP_HEADER_RE, '').trim()
    : ''
  const hasPlaceholderResult = strippedResult === 'done' || strippedResult === 'failed'
  const text = hasPlaceholderResult ? '' : strippedResult

  const emptyList = EMPTY_LIST_RE.test(text)
  const parsedTasks = !isError && text ? parseTaskTable(text) : null
  const parsedStatus = !isError && text ? parseStatusBlock(text, taskId) : null
  const cancelledMatch = text ? CANCELLED_TASK_RE.exec(text) : null
  const inputSentMatch = text ? INPUT_SENT_RE.exec(text) : null
  const cannotKillMatch = text ? CANNOT_KILL_TASK_RE.exec(text) : null

  if (action === 'unknown') {
    if (emptyList || parsedTasks !== null) action = 'list'
    else if (parsedStatus !== null) action = 'status'
    else if (cancelledMatch || cannotKillMatch) action = 'kill'
    else if (inputSentMatch) action = 'send_input'
  }

  if (!taskId) {
    taskId =
      parsedStatus?.taskId
      ?? cancelledMatch?.[1]?.trim()
      ?? inputSentMatch?.[1]?.trim()
      ?? cannotKillMatch?.[1]?.trim()
  }

  const shortTaskId = shortenTaskId(taskId)
  const cleanedError = isError && text ? text.replace(STEP_ERROR_PREFIX_RE, '').trim() : undefined
  const confirmedMessage = !isError && (cancelledMatch || inputSentMatch) ? text : undefined
  const isStructured = emptyList || parsedTasks !== null || parsedStatus !== null || Boolean(confirmedMessage) || Boolean(cleanedError)
  const extraText = !isStructured && text ? text : undefined

  return {
    action,
    ...(taskId ? { taskId } : {}),
    ...(shortTaskId ? { shortTaskId } : {}),
    ...(sentInput !== undefined ? { sentInput } : {}),
    ...(sentInputPreview ? { sentInputPreview } : {}),
    tasks: parsedTasks ?? [],
    emptyList,
    ...(parsedStatus ? { statusInfo: parsedStatus } : {}),
    ...(confirmedMessage ? { confirmedMessage } : {}),
    ...(cleanedError ? { errorMessage: cleanedError } : {}),
    ...(extraText ? { extraText } : {}),
    hasPlaceholderResult,
    raw: text,
  }
}

export function manageTaskSummaryText(params: Record<string, unknown>): string {
  const info = parseManageTask(params)
  const parts: string[] = []
  if (info.shortTaskId) parts.push(info.shortTaskId)
  else if (info.action !== 'unknown') parts.push(info.action)
  if (info.action === 'send_input' && info.sentInputPreview) parts.push(info.sentInputPreview)
  return parts.join(' · ')
}
