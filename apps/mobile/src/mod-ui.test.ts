import { describe, expect, it, vi } from 'vitest'
import { invokeModUi, parseModUiPayload } from './mod-ui'
import { runtimeTestClient } from './runtime-test-client'

const session = { projectPath: '/p', sessionId: 's1' }

describe('invokeModUi', () => {
  it('sends a fenced native mod mutation and returns the desktop’s response', async () => {
    const client = runtimeTestClient(); client.dispatch.mockResolvedValue({ handled: true })
    const result = await invokeModUi(client, session, { op: 'press', request: { plugin: 'p', handle: 1, surface: 'mobile', clientId: 'x' } })
    expect(result).toEqual({ handled: true })
    expect(client.controlledRpc).toHaveBeenCalledWith({ environmentId: 'desktop', sessionId: 's1' }, 'session.modUi', expect.objectContaining({ op: 'press' }), { timeoutMs: 20_000 })
  })

  it('rejects with the desktop’s refusal so the client can tell no-mods apart', async () => {
    const client = runtimeTestClient(); client.dispatch.mockRejectedValue(new Error('mod-ui-unavailable: No live session'))
    await expect(invokeModUi(client, session, { op: 'panes', request: { clientId: 'x' } })).rejects.toThrow('mod-ui-unavailable')
    expect(client.controlledRpc).not.toHaveBeenCalled()
  })
})

it('parseModUiPayload refuses a payload without an op and request', () => {
  expect(() => parseModUiPayload({ op: 'press' })).toThrow('invalid modUi payload')
  expect(parseModUiPayload({ op: 'panes', request: { clientId: 'x' } }).op).toBe('panes')
})
