import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChannelCredential } from '@superone/runtime/server/secure-channel-client'
import log from '../logger'

/**
 * Fail-closed credential storage for long-lived node credentials.
 *
 * Unlike the provider secret-store (which may fall back to plaintext), node
 * refresh tokens and device keys are NEVER written in plaintext. When OS
 * secure storage is unavailable, credentials stay in-memory only (or save is refused).
 *
 * The file is loaded on first access, not at construction, and retried while
 * secure storage is unavailable: the store must not depend on when its owner
 * is built during startup. Entries that fail to decrypt are written back
 * unchanged, so a failed load never erases them.
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
  /**
   * Bearer access token and its expiry, so a restart inside the token's life
   * can skip refresh. Stored only inside the encrypted secrets blob.
   */
  accessToken?: string
  accessExpiresAt?: number
  /** Base URL last used successfully (http://127.0.0.1:port or remote). */
  baseUrl: string
  label: string
  updatedAt: number
  /**
   * Pairing secret of the node's encrypted channel, from the out-of-band
   * pairing code. Present when the node only serves requests inside it.
   */
  channel?: ChannelCredential
}

interface StoredEntry {
  connectionId: string
  environmentId: string
  nodePublicKeyFingerprint: string
  clientSessionId: string
  baseUrl: string
  label: string
  updatedAt: number
  /** safeStorage blob: enc:v1:<base64> containing JSON of secrets */
  secretsBlob: string
}

interface StoredFile {
  version: 1
  entries: StoredEntry[]
}

const ENC_PREFIX = 'enc:v1:'

export type CredentialSaveResult =
  | { ok: true; persisted: true }
  | { ok: true; persisted: false; reason: 'secure_storage_unavailable' }
  | { ok: false; reason: string }

export class NodeCredentialStore {
  private memory = new Map<string, NodeDeviceCredential>()
  /** On-disk entries this process could not decrypt, kept verbatim for the next write. */
  private unreadable = new Map<string, StoredEntry>()
  private loaded = false
  private warnedUnavailable = false
  private readonly filePath: string

  constructor(userDataDir: string) {
    const dir = join(userDataDir, 'node-credentials')
    mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'credentials.json')
  }

  isSecureStorageAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  get(connectionId: string): NodeDeviceCredential | null {
    this.ensureLoaded()
    return this.memory.get(connectionId) ?? null
  }

  getByEnvironmentId(environmentId: string): NodeDeviceCredential | null {
    this.ensureLoaded()
    for (const c of this.memory.values()) {
      if (c.environmentId === environmentId) return c
    }
    return null
  }

  list(): NodeDeviceCredential[] {
    this.ensureLoaded()
    return [...this.memory.values()].map((c) => ({ ...c }))
  }

  /**
   * Save credentials. If secure storage is unavailable:
   * - keep in memory for this process
   * - do not write disk
   * - return persisted:false so UI can warn
   */
  save(cred: NodeDeviceCredential): CredentialSaveResult {
    // Load first: a write must carry the entries already on disk.
    this.ensureLoaded()
    this.memory.set(cred.connectionId, { ...cred, updatedAt: Date.now() })
    this.unreadable.delete(cred.connectionId)

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
    const existing = this.get(connectionId)
    if (!existing) return { ok: false, reason: 'not_found' }
    return this.save({ ...existing, refreshToken, updatedAt: Date.now() })
  }

  remove(connectionId: string): void {
    this.ensureLoaded()
    this.memory.delete(connectionId)
    this.unreadable.delete(connectionId)
    if (this.isSecureStorageAvailable()) {
      try {
        this.flushToDisk()
      } catch {
        /* best-effort */
      }
    }
  }

  /** Load the file once secure storage can decrypt it; until then, retry on every access. */
  private ensureLoaded(): void {
    if (this.loaded) return
    if (!existsSync(this.filePath)) {
      this.loaded = true
      return
    }
    if (!this.isSecureStorageAvailable()) {
      // Fail closed: do not load ciphertext we cannot decrypt; do not load plaintext.
      if (!this.warnedUnavailable) {
        this.warnedUnavailable = true
        log.warn('[node-credentials] secure storage unavailable; stored credentials not loaded yet')
      }
      return
    }
    this.loaded = true

    let raw: StoredFile
    try {
      raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as StoredFile
    } catch (err) {
      log.warn('[node-credentials] unreadable credentials file: %s', errorMessage(err))
      return
    }
    if (raw.version !== 1 || !Array.isArray(raw.entries)) {
      log.warn('[node-credentials] unsupported credentials file version=%s', String(raw.version))
      return
    }
    for (const entry of raw.entries) {
      // A credential saved in this process before the load is newer than disk.
      if (this.memory.has(entry.connectionId)) continue
      if (!entry.secretsBlob?.startsWith(ENC_PREFIX)) {
        log.warn('[node-credentials] skipped unencrypted entry connectionId=%s', entry.connectionId)
        continue
      }
      try {
        const plain = safeStorage.decryptString(Buffer.from(entry.secretsBlob.slice(ENC_PREFIX.length), 'base64'))
        const secrets = JSON.parse(plain) as {
          devicePrivateKeyPem: string
          devicePublicKeyPem: string
          refreshToken: string
          channel?: ChannelCredential
          accessToken?: string
          accessExpiresAt?: number
        }
        this.memory.set(entry.connectionId, {
          connectionId: entry.connectionId,
          environmentId: entry.environmentId,
          nodePublicKeyFingerprint: entry.nodePublicKeyFingerprint,
          clientSessionId: entry.clientSessionId,
          devicePrivateKeyPem: secrets.devicePrivateKeyPem,
          devicePublicKeyPem: secrets.devicePublicKeyPem,
          refreshToken: secrets.refreshToken,
          ...(secrets.channel ? { channel: secrets.channel } : {}),
          ...(typeof secrets.accessToken === 'string'
            ? { accessToken: secrets.accessToken, accessExpiresAt: secrets.accessExpiresAt }
            : {}),
          baseUrl: entry.baseUrl,
          label: entry.label,
          updatedAt: entry.updatedAt,
        })
      } catch (err) {
        this.unreadable.set(entry.connectionId, entry)
        log.warn(
          '[node-credentials] failed to decrypt entry connectionId=%s: %s',
          entry.connectionId,
          errorMessage(err),
        )
      }
    }
  }

  private flushToDisk(): void {
    if (!this.isSecureStorageAvailable()) {
      throw new Error('secure storage unavailable; refusing plaintext node credential write')
    }
    const entries: StoredEntry[] = [...this.unreadable.values()]
    for (const cred of this.memory.values()) {
      const secretsJson = JSON.stringify({
        devicePrivateKeyPem: cred.devicePrivateKeyPem,
        devicePublicKeyPem: cred.devicePublicKeyPem,
        refreshToken: cred.refreshToken,
        channel: cred.channel,
        ...(cred.accessToken
          ? { accessToken: cred.accessToken, accessExpiresAt: cred.accessExpiresAt }
          : {}),
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
