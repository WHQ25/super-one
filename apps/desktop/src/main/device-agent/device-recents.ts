/**
 * Which devices this project has already driven.
 *
 * The reason `device_list` can answer without listing the machine: a project that
 * drove the 17 Pro Max yesterday almost certainly wants it again, and saying so costs
 * three lines where the full catalog costs a hundred.
 *
 * Scoped to the PROJECT, not the session — a new chat about the same app is the case
 * this exists for. Kept in `app_meta` rather than a table of its own: it is a hint,
 * it is a handful of udids, and losing it costs one extra tool call.
 */

import { getDb } from '../database'

export const DEVICE_RECENT_LIMIT = 5

const KEY_PREFIX = 'device.recentUdids:'

/** The slice of storage the catalog needs, so tests need no database. */
export interface DeviceRecentsPort {
  read(): string[]
  remember(udid: string): void
}

export const NO_DEVICE_RECENTS: DeviceRecentsPort = {
  read: () => [],
  remember: () => {},
}

function projectIdFor(sessionId: string): string | null {
  const row = getDb()
    .prepare('SELECT project_id FROM sessions WHERE id = ?')
    .get(sessionId) as { project_id?: string } | undefined
  return row?.project_id ?? null
}

function parse(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

/**
 * Recents for the project this session belongs to.
 *
 * Resolved per call rather than captured: a session's project is fixed, but the row
 * may not exist yet when the first tool call arrives.
 */
export function createDeviceRecents(sessionId: string): DeviceRecentsPort {
  return {
    read(): string[] {
      try {
        const projectId = projectIdFor(sessionId)
        if (!projectId) return []
        const row = getDb()
          .prepare('SELECT value FROM app_meta WHERE key = ?')
          .get(`${KEY_PREFIX}${projectId}`) as { value?: string } | undefined
        return parse(row?.value).slice(0, DEVICE_RECENT_LIMIT)
      } catch {
        // A hint is never worth failing the tool call over.
        return []
      }
    },
    remember(udid: string): void {
      try {
        const projectId = projectIdFor(sessionId)
        if (!projectId) return
        const key = `${KEY_PREFIX}${projectId}`
        const current = this.read()
        const next = [udid, ...current.filter((entry) => entry !== udid)].slice(0, DEVICE_RECENT_LIMIT)
        getDb()
          .prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .run(key, JSON.stringify(next))
      } catch {
        // Same: the grant already happened, and the shortcut is not worth undoing it.
      }
    },
  }
}
