import { describe, expect, it } from 'vitest'
import { formatRealtimeDelegation, parseRealtimeDelegation, realtimeDelegationText } from './realtime-timeline'

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

describe('formatRealtimeDelegation', () => {
  it('round-trips a task, a model note, and the spoken lines', () => {
    const text = formatRealtimeDelegation({
      preamble: 'This request came from a voice session. Use a <tag> & stay brief.',
      instruction: 'Run bun test & report <failures>',
      transcript: [
        { role: 'user', text: 'run the tests' },
        { role: 'assistant', text: 'on it' },
      ],
    })
    expect(text).toContain('This request came from a voice session. Use a &lt;tag&gt; &amp; stay brief.')
    expect(parseRealtimeDelegation(text)).toEqual({
      source: 'handoff',
      input: 'Run bun test & report <failures>',
      transcript: [
        { role: 'user', text: 'run the tests' },
        { role: 'assistant', text: 'on it' },
      ],
    })
  })

  it('keeps the newest transcript lines when the delta exceeds 4 KiB', () => {
    const text = formatRealtimeDelegation({
      instruction: 'continue',
      transcript: [
        { role: 'user', text: 'old '.repeat(800) },
        { role: 'assistant', text: 'older '.repeat(800) },
        { role: 'user', text: 'newest line' },
      ],
    })
    const parsed = parseRealtimeDelegation(text)
    expect(parsed?.transcript.at(-1)).toEqual({ role: 'user', text: 'newest line' })
    expect(parsed?.transcript.some((line) => line.text.startsWith('older'))).toBe(false)
    const delta = text.match(/<transcript_delta>([\s\S]*?)<\/transcript_delta>/)?.[1] ?? ''
    expect(delta.length).toBeLessThanOrEqual(4096)
  })

  it('marks a tail flush and leaves the instruction as the bubble text', () => {
    const text = formatRealtimeDelegation({
      source: 'transcript_tail_flush',
      instruction: 'The user just ended their realtime session.',
      transcript: [{ role: 'assistant', text: 'bye' }],
    })
    expect(text).toContain('<source>transcript_tail_flush</source>')
    expect(parseRealtimeDelegation(text)?.source).toBe('transcript_tail_flush')
  })
})
