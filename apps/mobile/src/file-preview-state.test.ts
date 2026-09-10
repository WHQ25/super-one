import { describe, expect, it } from 'vitest'
import {
  completeTransfer,
  describeSaveOutcome,
  filePreviewMenu,
  formatFileSize,
  imagePreviewState,
  previewFileName,
  previewLocalSource,
  reducePreviewResponse,
  safeCacheFileName,
  type FilePreviewState,
} from './file-preview-state'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

const loading: Extract<FilePreviewState, { kind: 'loading' }> = {
  kind: 'loading', path: '/proj/src/App.tsx', name: 'App.tsx', line: 42,
}
const meta = { name: 'App.tsx', size: 1200, modifiedAt: 1, mimeType: 'application/octet-stream' }

describe('file preview naming', () => {
  it('names the file by its last segment on either separator', () => {
    expect(previewFileName('C:\\proj\\main.py')).toBe('main.py')
    expect(previewFileName('/proj/src/App.tsx')).toBe('App.tsx')
  })

  it('confines downloaded names to one cache file', () => {
    expect(safeCacheFileName('share:123', '../../private/report.pdf')).toBe('share123-report.pdf')
    expect(safeCacheFileName('', '..')).toBe('received-file')
    expect(safeCacheFileName('s', 'folder\\notes.txt')).toBe('s-notes.txt')
  })

  it('formats byte sizes for the transfer card', () => {
    expect(formatFileSize(12)).toBe('12 B')
    expect(formatFileSize(1_536)).toBe('1.5 KB')
    expect(formatFileSize(2 * 1_024 * 1_024)).toBe('2.0 MB')
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

  it('turns metadata into an idle transfer that needs confirmation only over the relay', () => {
    const stat = { ok: true as const, statOnly: true as const, ...meta, size: 5_000_000, mimeType: 'image/png' }
    expect(reducePreviewResponse(loading, stat, 'relay')).toMatchObject({ kind: 'transfer', needsConfirm: true, phase: 'idle', size: 5_000_000 })
    expect(reducePreviewResponse(loading, stat, 'lan')).toMatchObject({ kind: 'transfer', needsConfirm: false })
  })

  it('surfaces the host error message, falling back to its code', () => {
    expect(reducePreviewResponse(loading, { ok: false, error: 'forbidden_path', message: 'path matches blacklist' }, 'lan'))
      .toMatchObject({ kind: 'error', message: 'path matches blacklist' })
    expect(reducePreviewResponse(loading, { ok: false, error: 'too_large' }, 'lan'))
      .toMatchObject({ kind: 'error', message: 'too_large' })
  })
})

describe('transfer completion', () => {
  const image: Extract<FilePreviewState, { kind: 'transfer' }> = {
    kind: 'transfer', path: '/proj/art/hero.png', name: 'hero.png', size: 10, mimeType: 'image/png', needsConfirm: true, phase: 'downloading',
  }

  it('turns a downloaded picture into the image body over its cache file', () => {
    expect(completeTransfer(image, 'file:///cache/hero.png')).toEqual({
      kind: 'image', path: '/proj/art/hero.png', name: 'hero.png', src: 'file:///cache/hero.png', mimeType: 'image/png',
    })
  })

  it('keeps any other file on the transfer card with its bytes attached', () => {
    const pdf = { ...image, name: 'spec.pdf', mimeType: 'application/pdf' }
    expect(completeTransfer(pdf, 'file:///cache/spec.pdf')).toMatchObject({ kind: 'transfer', phase: 'ready', localUri: 'file:///cache/spec.pdf' })
  })
})

describe('image preview state', () => {
  it('reads the mime type off a data URI and names the copy after the desktop path', () => {
    expect(imagePreviewState({ src: PNG, label: 'Screenshot', path: '/shots/a.png' }))
      .toEqual({ kind: 'image', path: '/shots/a.png', name: 'a.png', label: 'Screenshot', src: PNG, mimeType: 'image/png' })
  })

  it('guesses the type of a URL picture from its name and leaves the title to the label', () => {
    expect(imagePreviewState({ src: 'https://x/y.jpg', label: 'y.jpg' })).toMatchObject({ name: 'y.jpg', mimeType: 'image/jpeg' })
    expect(imagePreviewState({ src: 'https://x/y' })).toMatchObject({ name: 'image.img', mimeType: 'image/*' })
  })
})

describe('the more menu', () => {
  it('offers nothing while nothing is on the phone', () => {
    expect(filePreviewMenu(null)).toEqual({ save: { enabled: false, toPhotos: false }, share: { enabled: false } })
    expect(filePreviewMenu(loading).save.enabled).toBe(false)
    expect(filePreviewMenu({ kind: 'error', path: '/p', name: 'p', message: 'x' }).share.enabled).toBe(false)
    expect(filePreviewMenu({ kind: 'transfer', path: '/p', name: 'p', size: 1, mimeType: 'application/pdf', needsConfirm: true, phase: 'idle' }).save.enabled).toBe(false)
  })

  it('saves pictures to Photos, whether inline or downloaded, but not by URL', () => {
    expect(filePreviewMenu({ kind: 'image', name: 'a.png', src: PNG, mimeType: 'image/png' })).toEqual({ save: { enabled: true, toPhotos: true }, share: { enabled: true } })
    expect(filePreviewMenu({ kind: 'image', name: 'a.png', src: 'file:///c/a.png', mimeType: 'image/png' }).save).toEqual({ enabled: true, toPhotos: true })
    expect(filePreviewMenu({ kind: 'image', name: 'a.png', src: 'https://x/a.png', mimeType: 'image/png' })).toEqual({ save: { enabled: false, toPhotos: true }, share: { enabled: false } })
  })

  it('saves text and finished transfers to a folder', () => {
    const text: FilePreviewState = { kind: 'text', path: '/p/a.md', name: 'a.md', text: '# a', size: 3, markdown: true }
    expect(filePreviewMenu(text)).toEqual({ save: { enabled: true, toPhotos: false }, share: { enabled: true } })
    expect(previewLocalSource(text)).toEqual({ kind: 'text', text: '# a', name: 'a.md', mimeType: 'text/markdown' })
    const ready: FilePreviewState = { kind: 'transfer', path: '/p/s.pdf', name: 's.pdf', size: 1, mimeType: 'application/pdf', needsConfirm: false, phase: 'ready', localUri: 'file:///c/s.pdf' }
    expect(previewLocalSource(ready)).toEqual({ kind: 'file', uri: 'file:///c/s.pdf', name: 's.pdf', mimeType: 'application/pdf' })
  })
})

describe('save outcomes', () => {
  it('says where the copy went, offers Settings on a denial, and stays quiet on cancel', () => {
    expect(describeSaveOutcome({ kind: 'saved', toPhotos: true })).toEqual({ message: 'Saved to Photos', offerSettings: false })
    expect(describeSaveOutcome({ kind: 'saved', toPhotos: false })).toEqual({ message: 'Saved', offerSettings: false })
    expect(describeSaveOutcome({ kind: 'denied' })?.offerSettings).toBe(true)
    expect(describeSaveOutcome({ kind: 'cancelled' })).toBeNull()
  })
})
