import { safeStorage } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { readFile, rm, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { mediaGenKeysPath } from './paths'

interface KeysBlob {
  version: 1
  values: Record<string, string>
}

export async function readMediaKeys(): Promise<Record<string, string>> {
  const path = mediaGenKeysPath()
  if (!existsSync(path)) return {}
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available; cannot decrypt media-gen API keys.')
  }
  const buf = await readFile(path)
  const parsed = JSON.parse(safeStorage.decryptString(buf)) as KeysBlob
  if (parsed.version !== 1 || typeof parsed.values !== 'object' || parsed.values == null) {
    throw new Error('Invalid media-gen keys blob format')
  }
  return parsed.values
}

export async function writeMediaKeys(values: Record<string, string>): Promise<void> {
  const path = mediaGenKeysPath()
  if (Object.keys(values).length === 0) {
    if (existsSync(path)) await rm(path, { force: true })
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available; cannot store media-gen API keys.')
  }
  mkdirSync(dirname(path), { recursive: true })
  const blob: KeysBlob = { version: 1, values }
  await writeFile(path, safeStorage.encryptString(JSON.stringify(blob)))
}

export async function setMediaKey(providerId: string, apiKey: string): Promise<void> {
  const values = await readMediaKeys().catch(() => ({}) as Record<string, string>)
  if (apiKey) values[providerId] = apiKey
  else delete values[providerId]
  await writeMediaKeys(values)
}
