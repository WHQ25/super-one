import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ async: vi.fn(), fire: vi.fn() }))
vi.mock('./bridge', async (importOriginal) => ({
  ...await importOriginal<typeof import('./bridge')>(),
  requestNativeAsync: native.async,
  requestNative: native.fire,
}))

const { createMcpAppExecutor } = await import('./mcp-app-executor')

const target = { messageId: 'm', appInstanceId: 'view-1' }
const signal = new AbortController().signal
const run = () => createMcpAppExecutor(target, { approve: vi.fn(async () => true) }, (mode) => mode)

beforeEach(() => { native.async.mockReset(); native.fire.mockReset() })

describe('MCP App downloads on the phone', () => {
  it('hands embedded bytes and http links to the shell without a host round-trip', async () => {
    native.async.mockResolvedValue({ ok: true })
    await expect(run().downloadFile!([
      { type: 'resource', resource: { uri: 'file:///part.stl', mimeType: 'model/stl', text: 'solid part' } },
      { type: 'resource', resource: { uri: 'file:///thumb.png', mimeType: 'image/png', blob: 'iVBO' } },
      { type: 'resource_link', uri: 'https://example.com/q4.pdf', name: 'Q4 Report', mimeType: 'application/pdf' },
    ], signal)).resolves.toEqual({})
    expect(native.async).toHaveBeenCalledTimes(1)
    expect(native.async).toHaveBeenCalledWith('mcpAppDownload', { items: [
      { name: 'part.stl', mimeType: 'model/stl', text: 'solid part' },
      { name: 'thumb.png', mimeType: 'image/png', base64: 'iVBO' },
      { name: 'q4.pdf', mimeType: 'application/pdf', url: 'https://example.com/q4.pdf' },
    ] }, expect.any(Number))
  })

  it("reads a link to the View's own server through the host first", async () => {
    native.async
      .mockResolvedValueOnce({ ok: true, response: { ok: true, value: { contents: [{ uri: 'cad://export/parts.csv', mimeType: 'text/csv', text: 'a,b' }] } } })
      .mockResolvedValueOnce({ ok: true })
    await run().downloadFile!([{ type: 'resource_link', uri: 'cad://export/parts.csv', name: 'Parts' }], signal)
    expect(native.async).toHaveBeenNthCalledWith(1, 'mcpApp', { ...target, operation: 'readResource', uri: 'cad://export/parts.csv' }, undefined)
    expect(native.async).toHaveBeenNthCalledWith(2, 'mcpAppDownload', { items: [{ name: 'parts.csv', mimeType: 'text/csv', text: 'a,b' }] }, expect.any(Number))
  })

  it('sends nothing to the shell when a linked read fails', async () => {
    native.async.mockResolvedValueOnce({ ok: true, response: { ok: false, error: { code: 'inactive', message: 'Activate' } } })
    await expect(run().downloadFile!([{ type: 'resource_link', uri: 'cad://export/parts.csv', name: 'Parts' }], signal)).rejects.toMatchObject({ code: 'inactive' })
    expect(native.async).toHaveBeenCalledTimes(1)
  })
})
