import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { ensurePtcNodeLauncher } from './deepseek-ptc-launcher'

const run = promisify(execFile)
let dir: string | undefined

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe.skipIf(process.platform === 'win32')('ensurePtcNodeLauncher', () => {
  it('runs the given binary as Node with the arguments dsh passes', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-ptc-launcher-'))
    // A stand-in "Electron": reports whether it was asked to act as Node, and
    // echoes its arguments, so the test needs no real Electron binary.
    const fake = join(dir, 'fake electron')
    await writeFile(fake, '#!/bin/sh\necho "$ELECTRON_RUN_AS_NODE|$1|$2"\n', { mode: 0o755 })

    const launcher = await ensurePtcNodeLauncher(join(dir, 'bin'), fake, 'darwin')
    const { stdout } = await run(launcher, ['--max-old-space-size=64', 'boot.js'], { env: {} })

    expect(stdout.trim()).toBe('1|--max-old-space-size=64|boot.js')
  })

  it('restores the execute bit and the text when the launcher drifted', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-ptc-launcher-'))
    const bin = join(dir, 'bin')
    const launcher = await ensurePtcNodeLauncher(bin, '/Applications/Old.app/Contents/MacOS/Old', 'darwin')
    await writeFile(launcher, 'stale', { mode: 0o644 })

    await ensurePtcNodeLauncher(bin, '/Applications/SuperOne.app/Contents/MacOS/SuperOne', 'darwin')

    expect(await readFile(launcher, 'utf8')).toContain('/Applications/SuperOne.app/Contents/MacOS/SuperOne')
    expect((await stat(launcher)).mode & 0o111).not.toBe(0)
  })
})

describe('ensurePtcNodeLauncher on Windows', () => {
  it('falls back to the node on PATH', async () => {
    expect(await ensurePtcNodeLauncher('C:\\unused', 'C:\\SuperOne.exe', 'win32')).toBe('node')
  })
})
