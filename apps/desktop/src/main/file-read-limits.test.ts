import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  MAX_NOTEBOOK_BYTES,
  MAX_TEXT_FILE_BYTES,
  detectTextOrBinary,
  maxReadableBytes,
} from './file-read-limits'

describe('readable size limits by extension', () => {
  it('gives notebooks a larger budget than ordinary text files', () => {
    expect(maxReadableBytes('.ipynb')).toBe(MAX_NOTEBOOK_BYTES)
    expect(MAX_NOTEBOOK_BYTES).toBeGreaterThan(MAX_TEXT_FILE_BYTES)
  })

  it('matches the extension case-insensitively', () => {
    expect(maxReadableBytes('.IPYNB')).toBe(MAX_NOTEBOOK_BYTES)
  })

  it('falls back to the text budget for every other extension', () => {
    expect(maxReadableBytes('.ts')).toBe(MAX_TEXT_FILE_BYTES)
    expect(maxReadableBytes('')).toBe(MAX_TEXT_FILE_BYTES)
  })
})

describe('text or binary detection', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'file-read-limits-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function write(name: string, data: string | Buffer): Promise<string> {
    const p = join(dir, name)
    await writeFile(p, data)
    return p
  }

  it('treats an empty file as text without sniffing it', async () => {
    expect(await detectTextOrBinary(await write('empty.txt', ''), MAX_TEXT_FILE_BYTES)).toBe('text')
  })

  it('reports plain text as text', async () => {
    expect(await detectTextOrBinary(await write('a.txt', 'hello\n'), MAX_TEXT_FILE_BYTES)).toBe('text')
  })

  it('reports a file containing a NUL byte as binary', async () => {
    const p = await write('a.bin', Buffer.from([0x68, 0x00, 0x69]))
    expect(await detectTextOrBinary(p, MAX_TEXT_FILE_BYTES)).toBe('binary')
  })

  it('reports too-large only past the caller-supplied budget', async () => {
    const p = await write('b.txt', 'x'.repeat(64))
    expect(await detectTextOrBinary(p, 32)).toBe('too-large')
    expect(await detectTextOrBinary(p, 64)).toBe('text')
  })

  it('still previews a notebook that exceeds the ordinary text budget', async () => {
    const p = await write('big.ipynb', 'x'.repeat(64))
    expect(await detectTextOrBinary(p, maxReadableBytes('.txt'))).toBe('text')
    // The real regression: a budget that would reject it as text accepts it as a notebook.
    expect(await detectTextOrBinary(p, 32)).toBe('too-large')
    expect(await detectTextOrBinary(p, maxReadableBytes('.ipynb'))).toBe('text')
  })
})
