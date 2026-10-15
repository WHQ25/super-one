import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BASE_SESSION_PROVIDER_DEFINITIONS } from '@superone/shared/session-provider-definitions'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('../database', () => ({ getDb: getDbMock }))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../agent/claude-permissions', () => ({
  createCanUseTool: vi.fn(() => ({ canUseTool: vi.fn(), trackPlanFile: vi.fn() })),
  createOnElicitation: vi.fn(() => vi.fn()),
  respondToElicitation: vi.fn(),
  respondToPermission: vi.fn(),
  respondToQuestion: vi.fn(),
  dismissQuestion: vi.fn(),
  respondToPlanApproval: vi.fn(),
  rejectAllPending: vi.fn(),
}))

vi.mock('../agent/claude-query', () => ({
  createSessionQuery: vi.fn(),
  buildUserMessage: vi.fn(),
}))

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({})),
}))

vi.mock('../codex/codex-turn', () => ({
  runCodexTurn: vi.fn(),
  reviewCodexTurn: vi.fn(),
  compactCodexTurn: vi.fn(),
  steerCodex: vi.fn(async () => {}),
  interruptCodex: vi.fn(() => false),
  resetCodexSession: vi.fn(),
  respondToCodexPermission: vi.fn(() => true),
  respondToCodexQuestion: vi.fn(() => true),
  dismissCodexQuestion: vi.fn(() => true),
  prewarmCodexConnection: vi.fn(async () => null),
}))

import {
  listSessionProviders,
  getSessionProvider,
  getBaseProvider,
  createSessionProvider,
  updateSessionProvider,
  deleteSessionProvider,
  listByHarness,
  sessionProviderStore,
  clientSessionProviderStore,
  updateBaseProviderConfig,
} from './session-provider-repo'
import { dispatchSessionProviderRpc } from '@superone/runtime/server/rpc-session-providers'
import type { AuthenticatedClient } from '@superone/runtime/server'

describe('session-provider-repo', () => {
  beforeEach(() => {
    // The store creates and seeds the table like the desktop migration does.
    getDbMock.mockReturnValue(new Database(':memory:'))
  })

  describe('list / get', () => {
    it('lists base providers', () => {
      const ids = listSessionProviders().map((p) => p.id).sort()
      expect(ids).toEqual(BASE_SESSION_PROVIDER_DEFINITIONS.map((p) => p.id).sort())
    })

    it('listByHarness filters by harness', () => {
      expect(listByHarness('claude').map((p) => p.id)).toEqual(['claude-base'])
      expect(listByHarness('codex').map((p) => p.id)).toEqual(['codex-base'])
      expect(listByHarness('acp').map((p) => p.id)).toEqual(['acp-base'])
    })

    it('get returns null for unknown id', () => {
      expect(getSessionProvider('nope')).toBeNull()
    })

    it('getBaseProvider returns the seeded base', () => {
      expect(getBaseProvider('claude').isBase).toBe(true)
      expect(getBaseProvider('codex').isBase).toBe(true)
      expect(getBaseProvider('acp').isBase).toBe(true)
    })
  })

  describe('create', () => {
    it('creates a non-base provider with validated config', () => {
      const p = createSessionProvider({
        harnessId: 'claude',
        name: 'my claude',
        config: { apiKey: 'sk-xxx', model: 'claude-opus-4-8' },
      })
      expect(p.isBase).toBe(false)
      expect(p.harnessId).toBe('claude')
      expect(p.name).toBe('my claude')
      expect(p.config).toMatchObject({ apiKey: 'sk-xxx', model: 'claude-opus-4-8' })
    })

    it('rejects invalid config (Zod validation)', () => {
      expect(() => createSessionProvider({
        harnessId: 'claude',
        name: 'bad',
        config: { initializeTimeoutMs: -5 },
      })).toThrow()
    })

    it('answers a node client\'s invalid config as invalid_argument', () => {
      const client = { clientSessionId: 'node:c1', scopes: ['node:admin'], devicePublicKeyFingerprint: 'fp', devicePublicKeyPem: 'pem' } as AuthenticatedClient
      const res = dispatchSessionProviderRpc(
        'sessionProviders.create',
        { harnessId: 'claude', name: 'bad', config: { initializeTimeoutMs: -5 } },
        { client, sessionProviders: sessionProviderStore() },
      )
      expect(res?.error?.code).toBe('invalid_argument')
    })

    it('auto-generates id when not provided', () => {
      const p1 = createSessionProvider({ harnessId: 'claude', name: 'a', config: {} })
      const p2 = createSessionProvider({ harnessId: 'claude', name: 'b', config: {} })
      expect(p1.id).not.toBe(p2.id)
      expect(p1.id.startsWith('claude-')).toBe(true)
    })
  })

  describe('update', () => {
    it('updates name of non-base provider', () => {
      const p = createSessionProvider({ harnessId: 'claude', name: 'orig', config: {} })
      const updated = updateSessionProvider(p.id, { name: 'renamed' })
      expect(updated.name).toBe('renamed')
    })

    it('updates config and re-validates', () => {
      const p = createSessionProvider({ harnessId: 'claude', name: 'x', config: {} })
      const updated = updateSessionProvider(p.id, { config: { model: 'claude-sonnet-4-6' } })
      expect(updated.config).toMatchObject({ model: 'claude-sonnet-4-6' })
    })

    it('throws when updating a base provider', () => {
      expect(() => updateSessionProvider('claude-base', { name: 'new' })).toThrow(/base/)
    })

    it('throws for unknown id', () => {
      expect(() => updateSessionProvider('nope', { name: 'x' })).toThrow(/not found/)
    })
  })

  describe('delete', () => {
    beforeEach(() => {
      const db = new Database(':memory:')
      db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, provider_id TEXT)')
      getDbMock.mockReturnValue(db)
    })

    it('deletes non-base provider', () => {
      const p = createSessionProvider({ harnessId: 'claude', name: 'tmp', config: {} })
      expect(deleteSessionProvider(p.id)).toBe(true)
      expect(getSessionProvider(p.id)).toBeNull()
    })

    it('moves sessions started on the deleted profile to the harness base row so they still resume', () => {
      const p = createSessionProvider({ harnessId: 'codex', name: 'tmp', config: {} })
      const db = getDbMock() as Database.Database
      db.prepare('INSERT INTO sessions (id, provider_id) VALUES (?, ?), (?, ?)').run('s1', p.id, 's2', 'claude-base')
      deleteSessionProvider(p.id)
      expect(db.prepare('SELECT id, provider_id FROM sessions ORDER BY id').all()).toEqual([
        { id: 's1', provider_id: 'codex-base' },
        { id: 's2', provider_id: 'claude-base' },
      ])
    })

    it("moves a node client's deleted row's sessions too", () => {
      const p = createSessionProvider({ harnessId: 'codex', name: 'tmp', config: {} })
      const db = getDbMock() as Database.Database
      db.prepare('INSERT INTO sessions (id, provider_id) VALUES (?, ?)').run('s1', p.id)
      const admin = {
        clientSessionId: 'c1',
        scopes: ['environment:read', 'node:admin'],
        devicePublicKeyFingerprint: 'fp',
        devicePublicKeyPem: 'pem',
      } as AuthenticatedClient
      const res = dispatchSessionProviderRpc('sessionProviders.delete', { id: p.id }, { client: admin, sessionProviders: clientSessionProviderStore() })
      expect(res?.result).toEqual({ ok: true })
      expect(db.prepare('SELECT provider_id FROM sessions').get()).toEqual({ provider_id: 'codex-base' })
    })

    it('returns false for unknown id', () => {
      expect(deleteSessionProvider('nope')).toBe(false)
    })

    it('throws when deleting a base provider', () => {
      expect(() => deleteSessionProvider('claude-base')).toThrow(/base/)
    })
  })

  it('never lets a built-in row carry an agent profile', () => {
    getDbMock.mockReturnValue(new Database(':memory:'))
    expect(() => updateBaseProviderConfig('claude', { profile: { version: 1, identity: { name: 'x', description: 'y' } } }))
      .toThrow(/cannot carry an agent profile/)
    expect(getBaseProvider('claude').config).not.toHaveProperty('profile')
  })
})
