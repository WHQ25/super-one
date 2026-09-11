import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadDesktopFileResponse, RemoteCommand } from '@superone/shared/agent-types'
import { INLINE_IMAGE_MAX_BYTES, loadInlineImage, resetInlineImageCache, type InlineImageHost } from './inline-images'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const FILE: ReadDesktopFileResponse = {
  ok: true, name: 'shot.png', mimeType: 'image/png', size: PNG.length, modifiedAt: 1,
  url: 'http://10.0.0.2:7788/files/x', expiresAt: Date.now() + 60_000,
}

function host(answer: (command: RemoteCommand) => unknown): InlineImageHost & { request: ReturnType<typeof vi.fn>; downloadDesktopFile: ReturnType<typeof vi.fn> } {
  return {
    request: vi.fn(async (command: RemoteCommand) => answer(command)),
    downloadDesktopFile: vi.fn(async () => PNG),
  }
}

const base = { transport: 'lan' as const, projectPath: '/proj', sessionId: 's1', path: '.superone/shot.png', confirmed: false }

beforeEach(() => resetInlineImageCache())

describe('loadInlineImage', () => {
  it('over the LAN downloads straight away and returns a data URI', async () => {
    const h = host(() => FILE)
    const result = await loadInlineImage({ ...base, host: h })
    expect(result).toEqual({ dataUri: 'data:image/png;base64,iVBORw==' })
    const command = h.request.mock.calls[0][0] as Extract<RemoteCommand, { type: 'read_desktop_file' }>
    expect(command).toMatchObject({ type: 'read_desktop_file', path: '/proj/.superone/shot.png', maxBytes: INLINE_IMAGE_MAX_BYTES, sessionId: 's1', preferInline: true })
    expect(command.statOnly).toBeUndefined()
    expect(h.downloadDesktopFile).toHaveBeenCalledWith(FILE)
  })

  it('over the relay paints a small image from the inline RPC payload, without staging', async () => {
    const h = host(() => ({
      ok: true, inline: true, base64: 'iVBORw==', name: 'shot.png', mimeType: 'image/png', size: 4, modifiedAt: 1,
    }))
    const result = await loadInlineImage({ ...base, transport: 'relay', host: h })
    expect(result).toEqual({ dataUri: 'data:image/png;base64,iVBORw==' })
    const command = h.request.mock.calls[0][0] as Extract<RemoteCommand, { type: 'read_desktop_file' }>
    expect(command).toMatchObject({ preferInline: true, statOnly: true })
    expect(h.downloadDesktopFile).not.toHaveBeenCalled()
  })

  it('over the relay asks for confirmation with the size when the file is too big to inline', async () => {
    const h = host(() => ({ ok: true, statOnly: true, name: 'shot.png', mimeType: 'image/png', size: 400_000, modifiedAt: 1 }))
    const result = await loadInlineImage({ ...base, transport: 'relay', host: h })
    expect(result).toEqual({ confirmRequired: true, size: 400_000 })
    const command = h.request.mock.calls[0][0] as Extract<RemoteCommand, { type: 'read_desktop_file' }>
    expect(command.statOnly).toBe(true)
    expect(h.downloadDesktopFile).not.toHaveBeenCalled()
  })

  it('over the relay downloads once confirmed', async () => {
    const h = host(() => ({ ...FILE, encryption: { key: 'k', size: 4 } }))
    const result = await loadInlineImage({ ...base, transport: 'relay', confirmed: true, host: h })
    expect(result).toMatchObject({ dataUri: expect.stringMatching(/^data:image\/png;base64,/) })
    const command = h.request.mock.calls[0][0] as Extract<RemoteCommand, { type: 'read_desktop_file' }>
    expect(command.preferInline).toBe(true)
    expect(command.statOnly).toBeUndefined()
    expect(h.downloadDesktopFile).toHaveBeenCalledTimes(1)
  })

  it('over the relay uses inline bytes on a confirmed request when the host sends them', async () => {
    const h = host(() => ({
      ok: true, inline: true, base64: 'iVBORw==', name: 'shot.png', mimeType: 'image/png', size: 4, modifiedAt: 1,
    }))
    const result = await loadInlineImage({ ...base, transport: 'relay', confirmed: true, host: h })
    expect(result).toEqual({ dataUri: 'data:image/png;base64,iVBORw==' })
    expect(h.downloadDesktopFile).not.toHaveBeenCalled()
  })

  it('serves a repeat request from the cache, even over the relay unconfirmed', async () => {
    const h = host(() => FILE)
    await loadInlineImage({ ...base, host: h })
    const again = await loadInlineImage({ ...base, transport: 'relay', host: h })
    expect(again).toEqual({ dataUri: 'data:image/png;base64,iVBORw==' })
    expect(h.request).toHaveBeenCalledTimes(1)
  })

  it('refuses files that are not images and surfaces desktop errors', async () => {
    const pdf = host(() => ({ ...FILE, name: 'a.pdf', mimeType: 'application/pdf' }))
    await expect(loadInlineImage({ ...base, host: pdf })).rejects.toThrow('not an image')
    expect(pdf.downloadDesktopFile).not.toHaveBeenCalled()
    const denied = host(() => ({ ok: false, error: 'too_large', message: 'file exceeds maxBytes' }))
    await expect(loadInlineImage({ ...base, host: denied })).rejects.toThrow('file exceeds maxBytes')
  })
})
