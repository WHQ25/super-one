import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pathExistsBounded } from './path-exists-bounded'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'superone-path-exists-'))
  tempRoots.push(root)
  return root
}

describe('pathExistsBounded', () => {
  it('returns true for a local file that exists', async () => {
    const dir = tempDir()
    const file = join(dir, 'present.txt')
    writeFileSync(file, 'ok')
    await expect(pathExistsBounded(file)).resolves.toBe(true)
  })

  it('returns false for a path that is gone', async () => {
    await expect(pathExistsBounded(join(tempDir(), 'missing'))).resolves.toBe(false)
  })

  it('returns false when stat does not settle before the deadline', async () => {
    vi.resetModules()
    vi.doMock('node:fs/promises', () => ({
      stat: () => new Promise(() => {}),
    }))
    const { pathExistsBounded: hung } = await import('./path-exists-bounded')
    await expect(hung('/hung/share', 30)).resolves.toBe(false)
  })

  it('returns true for a local directory', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'proj'))
    await expect(pathExistsBounded(join(dir, 'proj'))).resolves.toBe(true)
  })
})
