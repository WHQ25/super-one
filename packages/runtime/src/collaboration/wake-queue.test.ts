import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openNodeDatabase, type NodeDatabase } from '../db/database'
import { CollaborationWakeQueue } from './wake-queue'

describe('durable collaboration notification delivery', () => {
  let db: NodeDatabase
  const queues: CollaborationWakeQueue[] = []
  const makeQueue = (admit = vi.fn(async (..._args: unknown[]) => {}), canAdmit?: (sessionId: string) => boolean) => {
    const queue = new CollaborationWakeQueue(db, { admit, canAdmit, warn: vi.fn() })
    queues.push(queue)
    return { queue, admit }
  }
  const row = () => db.prepare('SELECT * FROM collaboration_wakes').get() as { state: string; attempts: number; content: string; last_error: string | null }
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

  beforeEach(() => { vi.useFakeTimers(); db = openNodeDatabase(':memory:') })
  afterEach(() => { for (const queue of queues.splice(0)) queue.dispose(); db.close(); vi.useRealTimers() })

  it('acknowledges durable enqueue without waiting for the recipient to be available', async () => {
    const { queue, admit } = makeQueue(undefined, () => false)
    queue.enqueue('parent', 'stop:child:1', 'child stopped')
    expect(row()).toMatchObject({ state: 'queued', attempts: 0, content: 'child stopped' })
    await settle()
    expect(admit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(admit).not.toHaveBeenCalled()
  })

  it('delivers a queued notification once after a restart and preserves its stable id', async () => {
    const first = makeQueue(undefined, () => false)
    first.queue.enqueue('parent', 'stop:child:1', 'child stopped')
    first.queue.dispose()
    const restarted = makeQueue()
    restarted.queue.start()
    await settle()
    expect(restarted.admit).toHaveBeenCalledExactlyOnceWith('parent', 'child stopped', 'stop:child:1', expect.any(Function), expect.any(Function))
    expect(row().state).toBe('admitted')
    restarted.queue.dispose()
    const again = makeQueue()
    again.queue.enqueue('parent', 'stop:child:1', 'child stopped')
    await settle()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(again.admit).not.toHaveBeenCalled()
  })

  it('records a confirmed admission that arrives during graceful shutdown', async () => {
    let accept!: () => void
    const first = makeQueue(vi.fn((...args: unknown[]) => new Promise<void>((resolve) => {
      accept = () => { (args[3] as (() => void) | undefined)?.(); resolve() }
    })))
    first.queue.enqueue('parent', 'message:1', 'mailbox ready')
    await settle()
    first.queue.dispose()
    accept()
    await settle()
    expect(row().state).toBe('admitted')
    const restarted = makeQueue()
    restarted.queue.start()
    await settle()
    expect(restarted.admit).not.toHaveBeenCalled()
  })

  it('recovers interrupted preparation without treating it as an ambiguous handoff', async () => {
    const first = makeQueue(vi.fn(() => new Promise<void>(() => {})))
    first.queue.enqueue('parent', 'message:1', 'mailbox ready')
    await settle()
    first.queue.dispose()
    const restarted = makeQueue()
    expect(row()).toMatchObject({ state: 'queued', attempts: 1, content: 'mailbox ready' })
    restarted.queue.start()
    await settle()
    expect(row()).toMatchObject({ state: 'admitted', attempts: 2 })
    expect(restarted.admit).toHaveBeenCalledTimes(1)
  })

  it('does not spend the last attempt on preparation rejected during graceful shutdown', async () => {
    let reject!: (error: Error) => void
    const admit = vi.fn(async (): Promise<void> => { throw new Error('unavailable') })
    const first = makeQueue(admit)
    first.queue.enqueue('parent', 'message:1', 'mailbox ready')
    await settle()
    await vi.advanceTimersByTimeAsync(10_000)
    admit.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    await vi.advanceTimersByTimeAsync(30_000)
    first.queue.dispose()
    reject(new Error('unavailable'))
    await settle()
    expect(row()).toMatchObject({ attempts: 2, state: 'queued' })
    const restarted = makeQueue()
    restarted.queue.start()
    await settle()
    expect(restarted.admit).toHaveBeenCalledTimes(1)
    expect(row()).toMatchObject({ attempts: 3, state: 'admitted' })
  })

  it('preserves an ambiguous handoff when its final receipt cannot be persisted', async () => {
    const prepare = db.prepare.bind(db)
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      if (sql.includes("SET state = 'admitted'")) throw new Error('receipt write failed')
      return prepare(sql)
    })
    const first = makeQueue(vi.fn(async (...args: unknown[]) => { (args[3] as () => void)() }))
    first.queue.enqueue('parent', 'message:1', 'mailbox ready')
    await settle()
    spy.mockRestore()
    first.queue.dispose()
    const restarted = makeQueue()
    restarted.queue.start()
    await settle()
    expect(row()).toMatchObject({ state: 'uncertain', content: 'mailbox ready' })
    expect(restarted.admit).not.toHaveBeenCalled()
  })

  it.each(['rate limited', 'authentication failed', 'session unavailable', 'worktree removed', 'remote offline'])(
    'stops after three admission failures for %s, including after restart', async (message) => {
      const admit = vi.fn(async (..._args: unknown[]) => { throw new Error(message) })
      const first = makeQueue(admit)
      first.queue.enqueue('parent', 'stop:child:1', 'child stopped')
      await settle()
      expect(row()).toMatchObject({ attempts: 1, state: 'queued', last_error: message })
      first.queue.dispose()
      const restarted = makeQueue(admit)
      restarted.queue.start()
      await settle()
      expect(admit).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(admit).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(admit).toHaveBeenCalledTimes(3)
      expect(row()).toMatchObject({ attempts: 3, state: 'failed', content: 'child stopped' })
      restarted.queue.dispose()
      const exhausted = makeQueue(admit)
      exhausted.queue.enqueue('parent', 'stop:child:1', 'child stopped')
      exhausted.queue.enqueue('parent', 'message:new', 'new mail must not reset the budget')
      await settle()
      await vi.advanceTimersByTimeAsync(3_600_000)
      expect(admit).toHaveBeenCalledTimes(3)
    },
  )

  it('deduplicates concurrent notifications and does not retry an admitted wake without a read receipt', async () => {
    let accepted!: () => void
    const admit = vi.fn(() => new Promise<void>((resolve) => { accepted = resolve }))
    const { queue } = makeQueue(admit)
    queue.enqueue('parent', 'message:1', 'mailbox ready')
    queue.enqueue('parent', 'message:1', 'mailbox ready')
    await settle()
    queue.enqueue('parent', 'message:1', 'mailbox ready')
    await settle()
    expect(admit).toHaveBeenCalledTimes(1)
    accepted()
    await settle()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(row().state).toBe('admitted')
    expect(admit).toHaveBeenCalledTimes(1)
  })

  it('keeps all queued notifications instead of dropping the oldest on overflow', async () => {
    let ready = false
    const { queue, admit } = makeQueue(undefined, () => ready)
    for (let i = 0; i < 40; i++) queue.enqueue('parent', `message:${i}`, `mailbox ${i}`)
    await settle()
    expect((db.prepare('SELECT COUNT(*) AS n FROM collaboration_wakes').get() as { n: number }).n).toBe(40)
    ready = true
    queue.start()
    await settle()
    await vi.waitFor(() => expect(admit).toHaveBeenCalledTimes(40))
    expect(admit.mock.calls[0]).toEqual(['parent', 'mailbox 0', 'message:0', expect.any(Function), expect.any(Function)])
  })

  it.each(['message_error', 'message_interrupted'] as const)('keeps the recipient paused across restart and new messages after %s', async (type) => {
    const first = makeQueue()
    first.queue.observe('parent', type === 'message_error'
      ? { type, messageId: 'm1', error: 'authentication failed' }
      : { type, messageId: 'm1' })
    first.queue.enqueue('parent', 'message:1', 'mailbox 1')
    await settle()
    expect(first.admit).not.toHaveBeenCalled()
    first.queue.dispose()
    const restarted = makeQueue()
    restarted.queue.enqueue('parent', 'message:2', 'mailbox 2')
    restarted.queue.observe('parent', { type: 'status_change', status: 'idle' })
    await settle()
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(restarted.admit).not.toHaveBeenCalled()
    restarted.queue.observe('parent', { type: 'message_complete', messageId: 'manual-recovery' })
    await settle()
    expect(restarted.admit).toHaveBeenCalledTimes(2)
  })

  it('does not turn a machine restart into a human pause', async () => {
    const { queue, admit } = makeQueue()
    queue.observe('child', { type: 'message_interrupted', messageId: 'm1', reason: 'node_restart' })
    queue.enqueue('child', 'message:1', 'continue after restart')
    await settle()
    expect(admit).toHaveBeenCalledTimes(1)
  })

  it('does not clear an existing human pause when the machine restarts', async () => {
    const { queue, admit } = makeQueue()
    queue.observe('child', { type: 'message_interrupted', messageId: 'm1', reason: 'client_interrupt' })
    queue.observe('child', { type: 'message_interrupted', messageId: 'm1', reason: 'node_restart' })
    queue.enqueue('child', 'message:1', 'still stopped by the user')
    await settle()
    expect(admit).not.toHaveBeenCalled()
  })
})
