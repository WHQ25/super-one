import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadOrCreateIdentity, regenerateIdentity } from './identity'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('node identity', () => {
  it('persists environment id and key fingerprint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'superone-id-'))
    dirs.push(dir)
    const a = loadOrCreateIdentity(dir, 'n1')
    const b = loadOrCreateIdentity(dir)
    expect(b.environmentId).toBe(a.environmentId)
    expect(b.publicKeyFingerprint).toBe(a.publicKeyFingerprint)
    expect(a.bindingHash).toHaveLength(64)
  })

  it('regenerate creates a new environment id and key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'superone-id-'))
    dirs.push(dir)
    const a = loadOrCreateIdentity(dir)
    const b = regenerateIdentity(dir)
    expect(b.environmentId).not.toBe(a.environmentId)
    expect(b.publicKeyFingerprint).not.toBe(a.publicKeyFingerprint)
  })
})
