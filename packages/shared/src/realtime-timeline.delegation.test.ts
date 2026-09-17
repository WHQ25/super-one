import { describe, expect, it } from 'vitest'
import { parseRealtimeDelegation, realtimeDelegationText } from './realtime-timeline'

describe('parseRealtimeDelegation', () => {
  it('decodes a handoff with escaped input and a transcript delta', () => {
    const text = [
      '<realtime_delegation>',
      '  <input>Run `bun test` &amp; report &lt;failures&gt;</input>',
      '  <transcript_delta>user: run the tests\nassistant: on it</transcript_delta>',
      '</realtime_delegation>',
    ].join('\n')
    expect(parseRealtimeDelegation(text)).toEqual({
      source: 'handoff',
      input: 'Run `bun test` & report <failures>',
      transcript: [
        { role: 'user', text: 'run the tests' },
        { role: 'assistant', text: 'on it' },
      ],
    })
    expect(realtimeDelegationText(text)).toBe('Run `bun test` & report <failures>')
  })

  it('marks the tail flush Codex sends when the call ends', () => {
    const text = '<realtime_delegation>\n  <source>transcript_tail_flush</source>\n  <input>The user just ended their realtime session.</input>\n  <transcript_delta>assistant: bye</transcript_delta>\n</realtime_delegation>'
    expect(parseRealtimeDelegation(text)).toMatchObject({
      source: 'transcript_tail_flush',
      transcript: [{ role: 'assistant', text: 'bye' }],
    })
  })

  it('treats a bare envelope as its own instruction and ordinary text as none', () => {
    expect(parseRealtimeDelegation('<realtime_delegation>Just do it</realtime_delegation>'))
      .toEqual({ source: 'handoff', input: 'Just do it', transcript: [] })
    expect(parseRealtimeDelegation('Just do it')).toBeNull()
  })
})
