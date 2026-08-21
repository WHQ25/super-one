import { describe, expect, it } from 'vitest'
import { classifyUpload, finishUpload } from './attachments'

describe('finishUpload', () => {
  it('returns savedPath for inline saves', async () => {
    const path = await finishUpload({
      response: { ok: true, status: 'saved', savedPath: '/tmp/a.png' },
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
      put: async () => { throw new Error('should not PUT') },
      complete: async () => ({ ok: true, savedPath: '/tmp/a.png' }),
    })
    expect(path).toBe('/tmp/a.png')
    expect(classifyUpload({ ok: true, status: 'saved', savedPath: '/tmp/a.png' })).toBe('inline')
  })

  it('PUTs then completes for LAN and R2', async () => {
    const puts: string[] = []
    const lan = await finishUpload({
      response: { ok: true, status: 'need_lan_put', uploadUrl: 'http://lan/put', savedPath: '/tmp/b' },
      bytes: new Uint8Array([9]),
      mimeType: 'text/plain',
      put: async (url) => { puts.push(url) },
      complete: async () => ({ ok: true, savedPath: '/tmp/b' }),
    })
    expect(lan).toBe('/tmp/b')
    expect(puts).toEqual(['http://lan/put'])
    expect(classifyUpload({ ok: true, status: 'need_r2_put', uploadUrl: 'https://r2', key: 'k', savedPath: '/tmp/c' })).toBe('r2')
  })
})
