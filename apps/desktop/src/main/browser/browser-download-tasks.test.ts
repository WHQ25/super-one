import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

vi.mock('./browser-downloads', () => ({
  downloadUrl: vi.fn(),
}))

import { downloadUrl } from './browser-downloads'
import {
  _resetDownloadTasksForTests,
  getDownloadTask,
  hasRunningDownloadTasks,
  raceDownloadTask,
  setBrowserDownloadTaskHost,
  startUrlDownloadTask,
} from './browser-download-tasks'

describe('browser-download-tasks (URL only)', () => {
  const emitHostEvent = vi.fn()
  const injectTaskNotification = vi.fn(async () => {})

  beforeEach(() => {
    vi.clearAllMocks()
    _resetDownloadTasksForTests()
    setBrowserDownloadTaskHost({ emitHostEvent, injectTaskNotification })
  })

  afterEach(() => {
    setBrowserDownloadTaskHost(null)
    _resetDownloadTasksForTests()
  })

  it('returns the file when the download finishes inside the timeout', async () => {
    vi.mocked(downloadUrl).mockResolvedValueOnce({
      path: '/tmp/a.png',
      filename: 'a.png',
      bytes: 10,
      mimeType: 'image/png',
    })

    const snap = startUrlDownloadTask('sess-1', 'https://x.test/a.png')
    const raced = await raceDownloadTask(snap.taskId, 2000)

    expect(raced.mode).toBe('sync')
    if (raced.mode !== 'sync' || !raced.settled.ok) throw new Error('expected sync ok')
    expect(raced.settled.result).toMatchObject({ path: '/tmp/a.png', filename: 'a.png' })
    expect(injectTaskNotification).not.toHaveBeenCalled()
    expect(getDownloadTask(snap.taskId)?.status).toBe('completed')
  })

  it('backgrounds the task after timeout and notifies the agent when it later finishes', async () => {
    let resolveDl!: (v: { path: string; filename: string; bytes: number; mimeType: string }) => void
    vi.mocked(downloadUrl).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDl = resolve
      }),
    )

    const snap = startUrlDownloadTask('sess-1', 'https://x.test/slow.bin')
    expect(hasRunningDownloadTasks('sess-1')).toBe(true)

    const raced = await raceDownloadTask(snap.taskId, 30)
    expect(raced.mode).toBe('background')
    if (raced.mode !== 'background') throw new Error('expected background')
    expect(raced.task.backgrounded).toBe(true)
    expect(injectTaskNotification).not.toHaveBeenCalled()

    resolveDl({ path: '/tmp/slow.bin', filename: 'slow.bin', bytes: 99, mimeType: 'application/octet-stream' })
    await vi.waitFor(() => expect(injectTaskNotification).toHaveBeenCalledTimes(1))

    const content = injectTaskNotification.mock.calls[0][1] as string
    expect(content).toContain('task_id="' + snap.taskId + '"')
    expect(content).toContain('status="completed"')
    expect(content).toContain('/tmp/slow.bin')
    expect(hasRunningDownloadTasks('sess-1')).toBe(false)
  })

  it('emits task lifecycle and browser_download_update events on the host', async () => {
    vi.mocked(downloadUrl).mockResolvedValueOnce({
      path: '/tmp/a.png',
      filename: 'a.png',
      bytes: 1,
      mimeType: 'image/png',
    })
    const snap = startUrlDownloadTask('sess-1', 'https://x.test/a.png')
    await raceDownloadTask(snap.taskId, 2000)
    await vi.waitFor(() => {
      const types = emitHostEvent.mock.calls.map((c) => (c[1] as { type: string }).type)
      expect(types).toContain('task_started')
      expect(types).toContain('task_notification')
      expect(types).toContain('browser_download_update')
    })
    expect(emitHostEvent.mock.calls[0][1]).toMatchObject({ type: 'task_started', taskId: snap.taskId })
    const notif = emitHostEvent.mock.calls.map((c) => c[1]).find((e) => (e as { type: string }).type === 'task_notification')
    expect(notif).toMatchObject({ type: 'task_notification', taskId: snap.taskId, taskStatus: 'completed' })
  })
})
