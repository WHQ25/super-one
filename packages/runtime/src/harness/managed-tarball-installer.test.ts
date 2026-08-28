/**
 * Extraction contract for the managed harness installer.
 *
 * Regression: extraction used to `spawn('tar')`, which dies with
 * `spawn tar ENOENT` on any Windows box where `System32\tar.exe` is not
 * reachable via PATH/PATHEXT — that took down harness enable entirely.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { c as createTar } from 'tar'
import { extractTgzArchive } from './managed-tarball-installer'

let work: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'superone-extract-test-'))
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

/** Build an npm-shaped tarball: `package/` with a nested executable. */
async function writeFixtureTgz(): Promise<string> {
  const src = join(work, 'src')
  const binDir = join(src, 'package', 'vendor', 'bin')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(src, 'package', 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))
  const bin = join(binDir, 'codex')
  writeFileSync(bin, '#!/bin/sh\necho hi\n')
  chmodSync(bin, 0o755)

  const tgz = join(work, 'fixture.tgz')
  await createTar({ gzip: true, file: tgz, cwd: src }, ['package'])
  return tgz
}

describe('extractTgzArchive', () => {
  it('extracts the package/ payload', async () => {
    const tgz = await writeFixtureTgz()
    const dest = join(work, 'out')

    await extractTgzArchive(tgz, dest)

    const pkg = join(dest, 'package', 'package.json')
    expect(existsSync(pkg)).toBe(true)
    expect(JSON.parse(readFileSync(pkg, 'utf8'))).toMatchObject({ name: 'fixture' })
    expect(existsSync(join(dest, 'package', 'vendor', 'bin', 'codex'))).toBe(true)
  })

  it('creates the destination directory when missing', async () => {
    const tgz = await writeFixtureTgz()
    const dest = join(work, 'nested', 'deep', 'out')

    await extractTgzArchive(tgz, dest)

    expect(existsSync(join(dest, 'package', 'package.json'))).toBe(true)
  })

  it.skipIf(process.platform === 'win32')(
    'preserves the executable bit on nested bins (codex vendor binaries)',
    async () => {
      const tgz = await writeFixtureTgz()
      const dest = join(work, 'out')

      await extractTgzArchive(tgz, dest)

      const mode = statSync(join(dest, 'package', 'vendor', 'bin', 'codex')).mode
      expect(mode & 0o111).not.toBe(0)
    },
  )

  it('does not depend on a system tar binary being on PATH', async () => {
    const tgz = await writeFixtureTgz()
    const dest = join(work, 'out')
    const prevPath = process.env.PATH
    process.env.PATH = ''
    try {
      // The previous spawn('tar') implementation rejected here with
      // `tar spawn failed: spawn tar ENOENT` — exactly the Windows report.
      await extractTgzArchive(tgz, dest)
    } finally {
      process.env.PATH = prevPath
    }

    expect(existsSync(join(dest, 'package', 'package.json'))).toBe(true)
  })

  it('reports a readable error for a corrupt archive', async () => {
    const bad = join(work, 'corrupt.tgz')
    writeFileSync(bad, 'not a gzip stream')

    await expect(extractTgzArchive(bad, join(work, 'out'))).rejects.toThrow(/tar extract failed/)
  })

  it('does not write outside the destination directory', async () => {
    const src = join(work, 'evil-src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'escaped.txt'), 'pwned')
    const tgz = join(work, 'evil.tgz')
    await createTar({ gzip: true, file: tgz, cwd: src, preservePaths: true }, ['../evil-src/escaped.txt'])

    const dest = join(work, 'out')
    await extractTgzArchive(tgz, dest).catch(() => undefined)

    expect(existsSync(join(work, 'out', 'escaped.txt'))).toBe(false)
    expect(existsSync(join(work, '..', 'escaped.txt'))).toBe(false)
  })
})
