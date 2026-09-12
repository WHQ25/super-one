import { afterEach, describe, expect, it, vi } from 'vitest'
import { RECORDING_PAD_MS, recordAction } from './record-action'

type Step = 'start' | 'lead' | 'act' | 'tail' | 'stop'

/** Records the order of events and lets a test fail any one of them. */
function harness(options: {
  failAt?: Step
  rejectValidation?: boolean
} = {}) {
  const steps: Step[] = []
  const controller = new AbortController()
  const delay = async (_ms: number, signal?: AbortSignal) => {
    const step: Step = steps.includes('act') ? 'tail' : 'lead'
    steps.push(step)
    if (options.failAt === step) {
      controller.abort()
      signal?.throwIfAborted()
    }
  }
  const ports = {
    start: async () => { steps.push('start') },
    stop: async () => { steps.push('stop'); return { path: '/tmp/clip.mp4' } },
    act: async (beforeEffects: () => Promise<void>) => {
      if (options.rejectValidation) throw new Error('stale stateId')
      await beforeEffects()
      steps.push('act')
      if (options.failAt === 'act') throw new Error('tap failed')
      return { outcome: 'worked' }
    },
    signal: controller.signal,
    delay,
    padMs: 1000,
  }
  return { steps, ports }
}

describe('recordAction', () => {
  it('pads the batch with a lead-in after the recorder is ready and a tail after it returns', async () => {
    const { steps, ports } = harness()
    const result = await recordAction(ports)
    expect(steps).toEqual(['start', 'lead', 'act', 'tail', 'stop'])
    expect(result.reply).toEqual({ outcome: 'worked' })
    expect(result.capture).toEqual({ path: '/tmp/clip.mp4' })
  })

  it('never starts the recorder when the batch is rejected before any effect', async () => {
    const { steps, ports } = harness({ rejectValidation: true })
    await expect(recordAction(ports)).rejects.toThrow('stale stateId')
    expect(steps).toEqual([])
  })

  it('stops the recorder and rethrows when cancelled during the lead-in', async () => {
    const { steps, ports } = harness({ failAt: 'lead' })
    await expect(recordAction(ports)).rejects.toThrow()
    // No action ran, and the device-side recorder was not left running.
    expect(steps).toEqual(['start', 'lead', 'stop'])
  })

  it('stops the recorder and rethrows when an action fails', async () => {
    const { steps, ports } = harness({ failAt: 'act' })
    await expect(recordAction(ports)).rejects.toThrow('tap failed')
    expect(steps).toEqual(['start', 'lead', 'act', 'stop'])
  })

  it('keeps the finished reply and the clip when cancelled during the tail', async () => {
    // The action is already on the device: reporting ABORTED here would send
    // the agent back to repeat a tap that has already happened.
    const { steps, ports } = harness({ failAt: 'tail' })
    const result = await recordAction(ports)
    expect(steps).toEqual(['start', 'lead', 'act', 'tail', 'stop'])
    expect(result.reply).toEqual({ outcome: 'worked' })
    expect(result.capture).toEqual({ path: '/tmp/clip.mp4' })
  })

  it('returns a validation error reply without ever starting the recorder', async () => {
    // Production `DeviceAgentSession.act` turns a stale stateId into an error
    // reply rather than a throw; `beforeEffects` is simply never called.
    const { steps, ports } = harness()
    const result = await recordAction({
      ...ports,
      act: async () => ({ error: 'STALE_STATE' }),
    })
    expect(steps).toEqual([])
    expect(result).toEqual({ reply: { error: 'STALE_STATE' }, capture: undefined })
  })

  describe('with the real delay', () => {
    afterEach(() => { vi.useRealTimers() })

    it('holds one second before the first action and one second after the batch, by default', async () => {
      vi.useFakeTimers()
      const timeline: Array<[string, number]> = []
      const start = Date.now()
      const stamp = (step: string) => timeline.push([step, Date.now() - start])
      const run = recordAction({
        start: async () => { stamp('start') },
        stop: async () => { stamp('stop'); return { path: '/tmp/clip.mp4' } },
        act: async (beforeEffects) => { await beforeEffects(); stamp('act'); return { outcome: 'worked' } },
      })
      await vi.advanceTimersByTimeAsync(RECORDING_PAD_MS * 2)
      await run
      expect(RECORDING_PAD_MS).toBe(1000)
      expect(timeline).toEqual([['start', 0], ['act', 1000], ['stop', 2000]])
    })
  })
})
