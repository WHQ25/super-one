import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SUPERONE_ATTACHMENTS_DIR_NAME,
  buildAttachmentPathNote,
  persistAttachment,
  persistAttachments,
  resolveAttachmentsDir,
  withAttachmentPathNote,
} from './attachment-store'

const dirs: string[] = []
const prevEnv = process.env.SUPERONE_ATTACHMENTS_DIR

afterEach(() => {
  if (prevEnv === undefined) delete process.env.SUPERONE_ATTACHMENTS_DIR
  else process.env.SUPERONE_ATTACHMENTS_DIR = prevEnv
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('attachment-store (unified)', () => {
  it('resolves a single super-one-attachments dir (overrideable)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'so-att-'))
    dirs.push(dir)
    process.env.SUPERONE_ATTACHMENTS_DIR = dir
    expect(resolveAttachmentsDir()).toBe(dir)
    delete process.env.SUPERONE_ATTACHMENTS_DIR
    expect(resolveAttachmentsDir()).toContain(SUPERONE_ATTACHMENTS_DIR_NAME)
    expect(resolveAttachmentsDir()).not.toContain('codex')
  })

  it('persists attachments into the unified dir and builds the desktop note', () => {
    const dir = mkdtempSync(join(tmpdir(), 'so-att-'))
    dirs.push(dir)
    process.env.SUPERONE_ATTACHMENTS_DIR = dir

    const path = persistAttachment(Buffer.from('hello-png').toString('base64'), 'image/png', {
      name: 'shot.png',
    })
    expect(path).toBeTruthy()
    expect(path!.startsWith(dir)).toBe(true)
    expect(readFileSync(path!).toString()).toBe('hello-png')

    const files = persistAttachments([
      { name: 'a.png', mimeType: 'image/png', base64: Buffer.from('a').toString('base64') },
      { name: 'b.pdf', mimeType: 'application/pdf', base64: Buffer.from('b').toString('base64') },
    ])
    expect(files).toHaveLength(2)
    for (const f of files) {
      expect(f.path.startsWith(dir)).toBe(true)
      expect(existsSync(f.path)).toBe(true)
    }

    const note = buildAttachmentPathNote(files)
    expect(note).toContain('The user attached 2 files, saved locally')
    expect(note).toContain('→')
    expect(note).not.toContain('superone-attachments')

    const { text } = withAttachmentPathNote('hi', [
      { mimeType: 'image/png', base64: Buffer.from('x').toString('base64') },
    ])
    expect(text.startsWith('hi')).toBe(true)
    expect(text).toContain('saved locally')
  })
})
