import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const ENVIRONMENT_ID_FILE = 'environment-id'

/**
 * Load or create a stable local environment id under `dataDir`.
 * Pure filesystem helper — callers pass Electron userData (or a temp dir in tests).
 */
export function loadOrCreateLocalEnvironmentId(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true })
  const path = join(dataDir, ENVIRONMENT_ID_FILE)
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8').trim()
    if (existing.length > 0) return existing
  }
  const id = randomUUID()
  writeFileSync(path, `${id}\n`, { encoding: 'utf8', mode: 0o600 })
  return id
}
