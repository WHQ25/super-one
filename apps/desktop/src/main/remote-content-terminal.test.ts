import { describe, expect, it } from 'vitest'
import { compactTerminalToolResult } from './remote-content'

describe('compactTerminalToolResult', () => {
  it('keeps the row header and the tail of the screen', () => {
    const screen = Array.from({ length: 40 }, (_, i) => `line ${i}`)
    const summary = JSON.stringify({ status: 'ok', tab: 't1', tabStatus: 'running', foreground: 'bun', command: 'bun run dev', control: 'me', altScreen: false, screen })
    const compact = JSON.parse(compactTerminalToolResult(summary)!)
    expect(compact).toMatchObject({ status: 'ok', tab: 't1', tabStatus: 'running', foreground: 'bun', command: 'bun run dev', control: 'me' })
    expect(compact.altScreen).toBeUndefined()
    expect(compact.screen).toHaveLength(12)
    expect(compact.screen[11]).toBe('line 39')
  })

  it('ignores results that are not terminal replies', () => {
    expect(compactTerminalToolResult(JSON.stringify({ ok: true, path: '/x.png' }))).toBeNull()
    expect(compactTerminalToolResult('count: 2\ntabs[2]{tab,title}:\n t1,a\n t2,b')).toBeNull()
  })
})
