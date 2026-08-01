import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { nodePaths } from './config'
import { createPublicKey } from 'node:crypto'
import {
  fingerprintPublicKeyPem,
  generateEd25519KeyPair,
  loadPrivateKey,
  publicKeyToRaw,
  sha256Hex,
  type Ed25519KeyPair,
} from './crypto-util'

export interface NodeIdentity {
  environmentId: string
  label: string
  privateKeyPem: string
  publicKeyPem: string
  publicKeyFingerprint: string
  /** Binding derived from host machine identity, Unix UID, and data-dir path. */
  bindingHash: string
  nodeHome: string
  /**
   * True when persisted binding no longer matches this host/UID/data-dir.
   * Node serves only local admin recovery until regenerate/adopt.
   */
  identityConflict: boolean
  persistedBindingHash: string | null
}

export interface IdentityFiles {
  environmentIdPath: string
  instanceKeyPath: string
}

function ensureDir(path: string, mode = 0o700): void {
  mkdirSync(path, { recursive: true, mode })
  try {
    chmodSync(path, mode)
  } catch {
    /* best-effort on platforms without chmod semantics */
  }
}

function writeSecretFile(path: string, content: string): void {
  ensureDir(dirname(path))
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    /* ignore */
  }
}

export function computeBindingHash(nodeHome: string): string {
  let uid = 'unknown'
  try {
    uid = String(userInfo().uid)
  } catch {
    /* windows / restricted */
  }
  const host = hostname()
  return sha256Hex(`${host}|${uid}|${nodeHome}`)
}

export function loadOrCreateIdentity(nodeHome: string, label?: string): NodeIdentity {
  const paths = nodePaths(nodeHome)
  ensureDir(nodeHome)
  ensureDir(paths.secretsDir)
  ensureDir(paths.logsDir)

  let environmentId: string
  if (existsSync(paths.environmentId)) {
    environmentId = readFileSync(paths.environmentId, 'utf8').trim()
    if (!environmentId) {
      environmentId = crypto.randomUUID()
      writeSecretFile(paths.environmentId, `${environmentId}\n`)
    }
  } else {
    environmentId = crypto.randomUUID()
    writeSecretFile(paths.environmentId, `${environmentId}\n`)
  }

  let keyPair: Ed25519KeyPair
  if (existsSync(paths.instanceKey)) {
    const privateKeyPem = readFileSync(paths.instanceKey, 'utf8')
    const privateKey = loadPrivateKey(privateKeyPem)
    const publicKey = createPublicKey(privateKey)
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const publicKeyRaw = publicKeyToRaw(publicKey)
    keyPair = {
      privateKeyPem,
      publicKeyPem,
      publicKeyRaw,
      fingerprint: fingerprintPublicKeyPem(publicKeyPem),
    }
  } else {
    keyPair = generateEd25519KeyPair()
    writeSecretFile(paths.instanceKey, keyPair.privateKeyPem)
  }

  const bindingHash = computeBindingHash(nodeHome)
  const bindingPath = join(paths.secretsDir, 'binding-hash')
  let persistedBindingHash: string | null = null
  let identityConflict = false
  if (existsSync(bindingPath)) {
    persistedBindingHash = readFileSync(bindingPath, 'utf8').trim() || null
    if (persistedBindingHash && persistedBindingHash !== bindingHash) {
      identityConflict = true
    }
  } else {
    writeSecretFile(bindingPath, `${bindingHash}\n`)
    persistedBindingHash = bindingHash
  }

  return {
    environmentId,
    label: label || hostname() || 'superone',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
    publicKeyFingerprint: keyPair.fingerprint,
    bindingHash,
    nodeHome,
    identityConflict,
    persistedBindingHash,
  }
}

/**
 * Regenerate identity (new environmentId + key pair) without wiping project data.
 * Used after clone detection / VM restore before network access.
 * Also rewrites binding hash to the current host binding.
 */
export function regenerateIdentity(nodeHome: string, label?: string): NodeIdentity {
  const paths = nodePaths(nodeHome)
  ensureDir(nodeHome)
  ensureDir(paths.secretsDir)

  const environmentId = crypto.randomUUID()
  writeSecretFile(paths.environmentId, `${environmentId}\n`)

  const keyPair = generateEd25519KeyPair()
  writeSecretFile(paths.instanceKey, keyPair.privateKeyPem)

  const bindingHash = computeBindingHash(nodeHome)
  writeSecretFile(join(paths.secretsDir, 'binding-hash'), `${bindingHash}\n`)

  return {
    environmentId,
    label: label || hostname() || 'superone',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
    publicKeyFingerprint: keyPair.fingerprint,
    bindingHash,
    nodeHome,
    identityConflict: false,
    persistedBindingHash: bindingHash,
  }
}
