import { describe, expect, it } from 'vitest'
import { toolResultFromUpdate } from './tool-result-map'

/**
 * The desktop app carries a second copy of this cap. Both must agree on what
 * escapes it: a computer_* payload cut mid-string stops being JSON, and the chat
 * UI can then find neither the outline, nor the state id, nor the app it belongs
 * to. This suite exists because only the desktop copy was covered.
 */
function outline(rows: number): string {
  const header = `outline[${rows}]{ref,depth,role,name,value,x,y,w,h,can,state}:`
  const body = Array.from(
    { length: rows },
    (_, i) => `  @e${i + 1},1,button,Item ${i + 1},"",0,${i * 24},200,24,press,""`,
  )
  return [header, ...body].join('\n')
}

function completed(text: string, extra: Record<string, unknown> = {}) {
  return {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'call-1',
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text } }],
    ...extra,
  } as never
}

const summaryOf = (update: never): string =>
  (toolResultFromUpdate(update) as { summary: string }).summary

describe('tool result capping', () => {
  it('keeps a computer_snapshot payload whole so it still parses', () => {
    const payload = JSON.stringify({
      stateId: 'S1',
      root: { app: 'Kimi', bundleId: 'com.moonshot.kimichat' },
      outline: outline(300),
    })
    expect(payload.length).toBeGreaterThan(4000)
    expect(() => JSON.parse(summaryOf(completed(payload)))).not.toThrow()
  })

  it('keeps a sparse computer_act completion whole, which has no stateId at all', () => {
    // act reports successorStateId / successorRoot. The first version of the
    // shape sniff only looked for stateId / root, so this payload still got cut.
    const payload = JSON.stringify({
      outcome: 'worked',
      successorStateId: 'S4',
      successorRoot: { app: 'Kimi', bundleId: 'com.moonshot.kimichat' },
      evidence: Array.from({ length: 400 }, (_, i) => ({ ref: `@e${i}`, note: 'value changed' })),
    })
    expect(payload.length).toBeGreaterThan(4000)
    expect(() => JSON.parse(summaryOf(completed(payload)))).not.toThrow()
  })

  it('still caps an unrelated oversized result', () => {
    expect(summaryOf(completed(JSON.stringify({ logs: 'x'.repeat(20000) }))).length).toBe(4000)
  })

  it('still caps a workflow result that merely has a state id and a root', () => {
    // The loose first cut of the predicate exempted any {stateId, root:{…}}.
    const payload = JSON.stringify({ stateId: 'S1', root: { rootId: '@r1' }, blob: 'y'.repeat(20000) })
    expect(summaryOf(completed(payload)).length).toBe(4000)
  })
})
