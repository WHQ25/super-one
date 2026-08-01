import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadOrCreateLocalEnvironmentId } from './local-identity'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'superone-env-id-'))
  dirs.push(dir)
  return dir
}

describe('loadOrCreateLocalEnvironmentId', () => {
  it('creates a stable uuid and reuses it', () => {
    const dir = tempDir()
    const a = loadOrCreateLocalEnvironmentId(dir)
    const b = loadOrCreateLocalEnvironmentId(dir)
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(b).toBe(a)
    expect(readFileSync(join(dir, 'environment-id'), 'utf8').trim()).toBe(a)
  })

  it('treats blank files as missing and rewrites', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'environment-id'), '   \n')
    const id = loadOrCreateLocalEnvironmentId(dir)
    expect(id.length).toBeGreaterThan(0)
    expect(readFileSync(join(dir, 'environment-id'), 'utf8').trim()).toBe(id)
  })
})
