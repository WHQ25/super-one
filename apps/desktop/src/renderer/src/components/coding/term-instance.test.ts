import { describe, expect, it, vi } from 'vitest'
import type { TermInstance } from '@/stores/terminal'
import { disposeTermInstance } from './term-instance'

const makeInst = (canvas?: { dispose: () => void }): TermInstance =>
  ({ xterm: { dispose: vi.fn() }, canvas }) as unknown as TermInstance

describe('terminal instance teardown on tab close', () => {
  it('still disposes xterm and clears the renderer ref when renderer.dispose throws (teardown crash)', () => {
    const order: string[] = []
    const canvas = {
      dispose: vi.fn(() => {
        order.push('canvas')
        throw new TypeError("Cannot read properties of undefined (reading '_isDisposed')")
      }),
    }
    const inst = makeInst(canvas)
    ;(inst.xterm.dispose as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('xterm'))

    expect(() => disposeTermInstance(inst)).not.toThrow()
    expect(inst.xterm.dispose).toHaveBeenCalledOnce()
    expect(inst.canvas).toBeUndefined()
    expect(order).toEqual(['canvas', 'xterm'])
  })

  it('disposes the renderer before xterm so xterms AddonManager does not double-dispose it', () => {
    const order: string[] = []
    const canvas = { dispose: vi.fn(() => order.push('canvas')) }
    const inst = makeInst(canvas)
    ;(inst.xterm.dispose as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('xterm'))

    disposeTermInstance(inst)

    expect(order).toEqual(['canvas', 'xterm'])
    expect(inst.canvas).toBeUndefined()
  })

  it('disposes xterm without throwing when there is no renderer addon attached', () => {
    const inst = makeInst(undefined)

    expect(() => disposeTermInstance(inst)).not.toThrow()
    expect(inst.xterm.dispose).toHaveBeenCalledOnce()
  })
})
