import { afterEach, describe, expect, it, vi } from 'vitest'
import { runtimeTestClient } from './runtime-test-client'
import { WidgetComposerClient, setComposerConnection } from './widget-composer-client'
import { ChatRuntime } from './runtime'

const request = { viewId: 'view', localId: 'local', messageId: 'assistant', output: 'caller' as const,
  spec: { title: 'Notes', requestedSchema: { type: 'object', properties: { notes: { type: 'string' } } } },
}
const outcome = { status: 'submitted' as const, values: { notes: 'private answer' } }
const event = { type: 'composer_settled', sessionId: 'session', requestId: 'form', viewId: 'view', localId: 'local', outcome }
function fixture() {
  let owner = { projectPath: '/project', sessionId: 'session' }
  const client = runtimeTestClient(); client.dispatch.mockResolvedValue({ ok: true, requestId: 'form' })
  const deliver = vi.fn(), composer = new WidgetComposerClient(client as never, () => owner, deliver)
  return { client, deliver, composer, setOwner: (value: typeof owner) => { owner = value } }
}
afterEach(() => vi.useRealTimers())

describe('phone widget composer delivery', () => {
  it('buffers completion before admission and verifies its request and transcript owner', async () => {
    const { client, composer, deliver } = fixture()
    let acknowledge!: (value: unknown) => void
    client.dispatch.mockReturnValue(new Promise(resolve => { acknowledge = resolve }))
    const opening = composer.open(request)
    expect(composer.consume({ ...event, sessionId: 'foreign' })).toBe(true)
    expect(composer.consume({ ...event, localId: 'foreign' })).toBe(true)
    composer.consume(event)
    expect(deliver).not.toHaveBeenCalled()
    acknowledge({ ok: true, requestId: 'form' })
    await expect(opening).resolves.toEqual({ ok: true, requestId: 'form' })
    expect(client.dispatch).toHaveBeenCalledWith(expect.objectContaining({ method: 'composer.open', environmentId: 'desktop', sessionId: 'session', messageId: 'assistant', output: 'caller' }))
    expect(deliver).toHaveBeenCalledExactlyOnceWith({ viewId: 'view', localId: 'local', outcome })
    composer.consume(event)
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('waits for human input without a timer and withholds agent values', async () => {
    vi.useFakeTimers()
    const { composer, deliver } = fixture()
    await composer.open({ ...request, output: 'agent' })
    await vi.advanceTimersByTimeAsync(180_000)
    expect(deliver).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    composer.consume({ ...event, requestId: 'foreign' })
    expect(deliver).not.toHaveBeenCalled()
    composer.consume(event)
    expect(deliver).toHaveBeenCalledExactlyOnceWith({ viewId: 'view', localId: 'local', outcome: { status: 'submitted' } })
  })

  it('recovers once per reconnect without polling, and ignores a reply after view disposal', async () => {
    const { client, composer, deliver } = fixture()
    await composer.open(request)
    let reply!: (value: unknown) => void
    client.dispatch.mockReturnValue(new Promise(resolve => { reply = resolve }))
    const recovery = composer.recover()
    expect(composer.recover()).toBe(recovery)
    expect(client.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'composer.outcome', inputRequestId: 'form', sessionId: 'session' }))
    reply({ state: 'pending' })
    await recovery
    expect(client.dispatch).toHaveBeenCalledTimes(2)
    client.dispatch.mockResolvedValue({ state: 'settled', outcome })
    await composer.recover()
    expect(deliver).toHaveBeenCalledExactlyOnceWith({ viewId: 'view', localId: 'local', outcome })
    await composer.recover()
    expect(client.dispatch).toHaveBeenCalledTimes(3)

    client.dispatch.mockResolvedValueOnce({ ok: true, requestId: 'form-2' })
    await composer.open({ ...request, localId: 'another' })
    client.dispatch.mockReturnValue(new Promise(resolve => { reply = resolve }))
    const staleRecovery = composer.recover()
    composer.release('view')
    reply({ state: 'settled', outcome })
    await staleRecovery
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(deliver).toHaveBeenLastCalledWith({ viewId: 'view', localId: 'another', outcome: { status: 'cancelled', reason: 'owner_disposed' } })
  })

  it('queues releases for the old owner while a relay socket has no desktop peer', async () => {
    const { client, composer, deliver, setOwner } = fixture()
    await composer.open(request)
    setComposerConnection(client as never, false)
    setOwner({ projectPath: '/next', sessionId: 'next' })
    composer.dispose()
    expect(client.dispatch.mock.calls.filter(([call]) => call.method === 'composer.cancel')).toHaveLength(0)
    expect(deliver).toHaveBeenCalledWith({ viewId: 'view', localId: 'local', outcome: { status: 'cancelled', reason: 'owner_disposed' } })
    setComposerConnection(client as never, true)
    expect(client.dispatch.mock.calls.filter(([call]) => call.method === 'composer.cancel').map(([call]) => call)).toEqual([{ method: 'composer.cancel', environmentId: 'desktop', sessionId: 'session', viewId: 'view' }])
    setComposerConnection(client as never, true)
    expect(client.dispatch.mock.calls.filter(([call]) => call.method === 'composer.cancel')).toHaveLength(1)
    composer.consume(event)
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('cancels a possibly admitted form after losing its opening receipt', async () => {
    const { client, composer } = fixture()
    client.dispatch.mockImplementation(async () => { client.connected = false; throw new Error('Disconnected') })
    await expect(composer.open(request)).rejects.toThrow('Disconnected')
    expect(client.dispatch.mock.calls.filter(([call]) => call.method === 'composer.cancel')).toHaveLength(0)
    client.connected = true
    setComposerConnection(client as never, true)
    expect(client.dispatch.mock.calls.filter(([call]) => call.method === 'composer.cancel').map(([call]) => call)).toEqual([{ method: 'composer.cancel', environmentId: 'desktop', sessionId: 'session', viewId: 'view', localId: 'local' }])
  })

  it('releases again after admission when closing overtakes the opening receipt', async () => {
    const { client, composer, deliver } = fixture()
    let acknowledge!: (value: unknown) => void
    client.dispatch.mockReturnValue(new Promise(resolve => { acknowledge = resolve }))
    const opening = composer.open(request)
    composer.release('view')
    acknowledge({ ok: true, requestId: 'form' })
    await opening
    await vi.waitFor(() => expect(client.dispatch.mock.calls.filter(([call]) => call.method === 'composer.cancel')).toHaveLength(2))
    composer.consume(event)
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('returns admission errors without leaving a waiting form', async () => {
    const { client, composer, deliver } = fixture()
    client.dispatch.mockResolvedValueOnce({ ok: false, error: { code: 'busy', message: 'Already open' } })
    await expect(composer.open(request)).resolves.toMatchObject({ ok: false })
    await composer.recover()
    expect(client.dispatch).toHaveBeenCalledTimes(1)
    expect(client.dispatch.mock.calls.filter(([call]) => call.method === 'composer.cancel')).toHaveLength(0)
    expect(deliver).not.toHaveBeenCalled()
    await composer.open(request)
  })

  it('consumes private answers before session reduction without painting them into the transcript', async () => {
    const { client } = fixture(), deliver = vi.fn(), paint = vi.fn()
    const runtime = new ChatRuntime(client as never, paint, { onComposerResult: deliver })
    runtime.projectPath = '/project'; runtime.sessionId = 'session'
    await runtime.widgetComposers.open(request)
    runtime.ingest([event])
    runtime.flush()
    expect(deliver).toHaveBeenCalledExactlyOnceWith({ viewId: 'view', localId: 'local', outcome })
    expect(runtime.messages).toEqual([])
    expect(paint).not.toHaveBeenCalled()
    runtime.dispose()
  })
})
