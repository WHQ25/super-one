import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  available: true,
  store: new Map<string, string>(),
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => electron.available,
    encryptString: (s: string) => {
      const id = `blob-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => {
      const id = buf.toString()
      const v = electron.store.get(id)
      if (v === undefined) throw new Error('missing')
      return v
    },
  },
}))

import { NodeCredentialStore } from './node-credential-store'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  electron.store.clear()
  electron.available = true
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'superone-cred-'))
  dirs.push(dir)
  return dir
}

const sample = {
  connectionId: 'c1',
  environmentId: 'e1',
  nodePublicKeyFingerprint: 'fp',
  clientSessionId: 's1',
  devicePrivateKeyPem: 'priv',
  devicePublicKeyPem: 'pub',
  refreshToken: 'refresh-secret',
  baseUrl: 'http://127.0.0.1:7788',
  label: 'lab',
  updatedAt: Date.now(),
}

describe('NodeCredentialStore', () => {
  beforeEach(() => {
    electron.available = true
    electron.store.clear()
  })

  it('persists encrypted credentials when secure storage is available', () => {
    const dir = tempDir()
    const store = new NodeCredentialStore(dir)
    const result = store.save(sample)
    expect(result).toEqual({ ok: true, persisted: true })

    const store2 = new NodeCredentialStore(dir)
    const loaded = store2.get('c1')
    expect(loaded?.refreshToken).toBe('refresh-secret')
    expect(loaded?.devicePrivateKeyPem).toBe('priv')
  })

  it('keeps credentials in memory only when secure storage is unavailable', () => {
    electron.available = false
    const dir = tempDir()
    const store = new NodeCredentialStore(dir)
    const result = store.save(sample)
    expect(result).toEqual({ ok: true, persisted: false, reason: 'secure_storage_unavailable' })
    expect(store.get('c1')?.refreshToken).toBe('refresh-secret')

    // New process cannot load plaintext
    const store2 = new NodeCredentialStore(dir)
    expect(store2.get('c1')).toBeNull()
  })

  it('never writes plaintext secrets to disk', async () => {
    const dir = tempDir()
    const store = new NodeCredentialStore(dir)
    store.save(sample)
    const fs = await import('node:fs')
    const path = join(dir, 'node-credentials', 'credentials.json')
    expect(fs.existsSync(path)).toBe(true)
    const raw = fs.readFileSync(path, 'utf8')
    expect(raw).not.toContain('refresh-secret')
    expect(raw).not.toContain('priv')
    expect(raw).toContain('enc:v1:')
  })

  it('persists rotated refresh via temp+rename without plaintext on disk', async () => {
    const dir = tempDir()
    const store = new NodeCredentialStore(dir)
    expect(store.save(sample)).toEqual({ ok: true, persisted: true })
    const path = join(dir, 'node-credentials', 'credentials.json')
    const fs = await import('node:fs')
    const before = fs.readFileSync(path, 'utf8')

    // Second save with rotated token must still leave a readable file.
    expect(
      store.save({ ...sample, refreshToken: 'refresh-rotated', updatedAt: Date.now() }),
    ).toEqual({ ok: true, persisted: true })
    const after = fs.readFileSync(path, 'utf8')
    expect(after).not.toContain('refresh-rotated') // encrypted blob only
    expect(after).toContain('enc:v1:')
    expect(before).toContain('enc:v1:')

    const reloaded = new NodeCredentialStore(dir).get('c1')
    expect(reloaded?.refreshToken).toBe('refresh-rotated')
  })
})
