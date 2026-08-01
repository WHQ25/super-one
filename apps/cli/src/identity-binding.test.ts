import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadOrCreateIdentity, regenerateIdentity } from './identity'
import { nodePaths } from './config'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('identity binding', () => {
  it('persists binding hash and detects mismatch as identityConflict', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bind-'))
    dirs.push(dir)
    const a = loadOrCreateIdentity(dir)
    expect(a.identityConflict).toBe(false)
    expect(a.persistedBindingHash).toBe(a.bindingHash)

    // Corrupt persisted binding to simulate host/UID/path change after clone.
    const bindingPath = join(nodePaths(dir).secretsDir, 'binding-hash')
    writeFileSync(bindingPath, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n')
    const b = loadOrCreateIdentity(dir)
    expect(b.identityConflict).toBe(true)
    expect(b.environmentId).toBe(a.environmentId)
  })

  it('regenerate rewrites binding and clears conflict', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bind-regen-'))
    dirs.push(dir)
    loadOrCreateIdentity(dir)
    const bindingPath = join(nodePaths(dir).secretsDir, 'binding-hash')
    writeFileSync(bindingPath, '00'.repeat(32) + '\n')
    expect(loadOrCreateIdentity(dir).identityConflict).toBe(true)
    const regen = regenerateIdentity(dir)
    expect(regen.identityConflict).toBe(false)
    expect(loadOrCreateIdentity(dir).identityConflict).toBe(false)
  })
})
