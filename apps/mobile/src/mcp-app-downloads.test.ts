import { describe, expect, it, vi } from 'vitest'
import { parseMcpAppDownloads } from './mcp-apps'
import { resolveNativeRequest, type NativeActionPorts } from './native-actions'

const request = (payload: unknown) => ({ type: 'requestNative' as const, requestId: 'r', action: 'mcpAppDownload', payload })

describe('MCP App downloads in the shell', () => {
  it('accepts items with exactly one source', () => {
    expect(parseMcpAppDownloads({ items: [
      { name: 'part.stl', mimeType: 'model/stl', text: 'solid' },
      { name: 'thumb.png', mimeType: '', base64: 'iVBO' },
      { name: 'q4.pdf', mimeType: 'application/pdf', url: 'https://example.com/q4.pdf' },
    ] })).toEqual([
      { name: 'part.stl', mimeType: 'model/stl', text: 'solid' },
      { name: 'thumb.png', mimeType: 'application/octet-stream', base64: 'iVBO' },
      { name: 'q4.pdf', mimeType: 'application/pdf', url: 'https://example.com/q4.pdf' },
    ])
  })

  it('refuses empty batches, ambiguous items and links the phone must not fetch', () => {
    expect(() => parseMcpAppDownloads({ items: [] })).toThrow()
    expect(() => parseMcpAppDownloads({ items: [{ name: 'a', mimeType: 'text/plain', text: 'a', url: 'https://example.com/a' }] })).toThrow()
    expect(() => parseMcpAppDownloads({ items: [{ name: '', mimeType: 'text/plain', text: 'a' }] })).toThrow()
    expect(() => parseMcpAppDownloads({ items: [{ name: 'a', mimeType: 'text/plain', url: 'file:///etc/passwd' }] })).toThrow()
    expect(() => parseMcpAppDownloads({ items: [{ name: 'a', mimeType: 'text/plain', url: 'https://u:p@example.com/a' }] })).toThrow()
  })

  it('routes the action to the shell port, and fails where the shell has none', async () => {
    const mcpAppDownload = vi.fn(async () => {})
    const items = [{ name: 'part.stl', mimeType: 'model/stl', text: 'solid' }]
    await expect(resolveNativeRequest(request({ items }), { mcpAppDownload } as unknown as NativeActionPorts)).resolves.toMatchObject({ result: { ok: true } })
    expect(mcpAppDownload).toHaveBeenCalledWith(items)
    await expect(resolveNativeRequest(request({ items }), {} as NativeActionPorts)).resolves.toMatchObject({ error: 'Downloads are unavailable' })
  })
})
