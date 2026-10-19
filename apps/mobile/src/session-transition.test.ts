import { describe, expect, it, vi } from 'vitest'
import { SessionTransition, SessionTransitionSupersededError } from './session-transition'

function aborted(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

describe('SessionTransition', () => {
  it('cancels the in-flight restore and runs the newer switch after it unwinds', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const transition = new SessionTransition()
    const seen: string[] = []
    let firstSignal: AbortSignal | null = null

    const running = transition.run(async (signal) => {
      firstSignal = signal
      seen.push('start-a')
      await gate
      if (signal.aborted) throw aborted()
      seen.push('finish-a')
    })
    await vi.waitFor(() => { expect(seen).toEqual(['start-a']) })
    expect(transition.isActive).toBe(true)
    expect(() => transition.assertIdle()).toThrow(SessionTransitionSupersededError)

    const second = transition.run(async () => { seen.push('b') })
    expect(firstSignal?.aborted).toBe(true)
    expect(seen).toEqual(['start-a'])

    release()
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    await second
    expect(seen).toEqual(['start-a', 'b'])
    expect(transition.isActive).toBe(false)
    expect(() => transition.assertIdle()).not.toThrow()
  })

  it('drops a switch that was itself superseded before it started', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const transition = new SessionTransition()
    const seen: string[] = []
    const first = transition.run(async (signal) => {
      seen.push('a')
      await gate
      if (signal.aborted) throw aborted()
    })
    await vi.waitFor(() => { expect(seen).toEqual(['a']) })
    const second = transition.run(async () => { seen.push('b') })
    const third = transition.run(async () => { seen.push('c') })
    release()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await expect(second).rejects.toBeInstanceOf(SessionTransitionSupersededError)
    await third
    expect(seen).toEqual(['a', 'c'])
    expect(transition.isActive).toBe(false)
  })

  it('unlocks after a failed transition', async () => {
    const transition = new SessionTransition()
    await expect(transition.run(async () => { throw new Error('restore failed') })).rejects.toThrow('restore failed')
    expect(transition.isActive).toBe(false)
    expect(() => transition.assertIdle()).not.toThrow()
  })
})
