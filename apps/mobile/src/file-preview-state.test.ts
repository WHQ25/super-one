import { describe, expect, it } from 'vitest'
import { previewFileName, previewOpensPage, reducePreviewResponse, type FilePreviewState } from './file-preview-state'

const loading: Extract<FilePreviewState, { kind: 'loading' }> = {
  kind: 'loading', path: '/proj/src/App.tsx', name: 'App.tsx', line: 42,
}
const meta = { name: 'App.tsx', size: 1200, modifiedAt: 1, mimeType: 'application/octet-stream' }

describe('file preview routing', () => {
  it('opens the page for text-like names on either transport', () => {
    expect(previewOpensPage('/proj/README.md', 'lan')).toBe(true)
    expect(previewOpensPage('/proj/README.md', 'relay')).toBe(true)
  })

  it('sends a LAN image straight to the receive sheet but gates it behind the page over the relay', () => {
    expect(previewOpensPage('/proj/art/logo.png', 'lan')).toBe(false)
    expect(previewOpensPage('/proj/art/logo.png', 'relay')).toBe(true)
    expect(previewOpensPage('/proj/art/logo.png', null)).toBe(true)
  })

  it('names the file by its last segment on either separator', () => {
    expect(previewFileName('C:\\proj\\main.py')).toBe('main.py')
    expect(previewFileName('/proj/src/App.tsx')).toBe('App.tsx')
  })
})

describe('file preview response reduction', () => {
  it('shows inline text and keeps the cited line', () => {
    const state = reducePreviewResponse(loading, { ok: true, inline: true, text: 'export {}\n', ...meta }, 'relay')
    expect(state).toEqual({
      kind: 'text', path: loading.path, name: 'App.tsx', text: 'export {}\n', size: 1200, markdown: false, line: 42,
    })
  })

  it('renders markdown as prose', () => {
    const md = { ...loading, name: 'guide.md', line: undefined }
    const state = reducePreviewResponse(md, { ok: true, inline: true, text: '# Hi', ...meta, name: 'guide.md' }, 'lan')
    expect(state).toMatchObject({ kind: 'text', markdown: true })
    expect(state).not.toHaveProperty('line')
  })

  it('turns metadata into a transfer that needs confirmation only over the relay', () => {
    const stat = { ok: true as const, statOnly: true as const, ...meta, size: 5_000_000, mimeType: 'image/png' }
    expect(reducePreviewResponse(loading, stat, 'relay')).toMatchObject({ kind: 'transfer', needsConfirm: true, started: false, size: 5_000_000 })
    expect(reducePreviewResponse(loading, stat, 'lan')).toMatchObject({ kind: 'transfer', needsConfirm: false })
  })

  it('surfaces the host error message, falling back to its code', () => {
    expect(reducePreviewResponse(loading, { ok: false, error: 'forbidden_path', message: 'path matches blacklist' }, 'lan'))
      .toMatchObject({ kind: 'error', message: 'path matches blacklist' })
    expect(reducePreviewResponse(loading, { ok: false, error: 'too_large' }, 'lan'))
      .toMatchObject({ kind: 'error', message: 'too_large' })
  })
})
