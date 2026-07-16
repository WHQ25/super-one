import { randomUUID } from 'crypto'
import type { AgentEvent } from '@superone/shared/agent-types'
import log from '../logger'
import { downloadUrl, type DownloadResult } from './browser-downloads'

export type DownloadTaskStatus = 'running' | 'completed' | 'failed' | 'stopped'

export interface BrowserDownloadTaskHost {
  emitHostEvent(sessionId: string, event: AgentEvent): void
  injectTaskNotification(sessionId: string, content: string): Promise<void>
}

let taskHost: BrowserDownloadTaskHost | null = null

/** Wire from main so this module never imports session/MCP (avoids cycles). */
export function setBrowserDownloadTaskHost(host: BrowserDownloadTaskHost | null): void {
  taskHost = host
}

export interface DownloadTaskSnapshot {
  taskId: string
  sessionId: string
  kind: 'url'
  status: DownloadTaskStatus
  backgrounded: boolean
  startedAt: number
  url?: string
  filename?: string
  path?: string
  bytes?: number
  mimeType?: string
  error?: string
}

type Settled =
  | { ok: true; result: DownloadResult }
  | { ok: false; error: string }

interface InternalTask extends DownloadTaskSnapshot {
  done: Promise<Settled>
  resolveDone: (value: Settled) => void
}

const tasks = new Map<string, InternalTask>()

function snapshotOf(t: InternalTask): DownloadTaskSnapshot {
  const { done: _d, resolveDone: _r, ...snap } = t
  return { ...snap }
}

export function getDownloadTask(taskId: string): DownloadTaskSnapshot | null {
  const t = tasks.get(taskId)
  return t ? snapshotOf(t) : null
}

export function hasRunningDownloadTasks(sessionId?: string): boolean {
  for (const t of tasks.values()) {
    if (t.status !== 'running') continue
    if (sessionId && t.sessionId !== sessionId) continue
    return true
  }
  return false
}

function createTask(
  sessionId: string,
  fields: Partial<Pick<DownloadTaskSnapshot, 'url' | 'filename'>>,
): InternalTask {
  let resolveDone!: (value: Settled) => void
  const done = new Promise<Settled>((resolve) => {
    resolveDone = resolve
  })
  const task: InternalTask = {
    taskId: `bdl_${randomUUID().slice(0, 12)}`,
    sessionId,
    kind: 'url',
    status: 'running',
    backgrounded: false,
    startedAt: Date.now(),
    url: fields.url,
    filename: fields.filename,
    done,
    resolveDone,
  }
  tasks.set(task.taskId, task)
  emitHost(sessionId, {
    type: 'task_started',
    taskId: task.taskId,
    description: `Download ${fields.url ?? ''}`,
    taskType: 'browser_download',
  })
  emitHost(sessionId, {
    type: 'browser_download_update',
    taskId: task.taskId,
    status: 'progressing',
    url: fields.url,
    filename: fields.filename,
  })
  return task
}

function settle(task: InternalTask, settled: Settled): void {
  if (task.status !== 'running') return
  if (settled.ok) {
    task.status = 'completed'
    task.path = settled.result.path
    task.filename = settled.result.filename
    task.bytes = settled.result.bytes
    task.mimeType = settled.result.mimeType
  } else {
    task.status = 'failed'
    task.error = settled.error
  }
  task.resolveDone(settled)

  const resultPayload = settled.ok
    ? {
        status: 'completed' as const,
        taskId: task.taskId,
        path: settled.result.path,
        filename: settled.result.filename,
        bytes: settled.result.bytes,
        mimeType: settled.result.mimeType,
        url: task.url,
      }
    : {
        status: 'failed' as const,
        taskId: task.taskId,
        error: settled.error,
        url: task.url,
      }

  emitHost(task.sessionId, {
    type: 'browser_download_update',
    taskId: task.taskId,
    status: settled.ok ? 'completed' : 'failed',
    path: task.path,
    filename: task.filename,
    bytes: task.bytes,
    mimeType: task.mimeType,
    url: task.url,
    error: task.error,
  })

  emitHost(task.sessionId, {
    type: 'task_notification',
    taskId: task.taskId,
    taskStatus: settled.ok ? 'completed' : 'failed',
    outputFile: task.path ?? '',
    summary: settled.ok
      ? `Download ready: ${task.filename ?? task.path}`
      : `Download failed: ${settled.error}`,
    resultText: JSON.stringify(resultPayload),
  })

  if (task.backgrounded) {
    void notifyAgent(task, settled).catch((err) => {
      log.warn('[browser-download-tasks] notify agent failed task=%s: %s', task.taskId, err instanceof Error ? err.message : String(err))
    })
  }
}

function emitHost(sessionId: string, event: AgentEvent): void {
  try {
    taskHost?.emitHostEvent(sessionId, event)
  } catch (err) {
    log.debug('[browser-download-tasks] emitHostEvent failed: %s', err instanceof Error ? err.message : String(err))
  }
}

function formatNotification(task: InternalTask, settled: Settled): string {
  if (settled.ok) {
    const r = settled.result
    return [
      `<task_notification source="browser_download" task_id="${task.taskId}" status="completed">`,
      `path: ${r.path}`,
      `filename: ${r.filename}`,
      `bytes: ${r.bytes}`,
      `mimeType: ${r.mimeType}`,
      task.url ? `url: ${task.url}` : null,
      `</task_notification>`,
    ].filter(Boolean).join('\n')
  }
  return [
    `<task_notification source="browser_download" task_id="${task.taskId}" status="failed">`,
    `error: ${settled.error}`,
    task.url ? `url: ${task.url}` : null,
    `</task_notification>`,
  ].filter(Boolean).join('\n')
}

async function notifyAgent(task: InternalTask, settled: Settled): Promise<void> {
  const content = formatNotification(task, settled)
  if (!taskHost) {
    log.warn('[browser-download-tasks] no task host for notify task=%s sid=%s', task.taskId, task.sessionId)
    return
  }
  await taskHost.injectTaskNotification(task.sessionId, content)
}

export function startUrlDownloadTask(sessionId: string, url: string, filename?: string): DownloadTaskSnapshot {
  const task = createTask(sessionId, { url, filename })
  void downloadUrl(url, filename, (p) => {
    task.filename = p.filename
    task.bytes = p.bytes
    task.mimeType = p.mimeType
    emitHost(sessionId, {
      type: 'browser_download_update',
      taskId: task.taskId,
      status: 'progressing',
      filename: p.filename,
      bytes: p.bytes,
      totalBytes: p.totalBytes ?? undefined,
      mimeType: p.mimeType,
      url,
    })
  })
    .then((result) => settle(task, { ok: true, result }))
    .catch((err) => settle(task, { ok: false, error: err instanceof Error ? err.message : String(err) }))
  return snapshotOf(task)
}

export type RaceResult =
  | { mode: 'sync'; settled: Settled }
  | { mode: 'background'; task: DownloadTaskSnapshot }

export async function raceDownloadTask(taskId: string, timeoutMs: number): Promise<RaceResult> {
  const task = tasks.get(taskId)
  if (!task) throw new Error(`Unknown download task ${taskId}`)
  if (task.status !== 'running') {
    const settled = await task.done
    return { mode: 'sync', settled }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), Math.max(0, timeoutMs))
  })
  const winner = await Promise.race([
    task.done.then(() => 'done' as const),
    timeout,
  ])
  if (timer) clearTimeout(timer)

  if (winner === 'done') {
    return { mode: 'sync', settled: await task.done }
  }

  task.backgrounded = true
  return { mode: 'background', task: snapshotOf(task) }
}

/** Test-only: drop all tasks. */
export function _resetDownloadTasksForTests(): void {
  tasks.clear()
}
