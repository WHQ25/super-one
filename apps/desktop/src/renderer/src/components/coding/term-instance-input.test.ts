/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TermInstance } from '@/stores/terminal'
import { forwardTerminalInput, mountTermInstance } from './term-instance'

const write = vi.fn(async () => {})
Object.defineProperty(window, 'terminal', { configurable: true, value: { write } })

/** An instance over a stand-in xterm: `emit` is what xterm sends as data. */
function instance() {
  let emit: (data: string) => void = () => {}
  const xterm = {
    element: undefined as HTMLElement | undefined,
    onData: (cb: (data: string) => void) => { emit = cb },
    open(host: HTMLElement) { this.element = host.appendChild(document.createElement('div')) },
    loadAddon: vi.fn(),
    clearTextureAtlas: vi.fn(),
  }
  const inst = { xterm, writable: true } as unknown as TermInstance
  forwardTerminalInput(inst, 't1')
  mountTermInstance(inst, document.createElement('div'))
  return { inst, element: xterm.element!, emit: (data: string) => emit(data) }
}

afterEach(() => {
  vi.useRealTimers()
  write.mockClear()
})

describe('forwardTerminalInput', () => {
  it("tells the user's input apart from what xterm answers on its own", () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const { element, emit } = instance()
    emit('\x1b[I')
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }))
    emit('l')
    element.dispatchEvent(new Event('paste'))
    emit('pasted')
    vi.advanceTimersByTime(1_000)
    emit('\x1b[?1;2c')
    expect(write.mock.calls).toEqual([
      ['t1', '\x1b[I', false],
      ['t1', 'l', true],
      ['t1', 'pasted', true],
      ['t1', '\x1b[?1;2c', false],
    ])
  })

  it('sends nothing while another client writes', () => {
    const { inst, element, emit } = instance()
    inst.writable = false
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }))
    emit('l')
    expect(write).not.toHaveBeenCalled()
  })
})
