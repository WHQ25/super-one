import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Fail-closed credential storage for long-lived node credentials.
 *
 * Unlike the provider secret-store (which may fall back to plaintext), node
 * refresh tokens and device keys are NEVER written in plaintext. When OS
 * secure storage is unavailable, credentials stay in-memory only (or save is refused).
 */

export interface NodeDeviceCredential {
  connectionId: string
  environmentId: string
  nodePublicKeyFingerprint: string
  clientSessionId: string
  /** Device private key PEM (Ed25519). */
  devicePrivateKeyPem: string
  devicePublicKeyPem: string
  /** Current refresh token (rotates). */
  refreshToken: string
  /** Base URL last used successfully (http://127.0.0.1:port or remote). */
  baseUrl: string
  label: string
  updatedAt: number
}

interface StoredFile {
  version: 1
  entries: Array<{
    connectionId: string
    environmentId: string
    nodePublicKeyFingerprint: string
    clientSessionId: string
    baseUrl: string
    label: string
    updatedAt: number
    /** safeStorage blob: enc:v1:<base64> containing JSON of secrets */
    secretsBlob: string
  }>
}

const ENC_PREFIX = 'enc:v1:'

export type CredentialSaveResult =
  | { ok: true; persisted: true }
  | { ok: true; persisted: false; reason: 'secure_storage_unavailable' }
  | { ok: false; reason: string }

export class NodeCredentialStore {
  private memory = new Map<string, NodeDeviceCredential>()
  private readonly filePath: string

  constructor(userDataDir: string) {
    const dir = join(userDataDir, 'node-credentials')
    mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'credentials.json')
    this.loadFromDisk()
  }

  isSecureStorageAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  get(connectionId: string): NodeDeviceCredential | null {
    return this.memory.get(connectionId) ?? null
  }

  getByEnvironmentId(environmentId: string): NodeDeviceCredential | null {
    for (const c of this.memory.values()) {
      if (c.environmentId === environmentId) return c
    }
    return null
  }

  list(): NodeDeviceCredential[] {
    return [...this.memory.values()].map((c) => ({ ...c }))
  }

  /**
   * Save credentials. If secure storage is unavailable:
   * - keep in memory for this process
   * - do not write disk
   * - return persisted:false so UI can warn
   */
  save(cred: NodeDeviceCredential): CredentialSaveResult {
    this.memory.set(cred.connectionId, { ...cred, updatedAt: Date.now() })

    if (!this.isSecureStorageAvailable()) {
      return { ok: true, persisted: false, reason: 'secure_storage_unavailable' }
    }

    try {
      this.flushToDisk()
      return { ok: true, persisted: true }
    } catch (err) {
      return { ok: false, reason: (err as Error).message }
    }
  }

  updateRefreshToken(connectionId: string, refreshToken: string): CredentialSaveResult {
    const existing = this.memory.get(connectionId)
    if (!existing) return { ok: false, reason: 'not_found' }
    return this.save({ ...existing, refreshToken, updatedAt: Date.now() })
  }

  remove(connectionId: string): void {
    this.memory.delete(connectionId)
    if (this.isSecureStorageAvailable()) {
      try {
        this.flushToDisk()
      } catch {
        /* best-effort */
      }
    }
  }

  private loadFromDisk(): void {
    if (!existsSync(this.filePath)) return
    if (!this.isSecureStorageAvailable()) {
      // Fail closed: do not load ciphertext we cannot decrypt; do not load plaintext.
      return
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as StoredFile
      if (raw.version !== 1 || !Array.isArray(raw.entries)) return
      for (const entry of raw.entries) {
        if (!entry.secretsBlob?.startsWith(ENC_PREFIX)) continue
        const plain = safeStorage.decryptString(Buffer.from(entry.secretsBlob.slice(ENC_PREFIX.length), 'base64'))
        const secrets = JSON.parse(plain) as {
          devicePrivateKeyPem: string
          devicePublicKeyPem: string
          refreshToken: string
        }
        this.memory.set(entry.connectionId, {
          connectionId: entry.connectionId,
          environmentId: entry.environmentId,
          nodePublicKeyFingerprint: entry.nodePublicKeyFingerprint,
          clientSessionId: entry.clientSessionId,
          devicePrivateKeyPem: secrets.devicePrivateKeyPem,
          devicePublicKeyPem: secrets.devicePublicKeyPem,
          refreshToken: secrets.refreshToken,
          baseUrl: entry.baseUrl,
          label: entry.label,
          updatedAt: entry.updatedAt,
        })
      }
    } catch {
      /* corrupt file — start empty */
    }
  }

  private flushToDisk(): void {
    if (!this.isSecureStorageAvailable()) {
      throw new Error('secure storage unavailable; refusing plaintext node credential write')
    }
    const entries: StoredFile['entries'] = []
    for (const cred of this.memory.values()) {
      const secretsJson = JSON.stringify({
        devicePrivateKeyPem: cred.devicePrivateKeyPem,
        devicePublicKeyPem: cred.devicePublicKeyPem,
        refreshToken: cred.refreshToken,
      })
      const secretsBlob = ENC_PREFIX + safeStorage.encryptString(secretsJson).toString('base64')
      entries.push({
        connectionId: cred.connectionId,
        environmentId: cred.environmentId,
        nodePublicKeyFingerprint: cred.nodePublicKeyFingerprint,
        clientSessionId: cred.clientSessionId,
        baseUrl: cred.baseUrl,
        label: cred.label,
        updatedAt: cred.updatedAt,
        secretsBlob,
      })
    }
    // Atomic rewrite: failed mid-write must not corrupt the prior credentials file.
    const body = JSON.stringify({ version: 1, entries } satisfies StoredFile, null, 2)
    const tmp = `${this.filePath}.tmp-${randomUUID()}`
    try {
      writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 })
      renameSync(tmp, this.filePath)
    } catch (err) {
      try {
        unlinkSync(tmp)
      } catch {
        /* ignore */
      }
      throw err
    }
  }
}
