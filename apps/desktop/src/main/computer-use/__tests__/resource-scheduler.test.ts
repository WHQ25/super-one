import { describe, it, expect, beforeEach } from 'vitest'
import { ResourceScheduler } from '../resource-scheduler'

describe('ResourceScheduler', () => {
  let sched: ResourceScheduler

  beforeEach(() => {
    sched = new ResourceScheduler()
  })

  it('starts at epoch 0 and advances on claimWrite', () => {
    expect(sched.epoch('pid:1')).toBe(0)
    expect(sched.claimWrite('pid:1', 0)).toBe(1)
    expect(sched.epoch('pid:1')).toBe(1)
    expect(sched.claimWrite('pid:1', 1)).toBe(2)
  })

  it('rejects stale writes before side effects', () => {
    sched.claimWrite('pid:1', 0)
    expect(() => sched.claimWrite('pid:1', 0)).toThrow(/Stale/)
    try {
      sched.claimWrite('pid:1', 0)
    } catch (e) {
      expect((e as { code: string }).code).toBe('STALE_STATE')
    }
    // Epoch unchanged by failed claim
    expect(sched.epoch('pid:1')).toBe(1)
  })

  it('serializes exclusive runs on the same resource', async () => {
    const order: number[] = []
    const a = sched.runExclusive('pid:1', async () => {
      order.push(1)
      await Promise.resolve()
      order.push(2)
      return 'a'
    })
    const b = sched.runExclusive('pid:1', async () => {
      order.push(3)
      return 'b'
    })
    await expect(Promise.all([a, b])).resolves.toEqual(['a', 'b'])
    expect(order).toEqual([1, 2, 3])
  })

  it('allows concurrent exclusive runs on different resources', async () => {
    let releaseA!: () => void
    const gateA = new Promise<void>((r) => {
      releaseA = r
    })
    const started: string[] = []
    const p1 = sched.runExclusive('pid:1', async () => {
      started.push('a')
      await gateA
      return 1
    })
    const p2 = sched.runExclusive('pid:2', async () => {
      started.push('b')
      return 2
    })
    // p2 should not wait for p1
    await Promise.resolve()
    await Promise.resolve()
    expect(started.sort()).toEqual(['a', 'b'])
    releaseA()
    await expect(Promise.all([p1, p2])).resolves.toEqual([1, 2])
  })
})
