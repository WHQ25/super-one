import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ClaudeAccount } from '@superone/shared/agent-types'

const listNodeClaudeAccounts = vi.hoisted(() => vi.fn(async () => [] as ClaudeAccount[]))

vi.mock('../session/claude-accounts', () => ({
  listNodeClaudeAccounts,
}))

import { dispatchRpc, type RpcContext } from './handlers'
import type { AuthenticatedClient } from '../auth/auth-service'

const dirs: string[] = []

afterEach(() => {
  listNodeClaudeAccounts.mockReset()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const account = {
  credentialDir: '/node/a',
  loggedIn: true,
  isDefault: true,
  email: 'node@example.com',
  identityKey: 'node|org',
  orgId: 'org',
  orgName: 'Node',
  subscriptionType: 'max',
  projectsDirectory: null,
} as ClaudeAccount

function client(scopes: AuthenticatedClient['scopes']): AuthenticatedClient {
  return {
    clientSessionId: 'c1',
    deviceId: 'd1',
    scopes,
    pairedAt: Date.now(),
  } as unknown as AuthenticatedClient
}

function ctx(scopes: AuthenticatedClient['scopes']): RpcContext {
  const dir = mkdtempSync(join(tmpdir(), 'claude-accounts-'))
  dirs.push(dir)
  return {
    client: client(scopes),
    settingsConfigPath: join(dir, 'config.json'),
  } as unknown as RpcContext
}

describe('claude.listAccounts', () => {
  it('returns the node accounts and refuses a client that cannot read the environment', async () => {
    listNodeClaudeAccounts.mockResolvedValue([account])

    const allowed = await dispatchRpc('claude.listAccounts', { force: true }, ctx(['environment:read']))
    expect(listNodeClaudeAccounts).toHaveBeenCalledWith(true)
    expect(allowed.result).toEqual([account])

    const denied = await dispatchRpc('claude.listAccounts', {}, ctx([]))
    expect(denied.error).toMatchObject({ code: 'forbidden' })
  })
})
