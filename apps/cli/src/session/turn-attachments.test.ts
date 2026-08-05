import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SUPERONE_ATTACHMENTS_DIR_NAME } from '@superone/shared/attachment-store'
import { persistTurnAttachments, withAttachmentNote } from './turn-attachments'

const dirs: string[] = []
const prev = process.env.SUPERONE_ATTACHMENTS_DIR

afterEach(() => {
  if (prev === undefined) delete process.env.SUPERONE_ATTACHMENTS_DIR
  else process.env.SUPERONE_ATTACHMENTS_DIR = prev
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('turn attachments (unified store)', () => {
  it('writes into SUPERONE_ATTACHMENTS_DIR, not project cwd', () => {
    const store = mkdtempSync(join(tmpdir(), 'so-att-cli-'))
    const projectCwd = mkdtempSync(join(tmpdir(), 'so-proj-'))
    dirs.push(store, projectCwd)
    process.env.SUPERONE_ATTACHMENTS_DIR = store

    const { note, paths } = persistTurnAttachments(projectCwd, [
      {
        name: 'shot.png',
        mimeType: 'image/png',
        base64: Buffer.from('png-bytes').toString('base64'),
      },
    ])
    expect(paths).toHaveLength(1)
    expect(paths[0]!.startsWith(store)).toBe(true)
    expect(existsSync(join(projectCwd, '.superone', 'attachments'))).toBe(false)
    expect(note).toContain('saved locally')
    expect(note).toContain(paths[0]!)

    const text = withAttachmentNote('hello', projectCwd, [
      { mimeType: 'image/png', base64: Buffer.from('x').toString('base64') },
    ])
    expect(text).toContain('hello')
    expect(text).toContain('saved locally')
    expect(text).not.toContain('superone-attachments')
    expect(SUPERONE_ATTACHMENTS_DIR_NAME).toBe('super-one-attachments')
  })
})
