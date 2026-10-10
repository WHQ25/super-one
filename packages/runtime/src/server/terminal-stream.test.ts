import { describe, expect, it } from 'vitest'
import type { TerminalEvent } from '@superone/shared/agent-types'
import { openTerminalStream } from './terminal-stream'

function source() {
  const listeners = new Set<(event: TerminalEvent) => void>()
  return {
    onEvent: (listener: (event: TerminalEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit: (event: TerminalEvent) => { for (const listener of listeners) listener(event) },
    size: () => listeners.size,
  }
}

const output = (terminalId: string): TerminalEvent => ({ type: 'terminal_output', terminalId, data: 'x', fromSeq: 1, toSeq: 1, createdAt: 0 })
const exited = (terminalId: string): TerminalEvent => ({ type: 'terminal_exited', terminalId, exitCode: 0, signal: null })

describe('openTerminalStream', () => {
  it('follows its terminals, the list, a wildcard and topic changes, on its own environment only', () => {
    const src = source()
    const pushed: TerminalEvent[] = []
    const stream = openTerminalStream({
      source: src, environmentId: 'env', push: (e) => pushed.push(e),
      topics: [{ kind: 'terminal', environmentId: 'env', terminalId: 't1' }, { kind: 'terminal', environmentId: 'other', terminalId: 't2' }],
    })
    src.emit(output('t1'))
    src.emit(output('t2'))
    src.emit(exited('t2'))
    expect(pushed).toEqual([output('t1')])

    stream.setTopics([{ kind: 'terminalList', environmentId: 'env' }])
    src.emit(output('t1'))
    src.emit(exited('t2'))
    expect(pushed.slice(1)).toEqual([exited('t2')])

    stream.setTopics([{ kind: 'terminal', environmentId: 'env', terminalId: '*' }])
    src.emit(output('t9'))
    expect(pushed.at(-1)).toEqual(output('t9'))

    stream.close()
    expect(src.size()).toBe(0)
  })
})
