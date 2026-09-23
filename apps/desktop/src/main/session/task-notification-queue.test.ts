import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TASK_NOTIFICATION_MAX_ITEMS,
  TaskNotificationFlush,
  TaskNotificationQueue,
  taskNotificationDisplayText,
  taskNotificationRequest,
} from './task-notification-queue'

describe('TaskNotificationQueue', () => {
  it('trims and drops empty payloads', () => {
    const q = new TaskNotificationQueue()
    q.enqueue('  ')
    q.enqueue('')
    expect(q.size).toBe(0)
  })

  it('coalesces consecutive identical payloads', () => {
    const q = new TaskNotificationQueue()
    q.enqueue('wake A')
    q.enqueue('wake A')
    q.enqueue('wake B')
    q.enqueue('wake B')
    q.enqueue('wake A')
    expect(TaskNotificationQueue.join(q.takeAll())).toBe('wake A\n\nwake B\n\nwake A')
    expect(q.size).toBe(0)
  })

  it('caps capacity by dropping oldest items', () => {
    const q = new TaskNotificationQueue(3)
    q.enqueue('a')
    q.enqueue('b')
    q.enqueue('c')
    q.enqueue('d')
    expect([...q.peekAll()]).toEqual(['b', 'c', 'd'])
  })

  it('requeueFront restores a failed batch ahead of mid-flight enqueues', () => {
    const q = new TaskNotificationQueue()
    q.enqueue('a')
    q.enqueue('b')
    const batch = q.takeAll()
    q.enqueue('c') // arrived while send was in flight
    q.requeueFront(batch)
    expect([...q.peekAll()]).toEqual(['a', 'b', 'c'])
  })

  it('requeueFront coalesces across the failure boundary', () => {
    const q = new TaskNotificationQueue()
    q.enqueue('wake')
    const batch = q.takeAll()
    q.enqueue('wake') // same payload enqueued again during failed send
    q.requeueFront(batch)
    expect([...q.peekAll()]).toEqual(['wake'])
  })

  it('requeueFront respects capacity after merge', () => {
    const q = new TaskNotificationQueue(3)
    const batch = ['a', 'b', 'c']
    q.enqueue('d')
    q.requeueFront(batch)
    expect([...q.peekAll()]).toEqual(['b', 'c', 'd'])
    expect(q.size).toBeLessThanOrEqual(TASK_NOTIFICATION_MAX_ITEMS)
  })

  it('taskNotificationRequest marks synthetic source', () => {
    const req = taskNotificationRequest('mailbox ready')
    expect(req.source).toBe('task-notification')
    expect(req.content).toBe('mailbox ready')
    expect(req.clientMessageId).toMatch(/^task-notify-/)
  })

  it('taskNotificationDisplayText strips Grok cron system-reminder framing', () => {
    const framed = [
      '<system-reminder>',
      'This is a scheduled task execution (task task-1, every 5m, recurring).',
      'Execute the prompt below.',
      '</system-reminder>',
      '',
      '/pr-babysit check',
    ].join('\n')
    expect(taskNotificationDisplayText(framed)).toBe('/pr-babysit check')
  })
})

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('TaskNotificationFlush', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('requeues on send failure and retries with backoff', async () => {
    vi.useFakeTimers()
    const q = new TaskNotificationQueue()
    q.enqueue('mailbox ready')

    const send = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined)
    const warn = vi.fn()
    const flush = new TaskNotificationFlush(q, {
      isBusy: () => false,
      isAlive: () => true,
      send,
    }, { logLabel: 'Test', warn, baseDelayMs: 100, maxDelayMs: 1000 })

    flush.flush()
    await settleMicrotasks()
    expect(send).toHaveBeenCalledTimes(1)
    expect(q.size).toBe(1)

    await vi.advanceTimersByTimeAsync(100)
    await settleMicrotasks()
    expect(send).toHaveBeenCalledTimes(2)
    expect(q.size).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('send failed'))
    flush.dispose()
  })

  it('does not requeue when the host dies mid-send', async () => {
    const q = new TaskNotificationQueue()
    q.enqueue('wake')
    let alive = true
    const send = vi.fn().mockImplementation(async () => {
      alive = false
      throw new Error('gone')
    })
    const flush = new TaskNotificationFlush(q, {
      isBusy: () => false,
      isAlive: () => alive,
      send,
    }, { logLabel: 'Test', warn: vi.fn(), baseDelayMs: 10 })

    flush.flush()
    await settleMicrotasks()
    expect(send).toHaveBeenCalledTimes(1)
    // Batch was taken for send; host not alive → no requeue
    expect(q.size).toBe(0)
    flush.dispose()
  })

  it('drops the backlog after maxAttempts failed sends', async () => {
    vi.useFakeTimers()
    const q = new TaskNotificationQueue()
    q.enqueue('wake')
    const send = vi.fn().mockRejectedValue(new Error('still down'))
    const warn = vi.fn()
    const flush = new TaskNotificationFlush(q, {
      isBusy: () => false,
      isAlive: () => true,
      send,
    }, { logLabel: 'Test', warn, maxAttempts: 2, baseDelayMs: 50, maxDelayMs: 50 })

    flush.flush()
    await settleMicrotasks()
    expect(send).toHaveBeenCalledTimes(1)
    expect(q.size).toBe(1)

    await vi.advanceTimersByTimeAsync(50)
    await settleMicrotasks()
    expect(send).toHaveBeenCalledTimes(2)
    // Second failure exhausts maxAttempts=2 → drop without further retry
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropping'))
    expect(q.size).toBe(0)

    await vi.advanceTimersByTimeAsync(200)
    await settleMicrotasks()
    expect(send).toHaveBeenCalledTimes(2)
    flush.dispose()
  })

  it('skips flush while busy and does not take items', () => {
    const q = new TaskNotificationQueue()
    q.enqueue('wake')
    const send = vi.fn()
    const flush = new TaskNotificationFlush(q, {
      isBusy: () => true,
      isAlive: () => true,
      send,
    }, { logLabel: 'Test', warn: vi.fn() })

    flush.flush()
    expect(send).not.toHaveBeenCalled()
    expect(q.size).toBe(1)
    flush.dispose()
  })

  it('dispose cancels retries and clears the queue', async () => {
    vi.useFakeTimers()
    const q = new TaskNotificationQueue()
    q.enqueue('wake')
    const send = vi.fn().mockRejectedValue(new Error('fail'))
    const flush = new TaskNotificationFlush(q, {
      isBusy: () => false,
      isAlive: () => true,
      send,
    }, { logLabel: 'Test', warn: vi.fn(), baseDelayMs: 500 })

    flush.flush()
    await settleMicrotasks()
    expect(send).toHaveBeenCalledTimes(1)
    flush.dispose()
    expect(q.size).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    await settleMicrotasks()
    expect(send).toHaveBeenCalledTimes(1)
  })
})
