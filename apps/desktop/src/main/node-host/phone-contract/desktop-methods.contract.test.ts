import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionEnvironmentDescriptor } from '@superone/shared/environment'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))
vi.mock('../../remote/mobile-log', () => ({ appendMobileLog: (deviceId: string, entries: unknown[]) => (deviceId === 'phone-1' ? entries.length : -1) }))
vi.mock('../../session/history-navigation', () => ({ loadSessionHistoryIndex: (sessionId: string) => ({ sessionId, turns: [] }) }))

import { createPhoneMethods, type PhoneMethodHost } from '../../remote/phone-methods'
import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

function methodsDomain() {
  const agent = {
    remoteSystemInfo: vi.fn(async (projectPath: string, provider: string) => ({ projectPath, provider, models: [] })),
    remoteProjectResources: vi.fn(async (projectPath: string) => ({ cwd: projectPath })),
    remoteHarnessOptions: vi.fn(async () => ({ options: [{ key: 'claude', provider: 'claude', acpAgentId: null, label: 'Claude' }] })),
    remoteAttachment: vi.fn(() => undefined),
    remoteSessionActivity: vi.fn(() => []),
    remoteSearchMentions: vi.fn(async () => ({ results: [] })),
    remoteSearchMcpMentions: vi.fn(async () => ({ results: [] })),
    remoteReadMcpMentions: vi.fn(async () => ({ resources: [] })),
    remoteMcpServers: vi.fn(async () => ({ servers: [] })),
    markRemoteSeen: vi.fn(),
  }
  const desktopPair = vi.fn(async () => ({ code: 'abc' }))
  const host = { agent, desktopPair } as unknown as PhoneMethodHost
  return { ...phoneDomain(cleanup, { phoneMethods: createPhoneMethods(host) }), agent, desktopPair }
}

describe('phone endpoint: desktop methods', () => {
  it('advertises them to phones and resolves projects and sessions by id', async () => {
    const { domain, agent, projectDir } = methodsDomain()
    const phone = await connectPhone(domain)
    const { capabilities } = await phone.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(capabilities.methods).toEqual(expect.arrayContaining(['harness.systemInfo', 'sessionList.page', 'client.markSeen', 'client.pairNode']))

    expect(await phone.rpc('harness.systemInfo', { projectId: 'p1', harnessId: 'codex' })).toEqual({ projectPath: projectDir, provider: 'codex', models: [] })
    await expect(phone.rpc('harness.systemInfo', { projectId: 'nope', harnessId: 'codex' })).rejects.toMatchObject({ code: 'not_found' })
    await phone.rpc('client.markSeen', { sessionId: 'own' })
    expect(agent.markRemoteSeen).toHaveBeenCalledWith('own')
    await expect(phone.rpc('client.markSeen', { sessionId: 'missing' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('answers client-scoped methods for the asking phone', async () => {
    const { domain, desktopPair } = methodsDomain()
    const phone = await connectPhone(domain)
    expect(await phone.rpc('client.appendLog', { entries: [{ m: 1 }, { m: 2 }] })).toEqual({ written: 2 })
    expect(await phone.rpc('client.mintNodeCode', { controllerName: 'iPhone' })).toEqual({ code: 'abc' })
    expect(desktopPair).toHaveBeenCalledWith({ kind: 'mint', controllerName: 'iPhone' })
    await expect(phone.rpc('client.pairNode', { nodeCode: 'x' })).rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('reads a session history index and refuses a gone attachment', async () => {
    const { domain } = methodsDomain()
    const phone = await connectPhone(domain)
    expect(await phone.rpc('session.historyIndex', { sessionId: 'own' })).toEqual({ sessionId: 'own', turns: [] })
    await expect(phone.rpc('session.attachment', { sessionId: 'own', messageId: 'm', name: 'a.png' })).rejects.toMatchObject({ code: 'not_found' })
  })
})
