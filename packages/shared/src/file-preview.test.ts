import { describe, expect, it } from 'vitest'
import {
  INLINE_PREVIEW_MAX_BYTES,
  INLINE_RPC_MAX_BYTES,
  MODEL_EXTENSIONS,
  fileKindFromName,
  isInlinePreviewCandidate,
  isInlinePreviewTextName,
  isInlineRpcCandidate,
  isMarkdownFileName,
  isVideoFileName,
  looksBinary,
  shouldInlineRpcBytes,
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
    for (const name of ['photo.png', 'movie.mp4', 'archive.zip', 'lib.so', 'data.bin', 'noext', 'doc.pdf', 'device.usdz']) {
      expect(isInlinePreviewTextName(name), name).toBe(false)
    }
  })

  it('classifies every supported 3D extension as a model', () => {
    expect(MODEL_EXTENSIONS.size).toBe(11)
    for (const ext of MODEL_EXTENSIONS) expect(fileKindFromName(`assets/Device${ext.toUpperCase()}`)).toBe('model')
  })

  it('caps a candidate at the inline byte limit', () => {
    expect(INLINE_RPC_MAX_BYTES).toBe(512 * 1024)
    expect(INLINE_PREVIEW_MAX_BYTES).toBe(INLINE_RPC_MAX_BYTES)
    expect(isInlinePreviewCandidate('a.ts', INLINE_PREVIEW_MAX_BYTES)).toBe(true)
    expect(isInlinePreviewCandidate('a.ts', INLINE_PREVIEW_MAX_BYTES + 1)).toBe(false)
    expect(isInlinePreviewCandidate('a.png', 10)).toBe(false)
  })

  it('inlines small binaries over the relay and never over the LAN', () => {
    expect(isInlineRpcCandidate(0)).toBe(true)
    expect(isInlineRpcCandidate(INLINE_RPC_MAX_BYTES)).toBe(true)
    expect(isInlineRpcCandidate(INLINE_RPC_MAX_BYTES + 1)).toBe(false)
    expect(shouldInlineRpcBytes('relay', 20_480)).toBe(true)
    expect(shouldInlineRpcBytes(undefined, 20_480)).toBe(true)
    expect(shouldInlineRpcBytes('lan', 20_480)).toBe(false)
    expect(shouldInlineRpcBytes('relay', INLINE_RPC_MAX_BYTES + 1)).toBe(false)
  })

  it('flags only markdown for the prose renderer', () => {
    expect(isMarkdownFileName('docs/guide.md')).toBe(true)
    expect(isMarkdownFileName('page.MDX')).toBe(true)
    expect(isMarkdownFileName('notes.txt')).toBe(false)
  })

  it('names the video containers both chat surfaces preview', () => {
    expect(isVideoFileName('/proj/out/clip.mp4')).toBe(true)
    expect(isVideoFileName('walkthrough.MOV')).toBe(true)
    expect(isVideoFileName('C:\\media\\take.webm')).toBe(true)
    expect(isVideoFileName('poster.png')).toBe(false)
    expect(isVideoFileName('notes.mp4.txt')).toBe(false)
    expect(isVideoFileName('mp4')).toBe(false)
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
