import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalEvent, TerminalListItem } from '@superone/shared/agent-types'

vi.mock('../../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { TerminalManager } from '../../terminal/terminal-manager'
import type { PtyLike } from '../../terminal/pty'
import { createDesktopTerminalsPort } from '../desktop-terminals-port'
import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

/** A domain whose terminal port runs over a manager with scripted PTYs. */
function terminalsDomain() {
  const output = new Map<string, (data: string) => void>()
  let lastData: ((data: string) => void) | null = null
  const listeners = new Set<(event: TerminalEvent) => void>()
  const manager = new TerminalManager({
    spawner: {
      spawn: (): PtyLike => ({
        write: () => {}, resize: () => {}, kill: () => {}, onExit: () => {}, foregroundProcess: () => 'zsh',
        onData: (cb) => { lastData = cb },
      }),
    },
    onEvent: (event) => { for (const listener of listeners) listener(event) },
    exists: () => true,
    coalesceMs: 0,
  })
  cleanup.push(() => manager.killAll())
  const terminals = createDesktopTerminalsPort(manager, (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  })
  const open = (cwd: string) => {
    const term = manager.create({ cwd })
    output.set(term.terminalId, lastData!)
    return { terminalId: term.terminalId, emit: (data: string) => output.get(term.terminalId)!(data) }
  }
  return { ...phoneDomain(cleanup, { terminals }), open }
}

describe('phone endpoint: terminals', () => {
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

  it('refuses terminal input until terminals move onto control leases', async () => {
    const { domain, open, projectDir } = terminalsDomain()
    const term = open(projectDir)
    const phone = await connectPhone(domain)
    await expect(phone.rpc('terminal.write', { terminalId: term.terminalId, data: 'ls\r' })).rejects.toMatchObject({ details: { unsupported: true } })
  })
})
