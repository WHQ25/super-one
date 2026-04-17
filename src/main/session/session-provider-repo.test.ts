import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('../database', () => ({ getDb: getDbMock }))

import {
  listSessionProviders,
  getSessionProvider,
  getOfficialProvider,
  createSessionProvider,
  updateSessionProvider,
  deleteSessionProvider,
  listByHarness,
} from './session-provider-repo'

interface Row {
  id: string
  harness_id: string
  name: string
  is_official: number
  config_json: string
  created_at: string
  updated_at: string
}

function makeFakeDb() {
  const rows = new Map<string, Row>()

  const sortForList = (a: Row, b: Row) => {
    if (a.is_official !== b.is_official) return b.is_official - a.is_official
    return a.created_at.localeCompare(b.created_at)
  }

  const db = {
    prepare: (sql: string) => {
      if (/^\s*SELECT \* FROM session_providers ORDER BY/.test(sql)) {
        return { all: () => Array.from(rows.values()).sort(sortForList) }
      }
      if (/^\s*SELECT \* FROM session_providers WHERE harness_id/.test(sql)) {
        return { all: (harness: string) => Array.from(rows.values()).filter((r) => r.harness_id === harness).sort(sortForList) }
      }
      if (/^\s*SELECT \* FROM session_providers WHERE id/.test(sql)) {
        return { get: (id: string) => rows.get(id) }
      }
      if (/^\s*INSERT INTO session_providers/.test(sql)) {
        return {
          run: (id: string, harness_id: string, name: string, config_json: string, created_at: string, updated_at: string) => {
            rows.set(id, { id, harness_id, name, is_official: 0, config_json, created_at, updated_at })
          },
        }
      }
      if (/^\s*UPDATE session_providers SET name/.test(sql)) {
        return {
          run: (name: string, config_json: string, updated_at: string, id: string) => {
            const existing = rows.get(id)
            if (existing) rows.set(id, { ...existing, name, config_json, updated_at })
          },
        }
      }
      if (/^\s*DELETE FROM session_providers WHERE id/.test(sql)) {
        return { run: (id: string) => { rows.delete(id) } }
      }
      throw new Error(`Unmocked SQL: ${sql}`)
    },
  }

  const seed = () => {
    const now = new Date().toISOString()
    rows.set('claude-official', { id: 'claude-official', harness_id: 'claude', name: 'Claude (Official)', is_official: 1, config_json: '{}', created_at: now, updated_at: now })
    rows.set('codex-official', { id: 'codex-official', harness_id: 'codex', name: 'Codex (Official)', is_official: 1, config_json: '{}', created_at: now, updated_at: now })
  }

  return { db, seed }
}

describe('session-provider-repo', () => {
  beforeEach(() => {
    const { db, seed } = makeFakeDb()
    seed()
    getDbMock.mockReturnValue(db)
  })

  describe('list / get', () => {
    it('lists both official providers', () => {
      const ids = listSessionProviders().map((p) => p.id).sort()
      expect(ids).toEqual(['claude-official', 'codex-official'])
    })

    it('listByHarness filters by harness', () => {
      expect(listByHarness('claude').map((p) => p.id)).toEqual(['claude-official'])
      expect(listByHarness('codex').map((p) => p.id)).toEqual(['codex-official'])
    })

    it('get returns null for unknown id', () => {
      expect(getSessionProvider('nope')).toBeNull()
    })

    it('getOfficialProvider returns the seeded official', () => {
      expect(getOfficialProvider('claude').isOfficial).toBe(true)
      expect(getOfficialProvider('codex').isOfficial).toBe(true)
    })
  })

  describe('create', () => {
    it('creates a non-official provider with validated config', () => {
      const p = createSessionProvider({
        harnessId: 'claude',
        name: 'my claude',
        config: { apiKey: 'sk-xxx', model: 'claude-opus-4-7' },
      })
      expect(p.isOfficial).toBe(false)
      expect(p.harnessId).toBe('claude')
      expect(p.name).toBe('my claude')
      expect(p.config).toMatchObject({ apiKey: 'sk-xxx', model: 'claude-opus-4-7' })
    })

    it('rejects invalid config (Zod validation)', () => {
      expect(() => createSessionProvider({
        harnessId: 'claude',
        name: 'bad',
        config: { initializeTimeoutMs: -5 },
      })).toThrow()
    })

    it('auto-generates id when not provided', () => {
      const p1 = createSessionProvider({ harnessId: 'claude', name: 'a', config: {} })
      const p2 = createSessionProvider({ harnessId: 'claude', name: 'b', config: {} })
      expect(p1.id).not.toBe(p2.id)
      expect(p1.id.startsWith('claude-')).toBe(true)
    })
  })

  describe('update', () => {
    it('updates name of non-official provider', () => {
      const p = createSessionProvider({ harnessId: 'claude', name: 'orig', config: {} })
      const updated = updateSessionProvider(p.id, { name: 'renamed' })
      expect(updated.name).toBe('renamed')
    })

    it('updates config and re-validates', () => {
      const p = createSessionProvider({ harnessId: 'claude', name: 'x', config: {} })
      const updated = updateSessionProvider(p.id, { config: { model: 'claude-sonnet-4-6' } })
      expect(updated.config).toMatchObject({ model: 'claude-sonnet-4-6' })
    })

    it('throws when updating an official provider', () => {
      expect(() => updateSessionProvider('claude-official', { name: 'new' })).toThrow(/official/)
    })

    it('throws for unknown id', () => {
      expect(() => updateSessionProvider('nope', { name: 'x' })).toThrow(/not found/)
    })
  })

  describe('delete', () => {
    it('deletes non-official provider', () => {
      const p = createSessionProvider({ harnessId: 'claude', name: 'tmp', config: {} })
      expect(deleteSessionProvider(p.id)).toBe(true)
      expect(getSessionProvider(p.id)).toBeNull()
    })

    it('returns false for unknown id', () => {
      expect(deleteSessionProvider('nope')).toBe(false)
    })

    it('throws when deleting an official provider', () => {
      expect(() => deleteSessionProvider('claude-official')).toThrow(/official/)
    })
  })
})
