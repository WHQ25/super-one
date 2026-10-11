import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

import { decodeHtml } from './favicon'

describe('decodeHtml', () => {
  // "中文" in GBK.
  const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])

  it('decodes with the charset from the header', () => {
    expect(decodeHtml(gbk, 'text/html; charset=GBK')).toBe('中文')
  })

  it('decodes with the charset from a meta tag', () => {
    const head = new TextEncoder().encode('<meta charset="gbk"><title>')
    const bytes = new Uint8Array([...head, ...gbk])
    expect(decodeHtml(bytes, 'text/html')).toBe('<meta charset="gbk"><title>中文')
  })

  it('falls back to UTF-8 for an unknown charset', () => {
    expect(decodeHtml(new TextEncoder().encode('ok'), 'text/html; charset=bogus')).toBe('ok')
  })
})
