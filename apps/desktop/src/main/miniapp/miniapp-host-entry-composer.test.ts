import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'

/**
 * Loads the real MiniApp Host entry against a fake parent port and a tiny app
 * module, so the tool context and `context.composer` are exercised as authors see them.
 */
const dir = mkdtempSync(join(tmpdir(), 'miniapp-entry-'))
const entryPath = join(dir, 'node.mjs')
writeFileSync(entryPath, `
export function activate(context) {
  context.tools.handle('ask', async (args, ctx) => {
    const pending = context.composer.open({ title: 'Color', requestedSchema: { type: 'object', properties: { c: { type: 'string' } } } }, { session: ctx.session, signal: ctx.signal })
    globalThis.__outcome = pending
    return { session: ctx.session.sessionId, callId: ctx.callId }
  })
  context.tools.handle('wait', (args, ctx) => context.composer.open({ title: 'Wait', requestedSchema: { type: 'object', properties: { c: { type: 'string' } } } }, { session: ctx.session, signal: ctx.signal }))
}
`)

const listeners: Array<(event: { data: unknown }) => void> = []
const posted: Array<Record<string, unknown>> = []
Object.assign(process, {
  parentPort: {
    postMessage: (message: Record<string, unknown>) => { posted.push(message) },
    on: (_event: 'message', listener: (event: { data: unknown }) => void) => { listeners.push(listener) },
  },
})
const env = {
  SUPERONE_MINIAPP_APP_ID: 'demo', SUPERONE_MINIAPP_PROJECT_DIR: dir, SUPERONE_MINIAPP_APP_PATH: dir,
  SUPERONE_MINIAPP_ENTRY_PATH: entryPath, SUPERONE_MINIAPP_WORKSPACE_STORAGE_PATH: dir,
  SUPERONE_MINIAPP_GLOBAL_STORAGE_PATH: dir, SUPERONE_MINIAPP_VERSION: '1.0.0', SUPERONE_MINIAPP_LOCALE: 'en',
}
Object.assign(process.env, env)
await import('./miniapp-host-entry')

function send(data: unknown) {
  for (const listener of listeners) listener({ data })
}

afterAll(() => {
  for (const key of Object.keys(env)) delete process.env[key]
  delete (process as { parentPort?: unknown }).parentPort
  rmSync(dir, { recursive: true, force: true })
})

describe('MiniApp Host entry composer', () => {
  it('passes the trusted session to the handler, which can start a form and return at once', async () => {
    await vi.waitFor(() => expect(posted).toContainEqual({ type: 'ready' }))
    send({ type: 'tool-call', callId: 'c1', tool: 'ask', args: {}, session: { sessionId: 's1' } })
    await vi.waitFor(() => expect(posted).toContainEqual({ type: 'tool-result', callId: 'c1', result: { session: 's1', callId: 'c1' } }))
    const open = posted.find(message => message.type === 'input-request-open')!
    expect(open).toMatchObject({ sessionId: 's1', spec: { title: 'Color' } })

    send({ type: 'input-request-settled', localId: open.localId, outcome: { status: 'submitted', values: { c: 'red' } } })
    await expect((globalThis as { __outcome?: Promise<unknown> }).__outcome).resolves.toEqual({ status: 'submitted', values: { c: 'red' } })
  })

  it('keeps a form started by a returned call; open errors reject', async () => {
    send({ type: 'tool-call', callId: 'c2', tool: 'ask', args: {}, session: { sessionId: 's1' } })
    await vi.waitFor(() => expect(posted.filter(message => message.type === 'input-request-open')).toHaveLength(2))
    const open = posted.filter(message => message.type === 'input-request-open')[1]!
    send({ type: 'tool-abort', callId: 'c2' })
    expect(posted).not.toContainEqual({ type: 'input-request-cancel', localId: open.localId })
    send({ type: 'input-request-settled', localId: open.localId, error: 'composer.open: no session has this app open' })
    await expect((globalThis as { __outcome?: Promise<unknown> }).__outcome).rejects.toThrow(/no session/)
  })

  it('closes a form awaited by a call that times out', async () => {
    send({ type: 'tool-call', callId: 'c3', tool: 'wait', args: {}, session: { sessionId: 's1' } })
    await vi.waitFor(() => expect(posted.filter(message => message.type === 'input-request-open')).toHaveLength(3))
    const open = posted.filter(message => message.type === 'input-request-open')[2]!
    send({ type: 'tool-abort', callId: 'c3' })
    expect(posted).toContainEqual({ type: 'input-request-cancel', localId: open.localId })
    send({ type: 'input-request-settled', localId: open.localId, outcome: { status: 'cancelled', reason: 'aborted' } })
    await vi.waitFor(() => expect(posted).toContainEqual({ type: 'tool-result', callId: 'c3', result: { status: 'cancelled', reason: 'aborted' } }))
  })
})
