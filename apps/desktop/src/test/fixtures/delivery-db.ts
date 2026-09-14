/**
 * A real, empty delivery record for tests that touch the session sync zone.
 *
 * Every consumer of a zone file — the mirror, the Host Action push, the
 * transfer worker — reads `session_file_deliveries`, and a table that cannot
 * be read protects everything (`docs/design/session-sync-zone-delivery-record.md`
 * R5). A test that mirrors or produces a zone file therefore needs a table
 * that answers, even when the delivery itself is not what it is about:
 *
 *   vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())
 *
 * One in-memory database per test file; `resetDeliveryDatabase()` empties it
 * between tests.
 */
import Database from 'better-sqlite3'
import { ensureSessionFileDeliveriesSchema } from '../../main/db-session-deliveries-schema'

let current: Database.Database | null = null

function open(): Database.Database {
  if (!current) {
    current = new Database(':memory:')
    ensureSessionFileDeliveriesSchema(current)
  }
  return current
}

/** The `../database` module surface a zone test needs. */
export function deliveryDatabase(): { getDb: () => Database.Database } {
  return { getDb: open }
}

/** The database itself, for a test that seeds or inspects rows directly. */
export function deliveryDb(): Database.Database {
  return open()
}

export function resetDeliveryDatabase(): void {
  if (!current) return
  current.exec('DELETE FROM session_file_deliveries; DELETE FROM session_zone_tombstones;')
}
