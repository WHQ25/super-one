import { describe, expect, it } from 'vitest'
import {
  INLINE_PREVIEW_MAX_BYTES,
  isInlinePreviewCandidate,
  isInlinePreviewTextName,
  isMarkdownFileName,
  looksBinary,
} from './file-preview'

describe('inline preview policy', () => {
  it('accepts code and prose extensions regardless of case or directory', () => {
    for (const name of ['src/App.tsx', 'README.MD', 'C:\\proj\\main.py', 'theme.css', 'notes.txt', 'Cargo.lock']) {
      expect(isInlinePreviewTextName(name), name).toBe(true)
    }
  })

  it('accepts extension-less files that are text by convention', () => {
    for (const name of ['Makefile', 'Dockerfile', 'LICENSE', '.gitignore', '.npmrc']) {
      expect(isInlinePreviewTextName(name), name).toBe(true)
    }
  })

  it('rejects binaries, media and unknown extensions', () => {
    for (const name of ['photo.png', 'movie.mp4', 'archive.zip', 'lib.so', 'data.bin', 'noext', 'doc.pdf']) {
      expect(isInlinePreviewTextName(name), name).toBe(false)
    }
  })

  it('caps a candidate at the inline byte limit', () => {
    expect(isInlinePreviewCandidate('a.ts', INLINE_PREVIEW_MAX_BYTES)).toBe(true)
    expect(isInlinePreviewCandidate('a.ts', INLINE_PREVIEW_MAX_BYTES + 1)).toBe(false)
    expect(isInlinePreviewCandidate('a.png', 10)).toBe(false)
  })

  it('flags only markdown for the prose renderer', () => {
    expect(isMarkdownFileName('docs/guide.md')).toBe(true)
    expect(isMarkdownFileName('page.MDX')).toBe(true)
    expect(isMarkdownFileName('notes.txt')).toBe(false)
  })

  it('treats a NUL in the sniffed prefix as binary and multibyte UTF-8 as text', () => {
    expect(looksBinary(new TextEncoder().encode('const 中文 = "ok"\n'))).toBe(false)
    expect(looksBinary(new Uint8Array([0x68, 0x69, 0x00, 0x21]))).toBe(true)
    // A NUL past the sniff window is deliberately not inspected.
    const late = new Uint8Array(9 * 1024).fill(0x61)
    late[late.length - 1] = 0
    expect(looksBinary(late)).toBe(false)
  })
})
