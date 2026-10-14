import { describe, expect, it, vi } from 'vitest'
import type { TerminalEvent, TerminalListItem } from '@superone/shared/agent-types'
import type { TerminalGateway } from '@superone/shared/environment'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import type { TopicRef } from '@superone/shared/environment/topics'
import { remoteProjectKey, remoteTerminalKey } from '@superone/shared/remote-resource-key'
import { RemoteTerminalController, type RemoteTerminalNode } from './remote-terminal-controller'

/** A node with one tab a phone holds; `streams` are the topic readers opened on it. */
function fakeNode() {
  const streams: Array<{ topics: TopicRef[]; handlers: RpcStreamHandlers; closed: boolean }> = []
  const terminals: TerminalListItem[] = [{ terminalId: 't1', cwd: '/srv/p/sub', projectPath: '/srv/p', title: 'zsh', status: 'running', ownerDeviceId: 'phone-1' }]
  const node: RemoteTerminalNode = {
    environmentId: 'env-b',
    terminals: {} as TerminalGateway,
    rpc: vi.fn(async (method: string) => {
      if (method === 'terminal.list') return { terminals } as never
      return { snapshot: 'screen', sequence: '3', terminal: { terminalId: 't1', cwd: '/srv/p/sub', title: 'zsh', status: 'running', cols: 80, rows: 24, lastSeq: 3, ownerDeviceId: 'phone-1', writableByMe: false, subscriberCount: 0 } } as never
    }),
    follow: vi.fn(async (input, handlers) => {
      const stream = { topics: input.topics, handlers, closed: false }
      streams.push(stream)
      return { close: () => { stream.closed = true }, update: async () => {} }
    }),
  }
  return { node, streams }
}

describe('RemoteTerminalController', () => {
  it("lists a node's tabs under project keys and keeps them current from its pushed list", async () => {
    const { node, streams } = fakeNode()
    const events: TerminalEvent[] = []
    const watched = vi.fn()
    const controller = new RemoteTerminalController({ node: () => node, onEvent: (event) => events.push(event), onWatch: watched })

    expect(await controller.list(remoteProjectKey('c', '/srv/p'))).toEqual([expect.objectContaining({
      terminalId: remoteTerminalKey('c', 't1'), cwd: 'remote:c:/srv/p/sub', projectPath: 'remote:c:/srv/p', ownerDeviceId: 'phone-1',
    })])
    expect(watched).toHaveBeenCalledWith('c', true)
    expect(streams.map((stream) => stream.topics)).toEqual([[{ kind: 'terminalList', environmentId: 'env-b' }]])

    const list = streams[0].handlers
    list.onTerminal?.({ type: 'terminal_created', terminalId: 't2', item: { terminalId: 't2', cwd: '/srv/p', title: 'bash', status: 'running', ownerDeviceId: null } })
    list.onTerminal?.({ type: 'terminal_exited', terminalId: 't1', exitCode: 0, signal: null })
    expect(events).toEqual([
      { type: 'terminal_created', terminalId: remoteTerminalKey('c', 't2'), item: expect.objectContaining({ terminalId: remoteTerminalKey('c', 't2'), projectPath: 'remote:c:/srv/p' }) },
      { type: 'terminal_exited', terminalId: remoteTerminalKey('c', 't1'), exitCode: 0, signal: null },
    ])
    expect((await controller.list()).map((item) => item.terminalId)).toEqual([remoteTerminalKey('c', 't2')])
    expect(node.rpc).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('stops writing once the node reports another writer', async () => {
    const { node, streams } = fakeNode()
    const writes: string[] = []
    node.terminals = {
      acquireControl: vi.fn(async () => ({ leaseId: 'l1', generation: '1', expiresAt: new Date(Date.now() + 60_000).toISOString() })),
      write: vi.fn(async ({ data }: { data: string }) => { writes.push(data) }),
    } as unknown as TerminalGateway
    const events: TerminalEvent[] = []
    const controller = new RemoteTerminalController({ node: () => node, onEvent: (event) => events.push(event) })
    const key = remoteTerminalKey('c', 't1')
    await controller.snapshot(key)
    const output = streams.find((stream) => stream.topics[0].kind === 'terminal')!.handlers
    output.onTerminal?.({ type: 'terminal_owner_changed', terminalId: 't1', ownerDeviceId: null, writableByMe: false })
    await controller.write(key, 'a')
    expect(writes).toEqual(['a'])

    // B revoked this desktop and its phone took the tab.
    output.onTerminal?.({ type: 'terminal_owner_changed', terminalId: 't1', ownerDeviceId: 'phone-1', writableByMe: false })
    expect(events.at(-1)).toEqual({ type: 'terminal_owner_changed', terminalId: key, ownerDeviceId: 'phone-1', writableByMe: false })
    await controller.write(key, 'b')
    expect(writes).toEqual(['a'])
    controller.dispose()
  })

  it('follows a shown tab again once its node is back', async () => {
    const { node, streams } = fakeNode()
    const controller = new RemoteTerminalController({ node: () => node, onEvent: () => {} })
    const key = remoteTerminalKey('c', 't1')
    expect(await controller.snapshot(key)).toMatchObject({ terminalId: key, ownerDeviceId: 'phone-1', writableByMe: false })

    const lost = new Error('node stream closed')
    for (const stream of streams) stream.handlers.onEnd(lost)
    controller.resume('c')
    await vi.waitFor(() => expect(streams.filter((stream) => stream.topics[0].kind === 'terminal')).toHaveLength(2))
    expect(streams.filter((stream) => stream.topics[0].kind === 'terminalList')).toHaveLength(2)
    controller.dispose()
  })
})
