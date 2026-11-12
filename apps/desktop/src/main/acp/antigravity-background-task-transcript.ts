import { fileURLToPath } from 'node:url'
import { unwrapAntigravityToolOutputText } from './antigravity-protocol'

const BACKGROUND_TASK_ID_RE = /Tool is running as a background task with task id:\s*([^\r\n]+)/
const BACKGROUND_TASK_LOG_RE = /Task logs are available at:\s*([^\r\n]+)/
export const CANCELLED_TASK_OUTPUT_RE = /Task\s+"([^"]+)"\s+cancelled\./i
const SYSTEM_MESSAGE_SENDER_RE = /\bsender=([^\s\r\n<]+)/
const SYSTEM_MESSAGE_PRIORITY_RE = /\bpriority=MESSAGE_PRIORITY_(HIGH|LOW)\b/
const SYSTEM_MESSAGE_TASK_HEADER_RE =
  /content=Task id "([^"]+)" (finished|was canceled|was cancelled) with result:\r?\n([\s\S]*)$/
const SYSTEM_MESSAGE_CONTENT_RE = /\bcontent=([\s\S]*)$/
const SYSTEM_MESSAGE_TRAILING_LOG_RE = /\r?\nLog:\s*(file:\/\/[^\r\n]+|\/[^\r\n]+)\s*$/
const SYSTEM_MESSAGE_CLOSE_TAG_RE = /\r?\n?<\/SYSTEM_MESSAGE>\s*$/
export const COMMAND_EXIT_CODE_RE = /(?:^|\r?\n)(?:The command|Command) exited with code (-?\d+)\./

export interface SpawnedBackgroundTaskRef {
  taskId: string
  stepIndex: number
  toolName: string
  command?: string
  description?: string
  timerCondition?: string
  isDaemon: boolean
  cancelledInTurn: boolean
  logFile?: string
  createdAtMs?: number
}

export interface CompletedBackgroundTaskResult {
  taskId: string
  systemStepIndex: number
  priority: 'high' | 'low'
  canceled: boolean
  isError: boolean
  outputSummary: string
  logFile?: string
}

export function stripAntigravityFileUri(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed.toLowerCase().startsWith('file://')) return trimmed
  try {
    return fileURLToPath(trimmed)
  } catch {
    return trimmed.replace(/^file:\/\//i, '')
  }
}

export function unwrapAntigravityTranscriptArgs(rawArgs: unknown): Record<string, unknown> {
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(rawArgs as Record<string, unknown>)) {
    if (typeof val === 'string') {
      const t = val.trim()
      if (
        (t.startsWith('"') && t.endsWith('"')) ||
        (t.startsWith('{') && t.endsWith('}')) ||
        (t.startsWith('[') && t.endsWith(']')) ||
        t === 'true' ||
        t === 'false' ||
        /^-?\d+(?:\.\d+)?$/.test(t)
      ) {
        try {
          out[key] = JSON.parse(t)
          continue
        } catch {
          void 0
        }
      }
    }
    out[key] = val
  }
  return out
}

export function summarizeAntigravityTranscriptToolCall(
  toolName: string,
  input: Record<string, unknown>,
): string {
  void toolName
  for (const key of ['file_path', 'target_file', 'command', 'pattern', 'query', 'url', 'path', 'prompt', 'description', 'to']) {
    const val = input[key]
    if (typeof val === 'string' && val.trim()) return val.trim().slice(0, 120)
  }
  return ''
}

export function parseAntigravityTranscriptRecords(
  raw: string,
): Array<{ stepIndex: number; rec: Record<string, unknown> }> {
  const lines = raw.split('\n')
  const records: Array<{ stepIndex: number; rec: Record<string, unknown> }> = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim()
    if (!line) continue
    try {
      const rec = JSON.parse(line) as Record<string, unknown>
      const stepIndex = typeof rec.step_index === 'number' ? rec.step_index : i
      records.push({ stepIndex, rec })
    } catch {
      continue
    }
  }
  return records
}

function isDaemonTranscriptCall(rawName: string, args: Record<string, unknown>): boolean {
  if (rawName === 'run_command' || rawName === 'schedule') {
    return args.IsDaemon === true || args.is_daemon === true || args.run_in_background === true
  }
  return false
}

export function extractBackgroundTaskLaunchFromText(
  content: string,
): { taskId: string; logFile?: string } | null {
  const idMatch = BACKGROUND_TASK_ID_RE.exec(content)
  const taskId = idMatch?.[1]?.trim() ?? ''
  if (!taskId) return null
  const logMatch = BACKGROUND_TASK_LOG_RE.exec(content)
  const logFile = logMatch?.[1] ? stripAntigravityFileUri(logMatch[1]) : undefined
  return { taskId, ...(logFile ? { logFile } : {}) }
}

export function parseSystemMessageTaskResult(
  content: string,
  systemStepIndex: number,
): CompletedBackgroundTaskResult | null {
  if (!content.includes('<SYSTEM_MESSAGE>')) return null
  const withoutClose = content.replace(SYSTEM_MESSAGE_CLOSE_TAG_RE, '')
  const senderMatch = SYSTEM_MESSAGE_SENDER_RE.exec(withoutClose)
  const sender = senderMatch?.[1]?.trim() ?? ''
  const priorityMatch = SYSTEM_MESSAGE_PRIORITY_RE.exec(withoutClose)
  const priority: 'high' | 'low' = priorityMatch?.[1] === 'LOW' ? 'low' : 'high'

  const taskHeaderMatch = SYSTEM_MESSAGE_TASK_HEADER_RE.exec(withoutClose)
  if (taskHeaderMatch) {
    const taskId = taskHeaderMatch[1]?.trim() || sender
    if (!taskId) return null
    const verb = taskHeaderMatch[2] ?? 'finished'
    const canceled = verb.startsWith('was cancel')
    let rawBody = taskHeaderMatch[3] ?? ''
    let logFile: string | undefined
    const logMatch = SYSTEM_MESSAGE_TRAILING_LOG_RE.exec(rawBody)
    if (logMatch?.[1]) {
      logFile = stripAntigravityFileUri(logMatch[1])
      rawBody = rawBody.slice(0, logMatch.index)
    }
    const exitMatch = COMMAND_EXIT_CODE_RE.exec(rawBody)
    const exitCode = exitMatch?.[1] !== undefined ? Number.parseInt(exitMatch[1], 10) : 0
    const unwrapped = unwrapAntigravityToolOutputText(rawBody).trim()
    const isError = canceled || (Number.isFinite(exitCode) && exitCode !== 0)
    return {
      taskId,
      systemStepIndex,
      priority,
      canceled,
      isError,
      outputSummary: unwrapped || (canceled ? 'Tool execution was canceled' : 'done'),
      ...(logFile ? { logFile } : {}),
    }
  }

  if (!sender || !sender.includes('/task-')) return null
  const contentMatch = SYSTEM_MESSAGE_CONTENT_RE.exec(withoutClose)
  let rawBody = contentMatch?.[1] ?? ''
  const logMatch = SYSTEM_MESSAGE_TRAILING_LOG_RE.exec(rawBody)
  let logFile: string | undefined
  if (logMatch?.[1]) {
    logFile = stripAntigravityFileUri(logMatch[1])
    rawBody = rawBody.slice(0, logMatch.index)
  }
  return {
    taskId: sender,
    systemStepIndex,
    priority,
    canceled: false,
    isError: false,
    outputSummary: rawBody.trim() || 'done',
    ...(logFile ? { logFile } : {}),
  }
}

export function extractSpawnedBackgroundTasksFromTranscript(raw: string): {
  lastUserStepIndex: number
  tasks: SpawnedBackgroundTaskRef[]
} {
  const records = parseAntigravityTranscriptRecords(raw)
  let lastUserStepIndex = -1
  for (const { stepIndex, rec } of records) {
    if (rec.type === 'USER_INPUT' && stepIndex > lastUserStepIndex) {
      lastUserStepIndex = stepIndex
    }
  }

  const tasks: SpawnedBackgroundTaskRef[] = []
  const byTaskId = new Map<string, SpawnedBackgroundTaskRef>()
  let pendingPlannerCalls: Array<{ rawName: string; args: Record<string, unknown> }> = []
  let pendingCallIdx = 0

  for (const { stepIndex, rec } of records) {
    if (rec.type === 'PLANNER_RESPONSE') {
      const rawCalls = Array.isArray(rec.tool_calls) ? rec.tool_calls : []
      pendingPlannerCalls = []
      for (const tc of rawCalls) {
        if (!tc || typeof tc !== 'object') continue
        const tcObj = tc as Record<string, unknown>
        const rawName = typeof tcObj.name === 'string' && tcObj.name ? tcObj.name : 'tool'
        pendingPlannerCalls.push({ rawName, args: unwrapAntigravityTranscriptArgs(tcObj.args) })
      }
      pendingCallIdx = 0
      continue
    }

    if (rec.type === 'GENERIC') {
      const matchedCall = pendingPlannerCalls[pendingCallIdx]
      if (pendingCallIdx < pendingPlannerCalls.length) pendingCallIdx += 1
      const content = typeof rec.content === 'string' ? rec.content : ''
      const cancelledMatch = CANCELLED_TASK_OUTPUT_RE.exec(content)
      if (cancelledMatch?.[1]) {
        const existing = byTaskId.get(cancelledMatch[1].trim())
        if (existing) existing.cancelledInTurn = true
      }
      const launch = extractBackgroundTaskLaunchFromText(content)
      if (!launch) continue
      const rawName = matchedCall?.rawName ?? 'run_command'
      const args = matchedCall?.args ?? {}
      const command =
        typeof args.CommandLine === 'string' && args.CommandLine.trim()
          ? args.CommandLine.trim()
          : typeof args.command === 'string' && args.command.trim()
            ? args.command.trim()
            : undefined
      const description =
        typeof args.toolSummary === 'string' && args.toolSummary.trim()
          ? args.toolSummary.trim()
          : typeof args.Prompt === 'string' && args.Prompt.trim()
            ? args.Prompt.trim().slice(0, 120)
            : command?.slice(0, 120)
      const rawTimerCond =
        rawName === 'schedule'
          ? typeof args.TimerCondition === 'string'
            ? args.TimerCondition
            : typeof args.timer_condition === 'string'
              ? args.timer_condition
              : ''
          : ''
      const trimmedTimerCond = rawTimerCond.trim()
      const timerCondition =
        trimmedTimerCond && trimmedTimerCond.toLowerCase() !== 'never' ? trimmedTimerCond : undefined
      const createdAtMs = typeof rec.created_at === 'string' ? Date.parse(rec.created_at) : Number.NaN
      const entry: SpawnedBackgroundTaskRef = {
        taskId: launch.taskId,
        stepIndex,
        toolName: rawName,
        ...(command ? { command } : {}),
        ...(description ? { description } : {}),
        ...(timerCondition ? { timerCondition } : {}),
        isDaemon: isDaemonTranscriptCall(rawName, args),
        cancelledInTurn: false,
        ...(launch.logFile ? { logFile: launch.logFile } : {}),
        ...(Number.isFinite(createdAtMs) ? { createdAtMs } : {}),
      }
      tasks.push(entry)
      byTaskId.set(entry.taskId, entry)
    }
  }

  return { lastUserStepIndex, tasks }
}

export function extractCompletedBackgroundTasksFromTranscript(
  raw: string,
  afterStepIndex = -1,
  spawnedTasks?: ReadonlyArray<SpawnedBackgroundTaskRef>,
): Map<string, CompletedBackgroundTaskResult> {
  const out = new Map<string, CompletedBackgroundTaskResult>()
  const records = parseAntigravityTranscriptRecords(raw)
  const resolvedTasks = spawnedTasks ?? extractSpawnedBackgroundTasksFromTranscript(raw).tasks
  const conditionalSchedules = resolvedTasks.filter(
    (task) => task.toolName === 'schedule' && Boolean(task.timerCondition) && !task.cancelledInTurn && task.stepIndex > afterStepIndex,
  )
  for (const { stepIndex, rec } of records) {
    if (stepIndex <= afterStepIndex) continue
    const content = typeof rec.content === 'string' ? rec.content : ''
    const isSystemMsg = rec.type === 'SYSTEM_MESSAGE' || content.includes('<SYSTEM_MESSAGE>')
    if (!isSystemMsg) continue
    const parsed = parseSystemMessageTaskResult(content, stepIndex)
    if (parsed) out.set(parsed.taskId, parsed)
    if (conditionalSchedules.length === 0) continue
    const withoutClose = content.replace(SYSTEM_MESSAGE_CLOSE_TAG_RE, '')
    const sender = SYSTEM_MESSAGE_SENDER_RE.exec(withoutClose)?.[1]?.trim() ?? ''
    for (const sched of conditionalSchedules) {
      if (stepIndex <= sched.stepIndex || out.has(sched.taskId)) continue
      if (sender && sender === sched.taskId) continue
      const cond = sched.timerCondition!
      const matched =
        cond.toLowerCase() === 'any'
          ? sender !== sched.taskId
          : Boolean(
              sender &&
                (sender === cond || sender.endsWith(`/${cond}`) || cond.endsWith(`/${sender}`)),
            )
      if (!matched) continue
      out.set(sched.taskId, {
        taskId: sched.taskId,
        systemStepIndex: stepIndex,
        priority: 'low',
        canceled: true,
        isError: false,
        outputSummary: 'Timer cancelled early by condition',
      })
    }
  }
  return out
}
