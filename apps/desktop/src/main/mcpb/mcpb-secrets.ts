import { readFile, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { safeStorage } from 'electron'

const SECRETS_FILE = 'secrets.bin'

interface SecretsBlob {
  version: 1
  values: Record<string, string>
}

function secretsPath(installDir: string): string {
  return join(installDir, SECRETS_FILE)
}

export async function writeSecrets(installDir: string, values: Record<string, string>): Promise<void> {
  const path = secretsPath(installDir)
  if (Object.keys(values).length === 0) {
    if (existsSync(path)) await rm(path, { force: true })
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this platform; cannot store sensitive user_config.')
  }
  const blob: SecretsBlob = { version: 1, values }
  const encrypted = safeStorage.encryptString(JSON.stringify(blob))
  await writeFile(path, encrypted)
}

export async function readSecrets(installDir: string): Promise<Record<string, string>> {
  const path = secretsPath(installDir)
  if (!existsSync(path)) return {}
  const buf = await readFile(path)
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available; cannot decrypt sensitive user_config.')
  }
  const json = safeStorage.decryptString(buf)
  const parsed = JSON.parse(json) as SecretsBlob
  if (parsed.version !== 1 || typeof parsed.values !== 'object' || parsed.values == null) {
    throw new Error('Invalid secrets blob format')
  }
  return parsed.values
}

export async function clearSecrets(installDir: string): Promise<void> {
  const path = secretsPath(installDir)
  if (existsSync(path)) await rm(path, { force: true })
}
