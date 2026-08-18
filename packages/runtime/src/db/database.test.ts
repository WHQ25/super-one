import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openNodeDatabase } from './database'

let db: Database.Database | null = null

afterEach(() => {
  db?.close()
  db = null
})

describe('openNodeDatabase session providers', () => {
  it('registers the canonical dsh base provider for remote sessions', () => {
    db = openNodeDatabase(':memory:')

    expect(
      db.prepare('SELECT harness_id, is_base FROM session_providers WHERE id = ?')
        .get('dsh-base'),
    ).toEqual({ harness_id: 'dsh', is_base: 1 })
  })
})
