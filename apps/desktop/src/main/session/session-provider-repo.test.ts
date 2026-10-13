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
} from './session-provider-repo'

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
    it('deletes non-base provider', () => {
      const p = createSessionProvider({ harnessId: 'claude', name: 'tmp', config: {} })
      expect(deleteSessionProvider(p.id)).toBe(true)
      expect(getSessionProvider(p.id)).toBeNull()
    })

    it('returns false for unknown id', () => {
      expect(deleteSessionProvider('nope')).toBe(false)
    })

    it('throws when deleting a base provider', () => {
      expect(() => deleteSessionProvider('claude-base')).toThrow(/base/)
    })
  })
})
