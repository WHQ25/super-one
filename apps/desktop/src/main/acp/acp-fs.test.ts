import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleReadTextFile, handleWriteTextFile, isPathInsideRoot, sliceLines, resolveAllowedPath } from './acp-fs'

describe('sliceLines', () => {
  it('returns full text without options', () => {
    expect(sliceLines('a\nb\nc')).toBe('a\nb\nc')
  })

  it('slices from 1-based line with limit', () => {
    expect(sliceLines('a\nb\nc\nd', 2, 2)).toBe('b\nc')
  })
})

describe('isPathInsideRoot', () => {
  it('accepts nested paths', () => {
    expect(isPathInsideRoot('/proj/src/a.ts', '/proj')).toBe(true)
  })

  it('rejects escape', () => {
    expect(isPathInsideRoot('/other/a.ts', '/proj')).toBe(false)
    expect(isPathInsideRoot('/proj/../secret', '/proj')).toBe(false)
  })
})

describe('acp-fs handlers', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'acp-fs-'))
    await writeFile(join(root, 'hello.txt'), 'line1\nline2\nline3\n', 'utf8')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads a file inside root', async () => {
    const res = await handleReadTextFile(
      { sessionId: 's', path: join(root, 'hello.txt') },
      { roots: [root] },
    )
    expect(res.content).toBe('line1\nline2\nline3\n')
  })

  it('applies line and limit', async () => {
    const res = await handleReadTextFile(
      { sessionId: 's', path: join(root, 'hello.txt'), line: 2, limit: 1 },
      { roots: [root] },
    )
    expect(res.content).toBe('line2')
  })

  it('prefers unsaved buffer', async () => {
    const path = join(root, 'hello.txt')
    const res = await handleReadTextFile(
      { sessionId: 's', path },
      {
        roots: [root],
        getUnsaved: (p) => (p.endsWith('hello.txt') ? 'unsaved!\n' : null),
      },
    )
    expect(res.content).toBe('unsaved!\n')
  })

  it('rejects path outside roots', async () => {
    await expect(
      handleReadTextFile({ sessionId: 's', path: '/tmp/not-in-root-xyz' }, { roots: [root] }),
    ).rejects.toThrow(/outside allowed/)
  })

  it('writes and creates nested file', async () => {
    const path = join(root, 'nested', 'out.txt')
    await handleWriteTextFile(
      { sessionId: 's', path, content: 'written' },
      { roots: [root] },
    )
    expect(await readFile(path, 'utf8')).toBe('written')
  })

  it('rejects write outside roots', async () => {
    await expect(
      handleWriteTextFile(
        { sessionId: 's', path: join(tmpdir(), 'escape-acp-fs.txt'), content: 'x' },
        { roots: [root] },
      ),
    ).rejects.toThrow(/outside allowed/)
  })

  it('resolveAllowedPath resolves relative to first root', async () => {
    const abs = await resolveAllowedPath('hello.txt', [root], { mustExist: true })
    const expected = await realpath(join(root, 'hello.txt'))
    expect(abs).toBe(expected)
  })
})
