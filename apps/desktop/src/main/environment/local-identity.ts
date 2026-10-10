import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** This desktop's id: the node identity's (`<userData>/node-host`), which every resource, topic and lease uses. */
const NODE_ENVIRONMENT_ID_FILE = join('node-host', 'environment-id')
/** The id the desktop had before its node identity became canonical. */
const LEGACY_ENVIRONMENT_ID_FILE = 'environment-id'

export interface DesktopEnvironmentIdentity {
  environmentId: string
  /** Earlier ids references may carry; resolved before looking anything up. */
  aliases: string[]
}

function readId(path: string): string | null {
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8').trim() || null
}

/**
 * Load this desktop's environment identity under `dataDir` (Electron userData,
 * or a temp dir in tests). A desktop without a node identity takes its local
 * id for it; one that has both keeps the local id as an alias, so links and
 * pairings made with either keep resolving.
 */
export function loadDesktopEnvironmentIdentity(dataDir: string): DesktopEnvironmentIdentity {
  const nodePath = join(dataDir, NODE_ENVIRONMENT_ID_FILE)
  const legacy = readId(join(dataDir, LEGACY_ENVIRONMENT_ID_FILE))
  const existing = readId(nodePath)
  if (existing) return { environmentId: existing, aliases: legacy && legacy !== existing ? [legacy] : [] }
  const environmentId = legacy ?? randomUUID()
  mkdirSync(dirname(nodePath), { recursive: true })
  writeFileSync(nodePath, `${environmentId}\n`, { encoding: 'utf8', mode: 0o600 })
  return { environmentId, aliases: [] }
}
