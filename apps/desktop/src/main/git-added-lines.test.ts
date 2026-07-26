import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addedLinesReadCount, countAddedLines, resetAddedLinesCache } from './git-added-lines'

const trash: string[] = []

beforeEach(() => resetAddedLinesCache())
afterEach(() => {
  for (const dir of trash.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'added-lines-'))
  trash.push(dir)
  return dir
}

describe('untracked added-line counting', () => {
  it('counts a trailing line without a newline', async () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree')
    expect(await countAddedLines(join(dir, 'a.txt'))).toBe(3)
  })

  it('reports binary files as zero rather than counting stray 0x0a bytes', async () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'bin'), Buffer.from([0x01, 0x0a, 0x00, 0x0a]))
    expect(await countAddedLines(join(dir, 'bin'))).toBe(0)
  })

  it('re-reads nothing on a repeat poll of an unchanged file', async () => {
    const dir = makeDir()
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'one\ntwo\n')

    expect(await countAddedLines(file)).toBe(2)
    expect(addedLinesReadCount()).toBe(1)

    for (let poll = 0; poll < 5; poll++) expect(await countAddedLines(file)).toBe(2)
    expect(addedLinesReadCount()).toBe(1)
  })

  it('picks up an edit that changes the content length', async () => {
    const dir = makeDir()
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'one\n')
    expect(await countAddedLines(file)).toBe(1)
    writeFileSync(file, 'one\ntwo\nthree\n')
    expect(await countAddedLines(file)).toBe(3)
  })

  it('skips a file too large to be worth reading', async () => {
    const dir = makeDir()
    const file = join(dir, 'big.bin')
    writeFileSync(file, Buffer.alloc(5 * 1024 * 1024, 0x41))
    const before = (await readFile(file)).length
    expect(before).toBeGreaterThan(4 * 1024 * 1024)
    expect(await countAddedLines(file)).toBe(0)
  })
})
