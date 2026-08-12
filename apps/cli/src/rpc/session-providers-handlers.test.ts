import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { createSessionProviderStore } from '@superone/runtime/session'
import { dispatchSessionProviderRpc } from './session-provider-handlers'
import type { AuthenticatedClient } from '../auth/auth-service'

const dirs: string[] = []
const dbs: Database.Database[] = []

afterEach(() => {
  while (dbs.length) {
    try {
      dbs.pop()?.close()
    } catch {
      /* ignore */
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function client(scopes: AuthenticatedClient['scopes']): AuthenticatedClient {
  return {
    clientSessionId: 'c1',
    deviceId: 'd1',
    scopes,
    pairedAt: Date.now(),
  } as AuthenticatedClient
}

function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'sp-rpc-'))
  dirs.push(dir)
  const db = new Database(join(dir, 'state.sqlite'))
  dbs.push(db)
  const sessionProviders = createSessionProviderStore(db)
  return {
    sessionProviders,
    admin: {
      client: client(['environment:read', 'node:admin']),
      sessionProviders,
    },
    reader: {
      client: client(['environment:read']),
      sessionProviders,
    },
  }
}

describe('sessionProviders RPC', () => {
  it('list returns seeded base profiles', () => {
    const { admin } = boot()
    const res = dispatchSessionProviderRpc('sessionProviders.list', {}, admin)
    expect(res?.error).toBeUndefined()
    const providers = (res?.result as { providers: Array<{ id: string }> }).providers
    expect(providers.map((p) => p.id).sort()).toEqual([
      'acp-base',
      'claude-base',
      'codex-base',
      'cursor-base',
      'opencode-base',
    ])
  })

  it('CRUD create/update/delete custom profile', () => {
    const { admin } = boot()
    const created = dispatchSessionProviderRpc(
      'sessionProviders.create',
      { harnessId: 'claude', name: 'Team', config: { model: 'x' } },
      admin,
    )
    expect(created?.error).toBeUndefined()
    const provider = (created?.result as { provider: { id: string; config: unknown } }).provider
    const id = provider.id
    expect(provider.config).toEqual({ model: 'x' })

    const updated = dispatchSessionProviderRpc(
      'sessionProviders.update',
      { id, name: 'Team 2', config: { model: 'y', effort: 'high' } },
      admin,
    )
    expect((updated?.result as { provider: { name: string } }).provider.name).toBe('Team 2')

    const got = dispatchSessionProviderRpc('sessionProviders.get', { id }, admin)
    const roundTrip = (got?.result as { provider: { name: string; config: unknown } }).provider
    expect(roundTrip.name).toBe('Team 2')
    expect(roundTrip.config).toEqual({ model: 'y', effort: 'high' })

    const del = dispatchSessionProviderRpc('sessionProviders.delete', { id }, admin)
    expect(del?.result).toEqual({ ok: true })
  })

  it('getBase returns claude-base', () => {
    const { reader } = boot()
    const res = dispatchSessionProviderRpc(
      'sessionProviders.getBase',
      { harnessId: 'claude' },
      reader,
    )
    expect((res?.result as { provider: { id: string } }).provider.id).toBe('claude-base')
  })

  it('create requires node:admin', () => {
    const { reader } = boot()
    const res = dispatchSessionProviderRpc(
      'sessionProviders.create',
      { harnessId: 'claude', name: 'nope' },
      reader,
    )
    expect(res?.error?.code).toBe('forbidden')
  })
})
