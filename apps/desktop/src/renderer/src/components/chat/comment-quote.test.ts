/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { quoteSegments } from './comment-quote'

describe('quoteSegments', () => {
  it('pulls inline code out of a prose quote', () => {
    expect(quoteSegments('按 `acp-grok` / `AcpRateLimitIcon` 挂载')).toEqual([
      { type: 'text', text: '按 ' },
      { type: 'inline', code: 'acp-grok' },
      { type: 'text', text: ' / ' },
      { type: 'inline', code: 'AcpRateLimitIcon' },
      { type: 'text', text: ' 挂载' },
    ])
  })

  it('keeps a fenced block with its language', () => {
    expect(quoteSegments('before\n```ts\nconst x = 1\n```\nafter')).toEqual([
      { type: 'text', text: 'before\n' },
      { type: 'fence', lang: 'ts', code: 'const x = 1' },
      { type: 'text', text: '\nafter' },
    ])
  })

  it('leaves a quote without code as one text segment', () => {
    expect(quoteSegments('a passage')).toEqual([{ type: 'text', text: 'a passage' }])
  })
})
