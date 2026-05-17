import { describe, expect, it, vi } from 'vitest'
import type { TermInstance } from '@/stores/terminal'
import { disposeTermInstance } from './term-instance'

const makeInst = (webgl?: { dispose: () => void }): TermInstance =>
  ({ xterm: { dispose: vi.fn() }, webgl }) as unknown as TermInstance

describe('terminal instance teardown on tab close', () => {
  it('still disposes xterm and clears the webgl ref when webgl.dispose throws (context-lost crash)', () => {
    const order: string[] = []
    const webgl = {
      dispose: vi.fn(() => {
        order.push('webgl')
        throw new TypeError("Cannot read properties of undefined (reading '_isDisposed')")
      }),
    }
    const inst = makeInst(webgl)
    ;(inst.xterm.dispose as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('xterm'))

    expect(() => disposeTermInstance(inst)).not.toThrow()
    expect(inst.xterm.dispose).toHaveBeenCalledOnce()
    expect(inst.webgl).toBeUndefined()
    expect(order).toEqual(['webgl', 'xterm'])
  })

  it('disposes webgl before xterm so xterms AddonManager does not double-dispose it', () => {
    const order: string[] = []
    const webgl = { dispose: vi.fn(() => order.push('webgl')) }
    const inst = makeInst(webgl)
    ;(inst.xterm.dispose as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('xterm'))

    disposeTermInstance(inst)

    expect(order).toEqual(['webgl', 'xterm'])
    expect(inst.webgl).toBeUndefined()
  })

  it('disposes xterm without throwing when there is no webgl renderer attached', () => {
    const inst = makeInst(undefined)

    expect(() => disposeTermInstance(inst)).not.toThrow()
    expect(inst.xterm.dispose).toHaveBeenCalledOnce()
  })
})
