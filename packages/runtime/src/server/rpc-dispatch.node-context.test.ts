import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EnvironmentLiveStatus, ExecutionEnvironmentDescriptor } from '@superone/shared/environment'
import type { NodeSessionRecord } from '../session/index'
import { dispatchRpc } from './rpc-dispatch'
import type { RpcContext, SessionHostPort } from './rpc-context'
import type { NodeIdentity } from './identity'

const machine = { os: 'macOS 26.0', cpuModel: 'Apple M3 Max', cpuCores: 16, memoryBytes: 64 * 2 ** 30, gpus: ['Apple M3 Max'], toolchains: [{ name: 'git', version: '2.50.1' }] }
vi.mock('../machine/index', async (importOriginal) => ({ ...(await importOriginal<object>()), getMachineInfo: async () => machine }))
const readSubscriptionUsage = vi.hoisted(() => vi.fn(async () => [{ harness: 'codex', account: null, planType: 'Pro 100', windows: [] }]))
vi.mock('../usage/index', () => ({ readSubscriptionUsage }))

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function host(over: Partial<RpcContext> = {}): RpcContext {
  const dir = mkdtempSync(join(tmpdir(), 'node-context-'))
  dirs.push(dir)
  return {
    client: { clientSessionId: 'c1', scopes: ['environment:read'], devicePublicKeyFingerprint: 'fp', devicePublicKeyPem: 'pem' },
    identity: { environmentId: 'env-1', label: 'B', publicKeyFingerprint: 'fp' } as NodeIdentity,
    idempotency: { payloadHash: () => 'h', runExclusive: (_c, _o, _k, _h, execute) => execute() },
    leases: {} as RpcContext['leases'],
    settingsConfigPath: join(dir, 'config.json'),
    hooks: { isCodexBinaryOverrideRunnable: () => false, isClaudeBinaryOverrideRunnable: () => false, resolveReleaseVersion: () => '1.0.0' } as unknown as RpcContext['hooks'],
    capabilities: { coldSessionResume: false, turnReattach: false, hostActionV1: false },
    startedAt: 0,
    ...over,
  }
}

describe('node context for scheduling', () => {
  it('puts machine facts in the descriptor', async () => {
    const descriptor = (await dispatchRpc('environment.descriptor', {}, host())).result as ExecutionEnvironmentDescriptor
    expect(descriptor.machine).toEqual(machine)
  })

  it('reports free memory', async () => {
    const status = (await dispatchRpc('environment.status', {}, host())).result as EnvironmentLiveStatus
    expect(status.freeMemoryBytes).toBeGreaterThan(0)
  })

  it('requires environment:read', async () => {
    const ctx = host()
    ctx.client = { ...ctx.client, scopes: [] }
    expect((await dispatchRpc('environment.status', {}, ctx)).error?.code).toBe('forbidden')
    expect((await dispatchRpc('environment.usage', {}, ctx)).error?.code).toBe('forbidden')
  })

  it('reads subscription usage with the host\'s Claude accounts, or the default login without them', async () => {
    const accounts = [{ credentialDir: '/a', label: 'me@example.com' }]
    const result = await dispatchRpc('environment.usage', { force: true }, host({ subscriptionUsage: { claudeAccounts: async () => accounts } }))
    expect(result.result).toEqual({ accounts: [{ harness: 'codex', account: null, planType: 'Pro 100', windows: [] }] })
    expect(readSubscriptionUsage).toHaveBeenLastCalledWith({ claudeAccounts: accounts, force: true, log: undefined })
    await dispatchRpc('environment.usage', {}, host())
    expect(readSubscriptionUsage).toHaveBeenLastCalledWith({ claudeAccounts: undefined, force: false, log: undefined })
  })
})
