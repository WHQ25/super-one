import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DetailUpdate } from '@superone/shared/environment/detail'
import type { ExecutionEnvironmentDescriptor, SupervisorSnapshot } from '@superone/shared/environment'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'

vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: { getPath: () => tmpdir() },
}))

import { EnvironmentHost } from './environment-host'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'
import { EnvironmentRpcClient, type TopicStream } from './environment-rpc-client'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Socket the gateway's event stream and ordinary RPCs share. */
class FakeNodeClient extends EnvironmentRpcClient {
  readonly tier = 'lan' as const
  socketOpen = true
  /** Non-transport subscribe failures left. The gateway does not retry these. */
  failSubscribe = 0
  subscribeCount = 0
  readonly sends: string[] = []
  private enders: Array<(err: Error) => void> = []

  drop(err: Error): void {
    const enders = this.enders.splice(0)
    for (const end of enders) end(err)
  }

  async rpc<T>(method: string, payload: unknown = {}): Promise<T> {
    if (!this.socketOpen) throw Object.assign(new Error('not connected'), { transport: true, code: 'unavailable' })
    if (method === 'session.snapshot') return { snapshotSequence: '4' } as T
    if (method === 'session.load') {
      return { sessionId: 's', messages: [], state: {}, before: null, cursor: { version: 4, sequence: '4', epoch: 'e' } } as T
    }
    if (method === 'session.get') return { sessionId: 's', status: 'idle' } as T
    if (method === 'session.send') {
      this.sends.push(typeof payload === 'object' && payload && 'text' in payload ? String((payload as { text?: unknown }).text ?? '') : '')
      return undefined as T
    }
    if (method === 'session.acquireControl' || method === 'session.renewControl') {
      return { leaseId: 'lease', generation: '1', expiresAt: Date.now() + 60_000 } as T
    }
    if (method === 'project.list') return [] as T
    return {} as T
  }

  getDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
    return Promise.reject(new Error('unused'))
  }

  async subscribeEvents(_input: unknown, handlers: RpcStreamHandlers): Promise<TopicStream> {
    this.subscribeCount += 1
    if (this.failSubscribe > 0) {
      this.failSubscribe -= 1
      throw new Error('protocol')
    }
    if (!this.socketOpen) throw Object.assign(new Error('not connected'), { transport: true, code: 'unavailable' })
    let ended = false
    const end = (err: Error) => {
      if (ended) return
      ended = true
      handlers.onEnd(err)
    }
    this.enders.push(end)
    return { close: () => { ended = true }, update: async () => {} }
  }

  subscribeDetail(): Promise<DetailUpdate> {
    return Promise.reject(new Error('unused'))
  }

  async unsubscribeDetail(): Promise<void> {}
}

interface HostInternals {
  resolveRemote: (connectionId: string) => { gateway: RemoteEnvironmentGateway; environmentId: string; connectionId: string }
  resolveSession: (connectionId: string) => { gateway: RemoteEnvironmentGateway; environmentId: string; local: boolean }
  lastStatus: Map<string, SupervisorSnapshot>
  publishStatus: (snapshot: SupervisorSnapshot) => void
  sessionFeeds: Map<string, { hasFailed(): boolean }>
}

const CONNECTION = 'mini'
const ENV = 'env-1'
const SESSION = { sessionId: 's', projectPath: 'remote:mini:/proj' }

function connected(generation: number): SupervisorSnapshot {
  return { environmentId: ENV, connectionId: CONNECTION, state: 'connected', attempt: 1, generation }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'eh-feed-'))
  dirs.push(dir)
  const host = new EnvironmentHost(dir)
  const client = new FakeNodeClient()
  const gateway = new RemoteEnvironmentGateway(client)
  const raw = host as unknown as HostInternals
  raw.resolveRemote = () => ({ gateway, environmentId: ENV, connectionId: CONNECTION })
  raw.resolveSession = () => ({ gateway, environmentId: ENV, local: false })
  const resyncs: Array<{ connectionId: string; sessionId: string; projectPath?: string }> = []
  host.onRemoteSessionResync((target) => resyncs.push(target))
  return { host, client, raw, gateway, resyncs }
}

describe('remote session feed after the node returns', () => {
  it('reads the metadata beside the window when the connected host predates window headers', async () => {
    const { host, gateway } = setup()
    gateway.rememberDescriptor({ environmentId: ENV, capabilities: { methods: ['session.transcriptWindow'] } } as ExecutionEnvironmentDescriptor)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const read = vi.spyOn(gateway.sessions, 'transcriptWindow').mockImplementation(async () => {
      await gate
      return { sessionId: 's', schema: 1, messages: [], older: null, newer: null, total: 0,
        cursor: { version: 4, sequence: '4', epoch: 'e' }, state: {} }
    })
    const row = vi.spyOn(gateway.sessions, 'get')
    const opening = host.openRemoteSession(CONNECTION, { ...SESSION, transcript: true })
    try {
      await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
      expect(row).toHaveBeenCalledWith({ environmentId: ENV, sessionId: 's' }, { includeTranscript: false })
    } finally { release() }
    await expect(opening).resolves.toMatchObject({ sessionRow: { sessionId: 's', status: 'idle' } })
  })

  it('subscribes and sends again after the stream died with not connected', async () => {
    const { host, client, raw, resyncs } = setup()

    await host.resumeRemoteSessionEvents(CONNECTION, SESSION)
    expect(client.subscribeCount).toBe(1)

    raw.lastStatus.set(CONNECTION, {
      environmentId: ENV,
      connectionId: CONNECTION,
      state: 'offline',
      attempt: 1,
      generation: 1,
      lastError: 'network offline',
    })
    client.socketOpen = false
    client.drop(new Error('not connected'))
    await vi.waitFor(() => expect(raw.sessionFeeds.get(CONNECTION)?.hasFailed()).toBe(true))

    // Ordinary reads use RPC. Open and send still wait on the dead stream.
    client.socketOpen = true
    await expect(host.getSession(CONNECTION, 's')).resolves.toMatchObject({ sessionId: 's', status: 'idle' })
    const subscribesWhileDead = client.subscribeCount
    await expect(host.openRemoteSession(CONNECTION, SESSION)).rejects.toThrow('not connected')
    await expect(host.sendSessionMessage(CONNECTION, { ...SESSION, text: 'hello', clientMessageId: 'm1' })).rejects.toThrow('not connected')
    expect(client.sends).toEqual([])
    expect(client.subscribeCount).toBe(subscribesWhileDead)

    raw.publishStatus({
      environmentId: ENV,
      connectionId: CONNECTION,
      state: 'connected',
      attempt: 1,
      generation: 2,
    })
    expect(resyncs).toEqual([{ connectionId: CONNECTION, sessionId: 's', projectPath: SESSION.projectPath }])
    await expect(host.openRemoteSession(CONNECTION, SESSION)).resolves.toMatchObject({ cursor: { version: 4 } })
    await expect(host.sendSessionMessage(CONNECTION, { ...SESSION, text: 'hello', clientMessageId: 'm1' })).resolves.toMatchObject({ sessionId: 's' })
    expect(client.sends).toEqual(['hello'])
    expect(client.subscribeCount).toBeGreaterThan(subscribesWhileDead)
    expect(client.subscribeCount).toBeLessThan(6)
    host.dispose()
  })

  it('replaces a feed that dies while the node is still connected, and does not keep resubscribing', async () => {
    const { host, client, raw } = setup()
    raw.lastStatus.set(CONNECTION, connected(4))
    client.failSubscribe = 1
    // The follow returns when the topic is accepted. The subscribe rejection lands after that.
    await host.resumeRemoteSessionEvents(CONNECTION, SESSION)
    await vi.waitFor(() => {
      expect(client.subscribeCount).toBeGreaterThanOrEqual(2)
      expect(raw.sessionFeeds.get(CONNECTION)?.hasFailed()).toBe(false)
    })
    const afterRebuild = client.subscribeCount
    await expect(host.sendSessionMessage(CONNECTION, { ...SESSION, text: 'again', clientMessageId: 'm2' })).resolves.toMatchObject({ sessionId: 's' })
    expect(client.sends).toEqual(['again'])
    await new Promise((resolve) => setTimeout(resolve, 20))
    // The automatic replacement is one extra subscribe. It must not spin.
    expect(client.subscribeCount).toBe(afterRebuild)
    expect(afterRebuild).toBeLessThanOrEqual(3)
    host.dispose()
  })
})
