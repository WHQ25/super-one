import { formatCompactDuration } from './duration-format'
import { shortenTaskId } from './manage-task-display'

export type ScheduleMode = 'timer' | 'cron' | 'unknown'

export interface ScheduleBlockInfo {
  mode: ScheduleMode
  prompt: string
  promptPreview: string
  durationSeconds?: number
  cronExpression?: string
  isDaemon: boolean
  exactTiming: boolean
  maxIterations?: number
  timerCondition?: string
  taskId?: string
  shortTaskId?: string
  taskDescription?: string
  logPath?: string
  errorMessage?: string
  extraText?: string
  hasPlaceholderResult: boolean
  raw: string
}

const STEP_TIMESTAMP_HEADER_RE = /^(?:Created At:\s*[^\r\n]+\r?\n(?:Completed At:\s*[^\r\n]+\r?\n)?|Completed At:\s*[^\r\n]+\r?\n)/
const STEP_ERROR_PREFIX_RE = /^Encountered error in step execution:\s*/i
const BG_TASK_ID_RE = /Tool is running as a background task with task id:\s*([^\r\n]+)/i
const TASK_DESC_RE = /^Task Description:\s*([^\r\n]+)/im
const TASK_LOGS_RE = /^Task logs are available at:\s*([^\r\n]+)/im

function unwrapStr(val: unknown): string {
  if (typeof val !== 'string') return ''
  const trimmed = val.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === 'string') return parsed.trim()
    } catch {
      void 0
    }
  }
  return trimmed
}

function readNum(val: unknown): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val)) return val
  if (typeof val === 'string' && /^-?\d+(?:\.\d+)?$/.test(val.trim())) {
    const parsed = Number(val.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function readBool(val: unknown): boolean {
  if (typeof val === 'boolean') return val
  if (val === 'true') return true
  return false
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

export function parseScheduleBlock(
  params: Record<string, unknown>,
  result?: string | null,
  isError?: boolean,
): ScheduleBlockInfo {
  const prompt = unwrapStr(params.prompt ?? params.Prompt)
  const promptPreview = (prompt.split(/\r?\n/, 1)[0] ?? '').trim()
  const durationSeconds = readNum(params.durationSeconds ?? params.DurationSeconds ?? params.duration_seconds)
  const cronRaw = unwrapStr(params.cronExpression ?? params.CronExpression ?? params.cron_expression ?? params.cron)
  const cronExpression = cronRaw || undefined
  const isDaemon = readBool(params.isDaemon ?? params.IsDaemon ?? params.is_daemon)
  const exactTiming = readBool(params.exactTiming ?? params.ExactTiming ?? params.exact_timing)
  const maxIterations = readNum(params.maxIterations ?? params.MaxIterations ?? params.max_iterations)
  const condRaw = unwrapStr(params.timerCondition ?? params.TimerCondition ?? params.timer_condition)
  const timerCondition = condRaw && condRaw.toLowerCase() !== 'never' ? condRaw : undefined

  let mode: ScheduleMode = cronExpression ? 'cron' : durationSeconds !== undefined ? 'timer' : 'unknown'

  const strippedResult = typeof result === 'string'
    ? result.replace(STEP_TIMESTAMP_HEADER_RE, '').trim()
    : ''
  const hasPlaceholderResult = strippedResult === 'done' || strippedResult === 'failed'
  const text = hasPlaceholderResult ? '' : strippedResult

  const taskIdMatch = !isError && text ? BG_TASK_ID_RE.exec(text) : null
  const taskId = taskIdMatch?.[1]?.trim() || undefined
  const shortTaskId = shortenTaskId(taskId)
  const taskDescription = !isError && text ? TASK_DESC_RE.exec(text)?.[1]?.trim() : undefined
  const logRaw = !isError && text ? TASK_LOGS_RE.exec(text)?.[1]?.trim() : undefined
  const logPath = logRaw ? stripFileUri(logRaw) : undefined

  if (mode === 'unknown' && taskDescription) {
    if (/^Cron:/i.test(taskDescription)) mode = 'cron'
    else if (/^Timer:/i.test(taskDescription)) mode = 'timer'
  }

  const cleanedError = isError && text ? text.replace(STEP_ERROR_PREFIX_RE, '').trim() : undefined
  const isStructured = Boolean(taskId) || Boolean(cleanedError)
  const extraText = !isStructured && text ? text : undefined

  return {
    mode,
    prompt,
    promptPreview,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(cronExpression ? { cronExpression } : {}),
    isDaemon,
    exactTiming,
    ...(maxIterations !== undefined ? { maxIterations } : {}),
    ...(timerCondition ? { timerCondition } : {}),
    ...(taskId ? { taskId } : {}),
    ...(shortTaskId ? { shortTaskId } : {}),
    ...(taskDescription ? { taskDescription } : {}),
    ...(logPath ? { logPath } : {}),
    ...(cleanedError ? { errorMessage: cleanedError } : {}),
    ...(extraText ? { extraText } : {}),
    hasPlaceholderResult,
    raw: text,
  }
}

export function formatScheduleTriggerText(info: ScheduleBlockInfo, locale = 'en'): string {
  if (info.cronExpression) return info.cronExpression
  if (info.durationSeconds !== undefined) {
    return formatCompactDuration(info.durationSeconds * 1000, locale)
  }
  return ''
}

export function scheduleBlockSummaryText(params: Record<string, unknown>, locale = 'en'): string {
  const info = parseScheduleBlock(params)
  const trigger = formatScheduleTriggerText(info, locale)
  return [trigger, info.promptPreview].filter(Boolean).join(' · ')
}
