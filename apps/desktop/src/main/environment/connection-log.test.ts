import { describe, expect, it } from 'vitest'
import { formatConnectionLog } from './connection-log'

describe('formatConnectionLog', () => {
  it('prefixes structured events for greppable main.log lines', () => {
    const line = formatConnectionLog({
      type: 'connect_result',
      connectionId: 'c-1',
      state: 'connected',
      attempt: 1,
      generation: 2,
    })
    expect(line.startsWith('[environment] ')).toBe(true)
    expect(line).toContain('"connectionId":"c-1"')
    expect(line).toContain('"state":"connected"')
  })
})
