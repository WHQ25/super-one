import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSessionProviderStore,
  settingsFromSessionProviderConfig,
} from './session-provider-store'

const dbs: Database.Database[] = []

afterEach(() => {
  while (dbs.length) {
    try {
      dbs.pop()?.close()
    } catch {
      /* ignore */
    }
  }
})

function openStore() {
  const db = new Database(':memory:')
  dbs.push(db)
  return createSessionProviderStore(db)
}

describe('session-provider-store', () => {
  it('seeds base providers on ensure', () => {
    const store = openStore()
    const ids = store.list().map((p) => p.id).sort()
    expect(ids).toEqual(['acp-base', 'claude-base', 'codex-base', 'cursor-base', 'dsh-base', 'opencode-base'])
    expect(store.getBase('claude').isBase).toBe(true)
    expect(store.getBase('dsh').isBase).toBe(true)
    expect(store.get('claude-base')?.name).toContain('Claude')
  })

  it('creates, updates, and deletes custom profiles', () => {
    const store = openStore()
    const created = store.create({
      harnessId: 'claude',
      name: 'Work',
      config: { model: 'claude-sonnet-4-5' },
    })
    expect(created.isBase).toBe(false)
    expect(created.harnessId).toBe('claude')
    expect(store.get(created.id)?.config).toEqual({ model: 'claude-sonnet-4-5' })

    const updated = store.update(created.id, { name: 'Work Renamed' })
    expect(updated.name).toBe('Work Renamed')

    expect(store.delete(created.id)).toBe(true)
    expect(store.get(created.id)).toBeNull()
  })

  it('rejects base update/delete and unknown harness', () => {
    const store = openStore()
    expect(() => store.update('claude-base', { name: 'x' })).toThrow(/base/)
    expect(() => store.delete('claude-base')).toThrow(/base/)
    expect(() => store.create({ harnessId: 'nope', name: 'x' })).toThrow(/Unknown harness/)
  })

  it("reports the host validator's rejection as invalid_argument", () => {
    const db = new Database(':memory:')
    dbs.push(db)
    const store = createSessionProviderStore(db, {
      validateConfig: () => {
        throw new TypeError('initializeTimeoutMs must be positive')
      },
    })
    expect(() => store.create({ harnessId: 'claude', name: 'x', config: {} })).toThrow(
      expect.objectContaining({ code: 'invalid_argument', message: 'initializeTimeoutMs must be positive' }),
    )
  })

  it('validates and normalizes an agent profile on write', () => {
    const store = openStore()
    const created = store.profiles.create({
      harnessId: 'claude',
      name: 'Reviewer',
      config: { profile: { version: 1, identity: { name: ' Reviewer ', description: 'Reviews diffs.' } } },
    })
    expect(created.config).toEqual({ profile: { version: 1, identity: { name: 'Reviewer', description: 'Reviews diffs.' } } })
    expect(() => store.profiles.create({ harnessId: 'claude', name: 'x', config: { profile: { version: 1, identity: { name: 'x' } } } }))
      .toThrow(expect.objectContaining({ code: 'invalid_argument', message: expect.stringMatching(/identity.description/) }))
    expect(() => store.profiles.update(created.id, { config: { profile: { version: 2 } } }, created))
      .toThrow(expect.objectContaining({ code: 'invalid_argument' }))
  })

  it("refuses another harness's options on a profile", () => {
    const store = openStore()
    const profile = { version: 1, identity: { name: 'Fast', description: 'd' }, runtime: { options: { fastMode: true } } }
    expect(store.profiles.create({ harnessId: 'codex', name: 'Fast', config: { profile } }).config).toEqual({ profile })
    expect(() => store.profiles.create({ harnessId: 'claude', name: 'Fast 2', config: { profile } }))
      .toThrow(expect.objectContaining({ code: 'invalid_argument', message: expect.stringMatching(/fastMode is not a claude setting/) }))
  })

  it('refuses agent profile writes through the client-facing CRUD', () => {
    const store = openStore()
    const profile = { version: 1, identity: { name: 'Reviewer', description: 'Reviews diffs.' }, instructions: 'Never edit.' }
    const refused = expect.objectContaining({ code: 'failed_precondition', message: expect.stringMatching(/agent_profile_apply/) })
    expect(() => store.create({ harnessId: 'claude', name: 'Reviewer', config: { profile } })).toThrow(refused)

    const plain = store.create({ harnessId: 'claude', name: 'Plain', config: {} })
    expect(() => store.update(plain.id, { config: { profile } })).toThrow(refused)

    const row = store.profiles.create({ harnessId: 'claude', name: 'Reviewer', config: { profile } })
    // Dropping the whole profile, renaming it or deleting it are profile changes too.
    expect(() => store.update(row.id, { config: {} })).toThrow(refused)
    expect(() => store.update(row.id, { name: 'Other' })).toThrow(refused)
    expect(() => store.delete(row.id)).toThrow(refused)
    expect(store.get(row.id)?.config).toEqual({ profile })
  })

  it('writes a confirmed profile change only while the row still matches what the user saw', () => {
    const store = openStore()
    const profile = (description: string) => ({ version: 1, identity: { name: 'Reviewer', description } })
    const seen = store.profiles.create({ harnessId: 'claude', name: 'Reviewer', config: { profile: profile('first') } })
    const changed = store.profiles.update(seen.id, { config: { profile: profile('second') } }, seen)

    const stale = expect.objectContaining({ code: 'aborted', message: expect.stringMatching(/changed while waiting/) })
    expect(() => store.profiles.update(seen.id, { config: { profile: profile('third') } }, seen)).toThrow(stale)
    expect(() => store.profiles.delete(seen.id, seen)).toThrow(stale)
    expect(store.get(seen.id)?.config).toEqual({ profile: profile('second') })

    expect(store.profiles.delete(seen.id, changed)).toBe(true)
    expect(store.profiles.delete(seen.id, changed)).toBe(false)
  })

  it('listByHarness filters', () => {
    const store = openStore()
    store.create({ harnessId: 'codex', name: 'extra' })
    const codex = store.listByHarness('codex')
    expect(codex.every((p) => p.harnessId === 'codex')).toBe(true)
    expect(codex.some((p) => p.id === 'codex-base')).toBe(true)
    expect(codex.some((p) => p.name === 'extra')).toBe(true)
  })
})

describe('settingsFromSessionProviderConfig', () => {
  it('maps model/effort/permissionMode/sandboxMode', () => {
    expect(
      settingsFromSessionProviderConfig({
        model: 'claude-sonnet-4-5',
        effort: 'high',
        permissionMode: 'plan',
        sandboxMode: 'auto',
      }),
    ).toEqual({
      model: 'claude-sonnet-4-5',
      effort: 'high',
      permissionMode: 'plan',
      sandboxMode: 'auto',
    })
  })

  it('maps codex reasoningEffort → effort', () => {
    expect(settingsFromSessionProviderConfig({ reasoningEffort: 'xhigh', model: 'gpt-5.2' })).toEqual(
      {
        model: 'gpt-5.2',
        effort: 'xhigh',
      },
    )
  })

  it('takes the runtime from the agent profile alone', () => {
    expect(settingsFromSessionProviderConfig({
      model: 'legacy',
      reasoningEffort: 'low',
      profile: { version: 1, identity: { name: 'R', description: 'd' }, runtime: { model: 'opus', options: { ultracode: true } } },
    })).toEqual({ model: 'opus' })
  })

  it('returns empty for non-objects', () => {
    expect(settingsFromSessionProviderConfig(null)).toEqual({})
    expect(settingsFromSessionProviderConfig('x')).toEqual({})
    expect(settingsFromSessionProviderConfig([])).toEqual({})
  })
})
