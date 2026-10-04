import { describe, expect, it, vi } from 'vitest'
import { invokeModUi, parseModUiPayload } from './mod-ui'

const session = { projectPath: '/p', sessionId: 's1' }

describe('invokeModUi', () => {
  it('sends a mod_ui_request and returns the desktop’s response', async () => {
    const request = vi.fn(async () => ({ response: { handled: true } }))
    const result = await invokeModUi({ request } as never, session, { op: 'press', request: { plugin: 'p', handle: 1, surface: 'mobile', clientId: 'x' } })
    expect(result).toEqual({ handled: true })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'mod_ui_request', projectPath: '/p', sessionId: 's1', op: 'press' }), 20_000)
  })

  it('rejects with the desktop’s refusal so the client can tell no-mods apart', async () => {
    const request = vi.fn(async () => ({ error: 'mod-ui-unavailable: No live session' }))
    await expect(invokeModUi({ request } as never, session, { op: 'panes', request: { clientId: 'x' } })).rejects.toThrow('mod-ui-unavailable')
  })
})

it('parseModUiPayload refuses a payload without an op and request', () => {
  expect(() => parseModUiPayload({ op: 'press' })).toThrow('invalid modUi payload')
  expect(parseModUiPayload({ op: 'panes', request: { clientId: 'x' } }).op).toBe('panes')
})
