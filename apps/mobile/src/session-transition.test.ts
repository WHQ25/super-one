import { describe, expect, it, vi } from 'vitest'
import { SessionTransition } from './session-transition'

describe('SessionTransition', () => {
  it('prevents concurrent session restores that share the relay buffer', async () => {
    let finish!: () => void
    const first = new Promise<void>((resolve) => { finish = resolve })
    const transition = new SessionTransition()
    const actionA = vi.fn(() => first)
    const actionB = vi.fn(async () => {})

    const running = transition.run(actionA)
    await Promise.resolve()
    expect(transition.isActive).toBe(true)
    await transition.run(actionB)
    expect(actionB).not.toHaveBeenCalled()

    finish()
    await running
    expect(transition.isActive).toBe(false)
    await transition.run(actionB)
    expect(actionB).toHaveBeenCalledOnce()
  })

  it('unlocks after a failed transition', async () => {
    const transition = new SessionTransition()
    await expect(transition.run(async () => { throw new Error('restore failed') })).rejects.toThrow('restore failed')
    expect(transition.isActive).toBe(false)
  })
})
