import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentIpcChannels, type TerminalEvent, type TerminalListItem, type TerminalSnapshot } from '@superone/shared/agent-types'
import type { ControlLease } from '@superone/shared/environment'
import { registerTerminalIpc, type TerminalIpcDeps } from '../../terminal/terminal-ipc'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { TerminalManager } from '../../terminal/terminal-manager'
import type { PtyLike } from '../../terminal/pty'
import { createDesktopTerminalsPort } from '../desktop-terminals-port'
import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'
import { encryptedPhone } from '../encrypted-phone-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

/** A domain whose terminal port runs over a manager with scripted PTYs. */
function terminalsDomain() {
  const output = new Map<string, (data: string) => void>()
  let lastData: ((data: string) => void) | null = null
  const writes: string[] = []
  const listeners = new Set<(event: TerminalEvent) => void>()
  const manager = new TerminalManager({
    spawner: {
      spawn: (): PtyLike => ({
        write: (data) => writes.push(data), resize: () => {}, kill: () => {}, onExit: () => {}, foregroundProcess: () => 'zsh',
        onData: (cb) => { lastData = cb },
      }),
    },
    onEvent: (event) => { for (const listener of listeners) listener(event) },
    exists: () => true,
    coalesceMs: 0,
  })
  const terminals = createDesktopTerminalsPort(manager, (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  })
  const open = (cwd: string) => {
    const term = manager.create({ cwd })
    output.set(term.terminalId, lastData!)
    return { terminalId: term.terminalId, emit: (data: string) => output.get(term.terminalId)!(data) }
  }
  const host = phoneDomain(cleanup, { terminals, bindLocalControl: (authority) => manager.bindLeases(authority) })
  cleanup.push(() => manager.killAll())
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>()
  registerTerminalIpc({
    ipc: { handle: (channel, handler) => { handlers.set(channel, handler) } }, manager,
    remote: { has: () => false, list: () => [] } as unknown as TerminalIpcDeps['remote'],
    resolveCwd: (path) => path, ensureShellPath: async () => {}, ensureControl: async () => {},
  })
  const ipc = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: { id: 42 } } as IpcMainInvokeEvent, ...args)
  return { ...host, open, manager, writes, ipc }
}

describe('phone endpoint: terminals', () => {
  it.each(['lan', 'relay'] as const)('follows native terminal output through the real encrypted phone client over %s', async route => {
    const { domain, open, projectDir, writes } = terminalsDomain()
    const term = open(projectDir)
    term.emit('before\r\n')
    const client = await encryptedPhone(cleanup, domain, route, 'native')
    const ref = { environmentId: domain.identity.environmentId, terminalId: term.terminalId }
    await client.acquireControl(ref)
    const events: TerminalEvent[] = []
    const end = vi.fn()
    const stream = client.followTerminal(ref, event => events.push(event), end)
    await stream.ready
    expect(events).toContainEqual(expect.objectContaining({ type: 'terminal_snapshot', ansi: expect.stringContaining('before'), snapshot: expect.objectContaining({ writableByMe: true }) }))
    term.emit('after')
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'terminal_output', data: 'after' })))
    const hidden = open(projectDir)
    hidden.emit('hidden')
    await client.controlledRpc(ref, 'terminal.write', { data: 'ls\r' })
    expect(writes).toEqual(['ls\r'])
    expect(events.some(event => event.type === 'terminal_output' && event.data === 'hidden')).toBe(false)
    await stream.refresh()
    expect(events.at(-1)).toMatchObject({ type: 'terminal_snapshot', ansi: expect.stringContaining('after') })
    await stream.close()
    await client.releaseControl(ref)
    expect(domain.leases.get(ref)).toBeNull()
    await expect(client.controlledRpc(ref, 'terminal.write', { data: 'retired' })).rejects.toMatchObject({ code: 'lease_required' })
    expect(end).not.toHaveBeenCalled()
  })

  it('lists, attaches and pushes a followed terminal from its attach sequence', async () => {
    const { domain, open, projectDir } = terminalsDomain()
    const term = open(projectDir)
    term.emit('before\r\n')
    const phone = await connectPhone(domain)

    const { terminals } = await phone.rpc<{ terminals: TerminalListItem[] }>('terminal.list')
    expect(terminals.map((t) => t.terminalId)).toEqual([term.terminalId])
    const attached = await phone.rpc<{ snapshot: string; sequence: string }>('terminal.attach', { terminalId: term.terminalId })
    expect(attached.snapshot).toContain('before')

    const environmentId = domain.identity.environmentId
    const { snapshotSequence } = await phone.rpc<{ snapshotSequence: string }>('session.snapshot')
    await phone.rpc('topic.subscribe', {
      subscriptionId: 't', afterSequence: snapshotSequence,
      topics: [{ kind: 'terminal', environmentId, terminalId: term.terminalId }, { kind: 'terminalList', environmentId }],
    })
    term.emit('after')
    await vi.waitFor(() => expect(phone.pushes).toContainEqual(expect.objectContaining({
      type: 'terminal', subscriptionId: 't',
      event: expect.objectContaining({ type: 'terminal_output', data: 'after', fromSeq: Number(attached.sequence) + 1 }),
    })))

    // The list topic sees new tabs; a terminal nobody follows sends no output.
    const second = open(projectDir)
    second.emit('unseen')
    await vi.waitFor(() => expect(phone.pushes).toContainEqual(expect.objectContaining({
      event: expect.objectContaining({ type: 'terminal_created', terminalId: second.terminalId }),
    })))
    expect(phone.pushes.some((m) => (m.event as TerminalEvent | undefined)?.type === 'terminal_output' && (m.event as { terminalId: string }).terminalId === second.terminalId)).toBe(false)
  })

  it('refuses terminal input without a fenced lease', async () => {
    const { domain, open, projectDir } = terminalsDomain()
    const term = open(projectDir)
    const phone = await connectPhone(domain)
    await expect(phone.rpc('terminal.write', { terminalId: term.terminalId, data: 'ls\r' })).rejects.toMatchObject({ code: 'lease_required' })
  })

  it.each(['lan', 'relay'] as const)('fences two authenticated phones and a desktop window over %s', async (transport) => {
    const { domain, open, projectDir, writes, ipc } = terminalsDomain()
    const { terminalId } = open(projectDir)
    const a = await connectPhone(domain, { deviceId: 'a', transport })
    const b = await connectPhone(domain, { deviceId: 'b', transport })
    cleanup.push(a.close, b.close)
    const payload = (lease: ControlLease) => ({ terminalId, leaseId: lease.leaseId, generation: lease.generation })
    const resource = { environmentId: domain.identity.environmentId, terminalId }
    await ipc(AgentIpcChannels.TERMINAL_WRITE, terminalId, 'window\r')
    const window = domain.leases.get(resource)!
    const topics = [{ kind: 'terminal', ...resource }]
    const { snapshotSequence } = await a.rpc<{ snapshotSequence: string }>('session.snapshot')
    for (const phone of [a, b]) await phone.rpc('topic.subscribe', { subscriptionId: 't', topics, afterSequence: snapshotSequence })
    const lease = await a.rpc<ControlLease>('terminal.acquireControl', { terminalId, delegate: 'phone:b', yields: true })
    expect(lease.delegate).toBe('phone:a')
    expect(() => domain.leases.assertValid(window)).toThrow('stale lease')
    await vi.waitFor(() => {
      expect(a.pushes).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ type: 'terminal_owner_changed', ownerDeviceId: 'a', writableByMe: true }) }))
      expect(b.pushes).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ type: 'terminal_owner_changed', ownerDeviceId: 'a', writableByMe: false }) }))
    })
    const attached = await a.rpc<{ terminal: TerminalSnapshot }>('terminal.attach', { terminalId })
    expect(attached.terminal.writableByMe).toBe(true)
    await a.rpc('terminal.write', { ...payload(lease), data: 'phone\r' })
    await expect(b.rpc('terminal.write', { ...payload(lease), data: 'stolen\r' })).rejects.toMatchObject({ code: 'lease_stale' })
    await expect(b.rpc('terminal.acquireControl', { terminalId, delegate: 'phone:a' })).rejects.toMatchObject({ code: 'failed_precondition' })
    await expect(ipc(AgentIpcChannels.TERMINAL_WRITE, terminalId, 'blocked\r')).rejects.toMatchObject({ code: 'failed_precondition' })
    await expect(ipc(AgentIpcChannels.TERMINAL_RESIZE, terminalId, 100, 30)).rejects.toMatchObject({ code: 'failed_precondition' })
    await expect(ipc(AgentIpcChannels.TERMINAL_KILL, terminalId)).rejects.toMatchObject({ code: 'failed_precondition' })
    await ipc(AgentIpcChannels.TERMINAL_CLAIM, terminalId)
    await expect(a.rpc('terminal.write', { ...payload(lease), data: 'stale\r' })).rejects.toMatchObject({ code: 'lease_stale' })
    await ipc(AgentIpcChannels.TERMINAL_WRITE, terminalId, 'returned\r')
    const next = await a.rpc<ControlLease>('terminal.acquireControl', { terminalId })
    const renewed = await a.rpc<ControlLease>('terminal.renewControl', payload(next))
    expect(renewed.delegate).toBe('phone:a')
    await a.rpc('terminal.releaseControl', payload(next))
    const granted = await b.rpc<ControlLease>('terminal.acquireControl', { terminalId })
    await b.rpc('terminal.kill', payload(granted))
    expect(writes).toEqual(['window\r', 'phone\r', 'returned\r'])
    expect(domain.leases.get(resource)).toBeNull()
  })
})
