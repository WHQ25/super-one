import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { INLINE_PREVIEW_MAX_BYTES, INLINE_RPC_MAX_BYTES } from '@superone/shared/file-preview'
import { authorizeAndStat, authorizeWriteTarget, FileBridgeError, inferMimeType, canonicalizeRoots, readInlinePreviewText, readInlineRpcBytes, readPreferInline } from './file-bridge'

let workspace: string
let projectRoot: string
let outsidePath: string

beforeAll(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), 'file-bridge-test-')))
  projectRoot = join(workspace, 'project')
  mkdirSync(projectRoot, { recursive: true })
  writeFileSync(join(projectRoot, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(projectRoot, 'big.bin'), Buffer.alloc(64 * 1024, 0xaa))
  writeFileSync(join(projectRoot, '.env'), 'SECRET=1')
  writeFileSync(join(projectRoot, 'cert.pem'), 'pem content')
  writeFileSync(join(projectRoot, 'main.ts'), 'const 中文 = "ok"\n')
  writeFileSync(join(projectRoot, 'fake.txt'), Buffer.from([0x68, 0x69, 0x00, 0x21]))
  writeFileSync(join(projectRoot, 'huge.md'), Buffer.alloc(INLINE_PREVIEW_MAX_BYTES + 1, 0x61))
  writeFileSync(join(projectRoot, 'huge.bin'), Buffer.alloc(INLINE_RPC_MAX_BYTES + 1, 0xab))

  mkdirSync(join(projectRoot, '.ssh'), { recursive: true })
  writeFileSync(join(projectRoot, '.ssh', 'id_rsa'), 'fake key')

  const outsideDir = join(workspace, 'secret')
  mkdirSync(outsideDir, { recursive: true })
  outsidePath = join(outsideDir, 'leak.txt')
  writeFileSync(outsidePath, 'leaked')

  symlinkSync(outsidePath, join(projectRoot, 'leak-link.txt'))
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('inferMimeType', () => {
  it('returns image/png for .png', () => {
    expect(inferMimeType('/x/y.png')).toBe('image/png')
  })
  it('returns application/octet-stream for unknown extension', () => {
    expect(inferMimeType('/x/y.xyz')).toBe('application/octet-stream')
  })
  it('is case-insensitive on extension', () => {
    expect(inferMimeType('/x/y.PNG')).toBe('image/png')
  })
})

describe('authorizeWriteTarget', () => {
  it('resolves a savedPath inside the target dir for a fresh name', async () => {
    const t = await authorizeWriteTarget(projectRoot, 'upload.txt', { allowedRoots: [projectRoot] })
    expect(t.savedPath).toBe(join(realpathSync(projectRoot), 'upload.txt'))
    expect(t.name).toBe('upload.txt')
  })

  it('dedupes the filename when a file already exists', async () => {
    const t = await authorizeWriteTarget(projectRoot, 'image.png', { allowedRoots: [projectRoot] })
    expect(basename(t.savedPath)).toBe('image (1).png')
  })

  it('rejects a target dir outside allowed roots', async () => {
    await expect(authorizeWriteTarget(join(workspace, 'secret'), 'x.txt', { allowedRoots: [projectRoot] }))
      .rejects.toBeInstanceOf(FileBridgeError)
  })

  it('strips path traversal from the file name so it cannot escape the dir', async () => {
    const t = await authorizeWriteTarget(projectRoot, '../../evil.txt', { allowedRoots: [projectRoot] })
    expect(t.savedPath).toBe(join(realpathSync(projectRoot), 'evil.txt'))
  })

  it('rejects blacklisted file names', async () => {
    await expect(authorizeWriteTarget(projectRoot, '.env', { allowedRoots: [projectRoot] }))
      .rejects.toBeInstanceOf(FileBridgeError)
  })

  it('rejects a non-existent target dir', async () => {
    await expect(authorizeWriteTarget(join(projectRoot, 'nope'), 'x.txt', { allowedRoots: [projectRoot] }))
      .rejects.toBeInstanceOf(FileBridgeError)
  })

  it('rejects an empty file name', async () => {
    await expect(authorizeWriteTarget(projectRoot, '   ', { allowedRoots: [projectRoot] }))
      .rejects.toBeInstanceOf(FileBridgeError)
  })
})

describe('canonicalizeRoots', () => {
  it('deduplicates repeated roots', () => {
    expect(canonicalizeRoots(['/x', '/x', '/y'])).toEqual(['/x', '/y'])
  })
  it('drops falsy entries', () => {
    expect(canonicalizeRoots(['', '/a'])).toEqual(['/a'])
  })
  it('resolves real path for symlinked roots when target exists', () => {
    const real = realpathSync(workspace)
    expect(canonicalizeRoots([workspace])).toEqual([real])
  })
})

describe('authorizeAndStat', () => {
  it('allows file inside an allowed root', async () => {
    const result = await authorizeAndStat(join(projectRoot, 'image.png'), {
      allowedRoots: [projectRoot],
    })
    expect(result.mimeType).toBe('image/png')
    expect(result.name).toBe('image.png')
    expect(result.size).toBe(4)
  })

  it('rejects file outside allowed roots', async () => {
    await expect(
      authorizeAndStat(outsidePath, { allowedRoots: [projectRoot] }),
    ).rejects.toBeInstanceOf(FileBridgeError)
    await expect(
      authorizeAndStat(outsidePath, { allowedRoots: [projectRoot] }),
    ).rejects.toMatchObject({ code: 'forbidden_path' })
  })

  it('allows a file outside roots when skipRootCheck is set', async () => {
    const result = await authorizeAndStat(outsidePath, { allowedRoots: [projectRoot] }, { skipRootCheck: true })
    expect(result.name).toBe(basename(outsidePath))
  })

  it('rejects symlink that escapes allowed roots', async () => {
    await expect(
      authorizeAndStat(join(projectRoot, 'leak-link.txt'), { allowedRoots: [projectRoot] }),
    ).rejects.toMatchObject({ code: 'forbidden_path' })
  })

  it('rejects relative path', async () => {
    await expect(
      authorizeAndStat('relative/path.txt', { allowedRoots: [projectRoot] }),
    ).rejects.toMatchObject({ code: 'forbidden_path' })
  })

  it('rejects path traversal via ..', async () => {
    const traversal = join(projectRoot, '..', 'secret', 'leak.txt')
    await expect(
      authorizeAndStat(traversal, { allowedRoots: [projectRoot] }),
    ).rejects.toMatchObject({ code: 'forbidden_path' })
  })

  it('rejects .env files even within allowed roots', async () => {
    await expect(
      authorizeAndStat(join(projectRoot, '.env'), { allowedRoots: [projectRoot] }),
    ).rejects.toMatchObject({ code: 'forbidden_path' })
  })

  it('rejects .pem credential files', async () => {
    await expect(
      authorizeAndStat(join(projectRoot, 'cert.pem'), { allowedRoots: [projectRoot] }),
    ).rejects.toMatchObject({ code: 'forbidden_path' })
  })

  it('rejects files under .ssh path segment', async () => {
    await expect(
      authorizeAndStat(join(projectRoot, '.ssh', 'id_rsa'), { allowedRoots: [projectRoot] }),
    ).rejects.toMatchObject({ code: 'forbidden_path' })
  })

  it('rejects file when size exceeds maxBytes', async () => {
    await expect(
      authorizeAndStat(join(projectRoot, 'big.bin'), { allowedRoots: [projectRoot] }, { maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'too_large' })
  })

  it('returns not_found for missing file', async () => {
    await expect(
      authorizeAndStat(join(projectRoot, 'missing.png'), { allowedRoots: [projectRoot] }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects when no allowed roots provided', async () => {
    await expect(
      authorizeAndStat(join(projectRoot, 'image.png'), { allowedRoots: [] }),
    ).rejects.toMatchObject({ code: 'forbidden_path' })
  })
})

describe('readInlinePreviewText', () => {
  const ctx = { allowedRoots: [] as string[] }
  const opts = { skipRootCheck: true }

  it('returns UTF-8 text for a small source file', async () => {
    const file = await authorizeAndStat(join(projectRoot, 'main.ts'), ctx, opts)
    expect(await readInlinePreviewText(file)).toBe('const 中文 = "ok"\n')
  })

  it('declines a file whose name says text but whose bytes hold a NUL', async () => {
    const file = await authorizeAndStat(join(projectRoot, 'fake.txt'), ctx, opts)
    expect(await readInlinePreviewText(file)).toBeNull()
  })

  it('declines an image without reading it', async () => {
    const file = await authorizeAndStat(join(projectRoot, 'image.png'), ctx, opts)
    expect(await readInlinePreviewText(file)).toBeNull()
  })

  it('declines text past the inline byte limit', async () => {
    const file = await authorizeAndStat(join(projectRoot, 'huge.md'), ctx, opts)
    expect(await readInlinePreviewText(file)).toBeNull()
  })
})

describe('readPreferInline', () => {
  const ctx = { allowedRoots: [] as string[] }
  const opts = { skipRootCheck: true }

  it('returns UTF-8 text on every transport when preferInline is set', async () => {
    const file = await authorizeAndStat(join(projectRoot, 'main.ts'), ctx, opts)
    await expect(readPreferInline(file, { preferInline: true, statOnly: true, transport: 'lan' }))
      .resolves.toEqual({ kind: 'text', text: 'const 中文 = "ok"\n' })
  })

  it('returns small binary bytes over the relay, including on a statOnly+preferInline trip', async () => {
    const file = await authorizeAndStat(join(projectRoot, 'image.png'), ctx, opts)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await expect(readPreferInline(file, { preferInline: true, statOnly: true, transport: 'relay' }))
      .resolves.toEqual({ kind: 'bytes', bytes: png })
    await expect(readPreferInline(file, { preferInline: false, statOnly: false, transport: 'relay' }))
      .resolves.toEqual({ kind: 'bytes', bytes: png })
  })

  it('does not inline binaries over the LAN or past the RPC cap', async () => {
    const png = await authorizeAndStat(join(projectRoot, 'image.png'), ctx, opts)
    await expect(readPreferInline(png, { preferInline: true, statOnly: true, transport: 'lan' }))
      .resolves.toEqual({ kind: 'none' })
    const huge = await authorizeAndStat(join(projectRoot, 'huge.bin'), ctx, { ...opts, maxBytes: INLINE_RPC_MAX_BYTES + 1 })
    await expect(readInlineRpcBytes(huge)).resolves.toBeNull()
    await expect(readPreferInline(huge, { preferInline: true, statOnly: true, transport: 'relay' }))
      .resolves.toEqual({ kind: 'none' })
  })

  it('does not read a small relay binary on a metadata-only request', async () => {
    const file = await authorizeAndStat(join(projectRoot, 'image.png'), ctx, opts)
    await expect(readPreferInline(file, { preferInline: false, statOnly: true, transport: 'relay' }))
      .resolves.toEqual({ kind: 'none' })
  })
})
