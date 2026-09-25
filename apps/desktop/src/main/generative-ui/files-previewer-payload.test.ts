import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FILES_PREVIEWER_MAX_FILES, FILES_PREVIEWER_MAX_NOTE_CHARS } from '@superone/shared/generative-ui/native-widgets'
import { buildFilesPreviewerPayload, resolvePreviewerFile } from './files-previewer-payload'

/**
 * Everything runs against a real temp directory; only the media-server root check is
 * injected, because it reads Electron's `app` for userData.
 */
let root: string
let outside: string
/** macOS hands out `/tmp/...` for a directory whose real path is `/private/tmp/...`. */
const real = (p: string) => realpathSync(p)
const readable = new Set<string>()
const deps = () => ({ root, isReadable: (p: string) => readable.has(p) })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'previewer-root-'))
  outside = mkdtempSync(join(tmpdir(), 'previewer-outside-'))
  readable.clear()
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\n')
  writeFileSync(join(root, 'notes.txt'), 'plain text\n')
  writeFileSync(join(root, 'blob.txt'), Buffer.from([0x41, 0x00, 0x42]))
  writeFileSync(join(root, 'clip.mp4'), 'not really a video')
  writeFileSync(join(root, 'device.usdz'), Buffer.from([0x50, 0x4b, 0x00, 0x00]))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('files-previewer payload — the host decides, the renderer draws', () => {
  it('resolves relative paths against the session root and classifies by name', async () => {
    const { payload } = await buildFilesPreviewerPayload('t', {
      files: [
        { path: 'docs/diagram.png', note: ' the diagram ' },
        { path: 'docs/plan.md' },
        { path: 'notes.txt' },
        { path: 'clip.mp4' },
      ],
    }, deps())
    expect(payload?.root).toBe(root)
    expect(payload?.files?.map((f) => [f.path, f.kind, f.note])).toEqual([
      ['docs/diagram.png', 'image', 'the diagram'],
      ['docs/plan.md', 'markdown', undefined],
      ['notes.txt', 'text', undefined],
      ['clip.mp4', 'video', undefined],
    ])
    expect(payload?.files?.[0].absolutePath).toBe(real(join(root, 'docs/diagram.png')))
    expect(payload?.files?.[0].size).toBe(4)
    expect(payload?.files?.every((f) => !('content' in f))).toBe(true)
  })

  it('keeps a missing file as a row so count and order match what the agent wrote', async () => {
    const { payload } = await buildFilesPreviewerPayload('t', { files: [{ path: 'gone.png' }, { path: 'notes.txt' }] }, deps())
    expect(payload?.files?.map((f) => f.kind)).toEqual(['missing', 'text'])
    expect(payload?.files?.[0].size).toBeUndefined()
  })

  it('keeps a binary USDZ as a model slide', async () => {
    const { payload } = await buildFilesPreviewerPayload('t', { files: [{ path: 'device.usdz' }] }, deps())
    expect(payload?.files?.[0]).toMatchObject({ kind: 'model', size: 4 })
  })

  it('reports a NUL-sniffed .txt as unpreviewable/binary instead of trusting the extension', async () => {
    const { payload } = await buildFilesPreviewerPayload('t', { files: [{ path: 'blob.txt' }] }, deps())
    expect(payload?.files?.[0]).toMatchObject({ kind: 'unpreviewable', reason: 'binary', size: 3 })
  })

  it('rejects a relative path that escapes the root the way readProjectFile does', async () => {
    writeFileSync(join(outside, 'secret.txt'), 'x')
    const escaped = join('..', basename(outside), 'secret.txt')
    const { payload } = await buildFilesPreviewerPayload('t', { files: [{ path: escaped }] }, deps())
    expect(payload?.files?.[0]).toMatchObject({ kind: 'unpreviewable', reason: 'outside_readable_roots' })
  })

  it('accepts an absolute path outside the root only when the media server could serve it', async () => {
    const file = join(outside, 'shot.png')
    writeFileSync(file, 'x')
    const denied = await buildFilesPreviewerPayload('t', { files: [{ path: file }] }, deps())
    expect(denied.payload?.files?.[0]).toMatchObject({ kind: 'unpreviewable', reason: 'outside_readable_roots' })

    readable.add(real(file))
    const allowed = await buildFilesPreviewerPayload('t', { files: [{ path: file }] }, deps())
    expect(allowed.payload?.files?.[0]).toMatchObject({ kind: 'image', size: 1 })
  })

  it('follows a symlink to its real path so a later read and the media roots agree', async () => {
    symlinkSync(join(root, 'docs', 'diagram.png'), join(root, 'link.png'))
    const { payload } = await buildFilesPreviewerPayload('t', { files: [{ path: 'link.png' }] }, deps())
    expect(payload?.files?.[0].absolutePath).toBe(real(join(root, 'docs/diagram.png')))
  })

  it('refuses an empty list, too many files, a blank path and an oversized note before touching the disk', async () => {
    expect((await buildFilesPreviewerPayload('t', { files: [] }, deps())).error).toMatch(/non-empty/)
    expect((await buildFilesPreviewerPayload('t', undefined, deps())).error).toMatch(/non-empty/)
    const many = Array.from({ length: FILES_PREVIEWER_MAX_FILES + 1 }, () => ({ path: 'notes.txt' }))
    expect((await buildFilesPreviewerPayload('t', { files: many }, deps())).error).toMatch(/at most/)
    expect((await buildFilesPreviewerPayload('t', { files: [{ path: '  ' }] }, deps())).error).toMatch(/files\[0\]\.path/)
    const note = 'n'.repeat(FILES_PREVIEWER_MAX_NOTE_CHARS + 1)
    expect((await buildFilesPreviewerPayload('t', { files: [{ path: 'notes.txt', note }] }, deps())).error).toMatch(/files\[0\]\.note/)
  })

  it('re-stats one file on its own, which is what the card asks for after a missing verdict', async () => {
    expect(resolvePreviewerFile({ path: 'later.md' }, deps()).kind).toBe('missing')
    writeFileSync(join(root, 'later.md'), '# now\n')
    expect(resolvePreviewerFile({ path: 'later.md' }, deps())).toMatchObject({ kind: 'markdown', size: 6 })
  })
})
