import { describe, expect, it, vi } from 'vitest'
import { resolveMarkdownDocumentRequest, type MarkdownDocumentPorts } from './markdown-document-requests'

const DIRECTORY = '/workspace/proj/docs/plans'

function ports(): MarkdownDocumentPorts {
  return {
    openLink: vi.fn(async () => {}),
    previewFile: vi.fn(async () => {}),
    loadImage: vi.fn(async () => ({ dataUri: 'data:image/png;base64,AA==' })),
    loadVideoPoster: vi.fn(async () => null),
    previewImage: vi.fn(async () => {}),
    previewMermaid: vi.fn(async () => {}),
    copyText: vi.fn(async () => {}),
    resolveFavicon: vi.fn(async () => null),
  }
}

function request(action: string, payload?: unknown) {
  return { type: 'requestNative' as const, requestId: 'r1', action, payload }
}

describe('resolveMarkdownDocumentRequest', () => {
  it('loads a relative image from the file folder, not the project root', async () => {
    const host = ports()
    const result = await resolveMarkdownDocumentRequest(request('loadImage', { path: 'diagram.png' }), host, DIRECTORY)
    expect(host.loadImage).toHaveBeenCalledWith('/workspace/proj/docs/plans/diagram.png', false, undefined)
    expect(result).toEqual({ type: 'nativeActionResult', requestId: 'r1', result: { ok: true, dataUri: 'data:image/png;base64,AA==' } })
  })

  it('keeps an absolute image path as written', async () => {
    const host = ports()
    await resolveMarkdownDocumentRequest(request('loadVideoPoster', { path: '/tmp/clip.mp4' }), host, DIRECTORY)
    expect(host.loadVideoPoster).toHaveBeenCalledWith('/tmp/clip.mp4', undefined)
  })

  it('rebases the path a previewed picture carries', async () => {
    const host = ports()
    await resolveMarkdownDocumentRequest(request('previewImage', { src: 'data:image/png;base64,AA==', path: '../shot.png' }), host, DIRECTORY)
    expect(host.previewImage).toHaveBeenCalledWith({ src: 'data:image/png;base64,AA==', path: '/workspace/proj/docs/plans/../shot.png' })
  })

  it('opens a diagram on its own page', async () => {
    const host = ports()
    await resolveMarkdownDocumentRequest(request('previewMermaid', { svg: '<svg><g/></svg>' }), host, DIRECTORY)
    expect(host.previewMermaid).toHaveBeenCalledWith('<svg><g/></svg>')
  })

  it('refuses session actions a file has no business asking for', async () => {
    const result = await resolveMarkdownDocumentRequest(request('setDraft', { text: 'rm -rf /' }), ports(), DIRECTORY)
    expect(result).toEqual({ type: 'nativeActionResult', requestId: 'r1', error: 'setDraft is not available in a file preview' })
  })

  it('answers with an error when the preview has no host ports', async () => {
    const result = await resolveMarkdownDocumentRequest(request('openLink', { url: 'https://example.com' }), undefined, DIRECTORY)
    expect(result.error).toBe('openLink is not available in a file preview')
  })
})
