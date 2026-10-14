import { describe, expect, it, vi } from 'vitest'
import type { TerminalEvent, TerminalListItem } from '@superone/shared/agent-types'
import type { SessionStreamFrame, TerminalGateway } from '@superone/shared/environment'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import type { TopicRef } from '@superone/shared/environment/topics'
import { NODE_WINDOW_TERMINAL_OWNER, remoteProjectKey, remoteTerminalKey } from '@superone/shared/remote-resource-key'
import { RemoteTerminalController, type RemoteTerminalNode } from './remote-terminal-controller'

/** A node with one tab a phone holds; `streams` are the topic readers opened on it. */
function fakeNode() {
  const streams: Array<{ topics: TopicRef[]; handlers: RpcStreamHandlers; closed: boolean }> = []
  let terminals: TerminalListItem[] = [{ terminalId: 't1', cwd: '/srv/p/sub', projectPath: '/srv/p', title: 'zsh', status: 'running', ownerDeviceId: 'phone-1' }]
  const node: RemoteTerminalNode = {
    environmentId: 'env-b',
    terminals: {} as TerminalGateway,
    rpc: vi.fn(async (method: string) => {
      if (method === 'terminal.list') return { terminals } as never
      if (method === 'terminal.create') return { terminalId: 't2', cwd: '/srv/wt', title: 'wt' } as never
      const ownerDeviceId = terminals[0]?.ownerDeviceId ?? null
      return { snapshot: 'screen', sequence: '3', terminal: { terminalId: 't1', cwd: '/srv/p/sub', title: 'zsh', status: 'running', cols: 80, rows: 24, lastSeq: 3, ownerDeviceId, writableByMe: false, subscriberCount: 0 } } as never
    }),
    follow: vi.fn(async (input, handlers) => {
      const stream = { topics: input.topics, handlers, closed: false }
      streams.push(stream)
      return { close: () => { stream.closed = true }, update: async () => {} }
    }),
  }
  return { node, streams, setTerminals: (next: TerminalListItem[]) => { terminals = next } }
}

const lease = (expiresInMs = 60_000) => ({ leaseId: 'l1', generation: '1', expiresAt: new Date(Date.now() + expiresInMs).toISOString() })
const projectId = async () => 'p1'

/** A tab of the node nobody holds, shown here; `writes` collects what reaches its PTY. */
async function freeTab(gateway: Partial<TerminalGateway> = {}) {
  const fake = fakeNode()
  fake.setTerminals([{ terminalId: 't1', cwd: '/srv/p', title: 'zsh', status: 'running', ownerDeviceId: null }])
  const writes: string[] = []
  fake.node.terminals = {
    acquireControl: vi.fn(async () => lease()),
    releaseControl: vi.fn(async () => {}),
    write: vi.fn(async ({ data }: { data: string }) => { writes.push(data) }),
    ...gateway,
  } as unknown as TerminalGateway
  const events: TerminalEvent[] = []
  const controller = new RemoteTerminalController({ node: () => fake.node, projectId, onEvent: (event) => events.push(event), renewMs: 5 })
  const key = remoteTerminalKey('c', 't1')
  await controller.snapshot(key)
  const output = fake.streams.find((stream) => stream.topics[0].kind === 'terminal')!.handlers
  return { ...fake, controller, key, writes, events, output }
}

describe('RemoteTerminalController', () => {
  it("lists a node's tabs under project keys and keeps them current from its pushed list", async () => {
    const { node, streams } = fakeNode()
    const events: TerminalEvent[] = []
    const watched = vi.fn()
    const controller = new RemoteTerminalController({ node: () => node, projectId, onEvent: (event) => events.push(event), onWatch: watched })

    expect(await controller.list(remoteProjectKey('c', '/srv/p'))).toEqual([expect.objectContaining({
      terminalId: remoteTerminalKey('c', 't1'), cwd: 'remote:c:/srv/p/sub', projectPath: 'remote:c:/srv/p', ownerDeviceId: 'phone-1',
    })])
    expect(watched).toHaveBeenCalledWith('c', true)
    expect(streams.map((stream) => stream.topics)).toEqual([[{ kind: 'terminalList', environmentId: 'env-b' }]])

    const list = streams[0].handlers
    list.onTerminal?.({ type: 'terminal_created', terminalId: 't2', item: { terminalId: 't2', cwd: '/srv/p', title: 'bash', status: 'running', ownerDeviceId: null } })
    list.onTerminal?.({ type: 'terminal_exited', terminalId: 't1', exitCode: 0, signal: null })
    // A tab not shown here still learns its writer from the pushed list.
    list.onTerminal?.({ type: 'terminal_owner_changed', terminalId: 't2', ownerDeviceId: 'phone-2', writableByMe: false })
    expect(events).toEqual([
      { type: 'terminal_created', terminalId: remoteTerminalKey('c', 't2'), item: expect.objectContaining({ terminalId: remoteTerminalKey('c', 't2'), projectPath: 'remote:c:/srv/p' }) },
      { type: 'terminal_exited', terminalId: remoteTerminalKey('c', 't1'), exitCode: 0, signal: null },
      { type: 'terminal_owner_changed', terminalId: remoteTerminalKey('c', 't2'), ownerDeviceId: 'phone-2', writableByMe: false },
    ])
    expect(await controller.list()).toEqual([expect.objectContaining({ terminalId: remoteTerminalKey('c', 't2'), ownerDeviceId: 'phone-2' })])
    expect(node.rpc).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('tells what came, went and changed hands when a list is read again', async () => {
    const { node, streams, setTerminals } = fakeNode()
    const events: TerminalEvent[] = []
    const controller = new RemoteTerminalController({ node: () => node, projectId, onEvent: (event) => events.push(event) })
    setTerminals([
      { terminalId: 't1', cwd: '/srv/p', title: 'zsh', status: 'running', ownerDeviceId: null },
      { terminalId: 't2', cwd: '/srv/p', title: 'zsh', status: 'running', ownerDeviceId: null },
    ])
    await controller.list(remoteProjectKey('c', '/srv/p'))
    expect(events).toEqual([])

    setTerminals([
      { terminalId: 't2', cwd: '/srv/p', title: 'zsh', status: 'running', ownerDeviceId: 'phone-1' },
      { terminalId: 't9', cwd: '/srv/p', title: 'new', status: 'running', ownerDeviceId: null },
    ])
    streams[0].handlers.onFrame({ recover: [{ kind: 'terminalList', environmentId: 'env-b' }] } as unknown as SessionStreamFrame)
    await vi.waitFor(() => expect(events).toEqual([
      { type: 'terminal_exited', terminalId: remoteTerminalKey('c', 't1'), exitCode: null, signal: null },
      { type: 'terminal_owner_changed', terminalId: remoteTerminalKey('c', 't2'), ownerDeviceId: 'phone-1', writableByMe: false },
      { type: 'terminal_created', terminalId: remoteTerminalKey('c', 't9'), item: expect.objectContaining({ terminalId: remoteTerminalKey('c', 't9') }) },
    ]))
    controller.dispose()
  })

  it('opens a terminal by project and session, which the node resolves', async () => {
    const { node } = fakeNode()
    node.terminals = { acquireControl: vi.fn(async () => lease()), releaseControl: vi.fn(async () => {}) } as unknown as TerminalGateway
    const controller = new RemoteTerminalController({ node: () => node, projectId, onEvent: () => {} })
    const item = await controller.create({ projectPath: remoteProjectKey('c', '/srv/p'), sessionId: 's1', cols: 80, rows: 24 })
    expect(node.rpc).toHaveBeenCalledWith('terminal.create', { projectId: 'p1', sessionId: 's1', title: undefined, cols: 80, rows: 24 })
    expect(item).toMatchObject({ terminalId: remoteTerminalKey('c', 't2'), cwd: 'remote:c:/srv/wt', projectPath: 'remote:c:/srv/p', title: 'wt', ownerDeviceId: null })
    controller.dispose()
  })

  it("takes a tab over only on the user's input, not on xterm's own replies", async () => {
    const { controller, key, writes, node } = await freeTab()
    await controller.write(key, '\x1b[I', false)
    expect(node.terminals.acquireControl).not.toHaveBeenCalled()
    await controller.write(key, 'ls\r', true)
    await controller.write(key, '\x1b[O', false)
    expect(writes).toEqual(['ls\r', '\x1b[O'])
    controller.dispose()
  })

  it('stops writing once the node reports another writer', async () => {
    const { controller, key, writes, events, output } = await freeTab()
    await controller.write(key, 'a', true)
    expect(writes).toEqual(['a'])

    // B revoked this desktop and its phone took the tab.
    output.onTerminal?.({ type: 'terminal_owner_changed', terminalId: 't1', ownerDeviceId: 'phone-1', writableByMe: false })
    expect(events.at(-1)).toEqual({ type: 'terminal_owner_changed', terminalId: key, ownerDeviceId: 'phone-1', writableByMe: false })
    await controller.write(key, 'b', true)
    expect(writes).toEqual(['a'])
    controller.dispose()
  })

  it("yields a tab the node's window took back, but not one whose lease ran out", async () => {
    const live = await freeTab()
    await live.controller.write(live.key, 'a', true)
    live.output.onTerminal?.({ type: 'terminal_owner_changed', terminalId: 't1', ownerDeviceId: null, writableByMe: false })
    expect(live.events.at(-1)).toEqual({ type: 'terminal_owner_changed', terminalId: live.key, ownerDeviceId: NODE_WINDOW_TERMINAL_OWNER, writableByMe: false })
    await live.controller.write(live.key, 'b', true)
    expect(live.writes).toEqual(['a'])
    live.controller.dispose()

    // This desktop slept past its lease: nobody holds the tab, so typing takes it again.
    const renewControl = vi.fn(async () => { throw Object.assign(new Error('stale'), { code: 'lease_stale' }) })
    const slept = await freeTab({ acquireControl: vi.fn(async () => lease(-1)), renewControl })
    await slept.controller.write(slept.key, 'a', true)
    await slept.controller.write(slept.key, 'b', true)
    expect(renewControl).toHaveBeenCalled()
    expect(slept.writes).toEqual(['a', 'b'])
    expect(slept.events).not.toContainEqual(expect.objectContaining({ type: 'terminal_owner_changed', ownerDeviceId: NODE_WINDOW_TERMINAL_OWNER }))
    slept.controller.dispose()
  })

  it('closes a tab the node no longer has without keeping its lease', async () => {
    const renewControl = vi.fn(async () => lease())
    const kill = vi.fn(async () => { throw Object.assign(new Error('gone'), { code: 'not_found' }) })
    // A lease this short is renewed on every tick while held.
    const { controller, key, events } = await freeTab({ acquireControl: vi.fn(async () => lease(10_000)), kill, renewControl })
    await controller.kill(key)
    expect(kill).toHaveBeenCalled()
    expect(events.at(-1)).toEqual({ type: 'terminal_exited', terminalId: key, exitCode: null, signal: null })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(renewControl).not.toHaveBeenCalled()
    expect(await controller.list()).toEqual([])
    controller.dispose()
  })

  it('follows a shown tab again once its node is back', async () => {
    const { node, streams } = fakeNode()
    const controller = new RemoteTerminalController({ node: () => node, projectId, onEvent: () => {} })
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
