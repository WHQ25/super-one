import { afterEach, describe, expect, it, vi } from 'vitest'
import { createComposerApi, createSuperoneApi, type MiniAppTransport } from './miniapp-api-runtime'
import { buildWidgetSrcdoc } from './generative-ui/widget-srcdoc'

function transport() {
  const handlers = new Map<string, (data: Record<string, unknown>) => void>()
  const port: MiniAppTransport = { send: vi.fn(), request: vi.fn(), on: (type, handler) => { handlers.set(type, handler) } }
  return { port, id: () => vi.mocked(port.send).mock.calls.at(-1)![1].id,
    reply: (data: Record<string, unknown>) => handlers.get('composer-result')!(data) }
}

const spec = { title: 'Notes', requestedSchema: { type: 'object', properties: { notes: { type: 'string' } } } }

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('shared frontend composer API', () => {
  it('uses the same default caller contract in the mini-app frontend and embedded widget SDK', async () => {
    const app = transport()
    const appResult = createSuperoneApi(app.port, 'test').composer.open(spec)
    expect(app.port.send).toHaveBeenCalledWith('composer-open', { id: expect.any(String), spec, output: 'caller' })

    // Execute the exact factory shipped into srcdoc, rather than a second widget implementation.
    const document = buildWidgetSrcdoc('<div>form</div>', false)
    const source = document.match(/var composer=\(([\s\S]*?)\)\(\{/)!;
    const widget = transport()
    const embeddedFactory = new Function(`return (${source[1]})`)() as typeof createComposerApi
    const widgetResult = embeddedFactory(widget.port).open(spec)
    expect(widget.port.send).toHaveBeenCalledWith('composer-open', { id: expect.any(String), spec, output: 'caller' })
    expect(widget.id()).not.toEqual(app.id())

    const outcome = { status: 'submitted', values: { notes: 'First\nSecond' } }
    app.reply({ id: app.id(), outcome }); widget.reply({ id: widget.id(), outcome })
    await expect(appResult).resolves.toEqual(outcome)
    await expect(widgetResult).resolves.toEqual(outcome)
  })

  it('keeps agent output explicit and waits for the terminal result without a human-input timer', async () => {
    vi.useFakeTimers()
    const { port, id, reply } = transport()
    const complete = vi.fn()
    const result = createComposerApi(port).open(spec, { output: 'agent' }).then(complete)
    expect(port.send).toHaveBeenCalledWith('composer-open', { id: expect.any(String), spec, output: 'agent' })
    await vi.advanceTimersByTimeAsync(180_000)
    expect(complete).not.toHaveBeenCalled()
    reply({ id: 'foreign', outcome: { status: 'cancelled', reason: 'user' } })
    expect(complete).not.toHaveBeenCalled()
    reply({ id: id(), outcome: { status: 'cancelled', reason: 'user' } })
    await result
    expect(complete).toHaveBeenCalledExactlyOnceWith({ status: 'cancelled', reason: 'user' })
  })

  it('rejects bad options and host admission failures, then permits another request', async () => {
    const { port, id, reply } = transport()
    const api = createComposerApi(port)
    await expect(api.open(spec, { output: 'session' } as never)).rejects.toThrow('Invalid composer output')
    await expect(api.open(spec, { sessionId: 'forged' } as never)).rejects.toThrow('Invalid composer options')
    expect(port.send).not.toHaveBeenCalled()
    const rejected = api.open(spec)
    reply({ id: id(), error: 'This app is not authorized in that session' })
    await expect(rejected).rejects.toThrow('not authorized')
    const next = api.open(spec)
    reply({ id: id(), outcome: { status: 'submitted', values: { notes: 'retry' } } })
    await expect(next).resolves.toMatchObject({ status: 'submitted' })
  })

  it('cancels pending calls on surface disposal even when the host is unreachable', async () => {
    let pagehide!: () => void
    vi.stubGlobal('addEventListener', vi.fn((_type: string, handler: () => void) => { pagehide = handler }))
    const { port } = transport()
    const api = createComposerApi(port)
    const pending = api.open(spec)
    vi.mocked(port.send).mockImplementationOnce(() => { throw new Error('Disconnected') })
    pagehide()
    await expect(pending).resolves.toEqual({ status: 'cancelled', reason: 'owner_disposed' })
    await expect(api.open(spec)).resolves.toEqual({ status: 'cancelled', reason: 'owner_disposed' })
    expect(port.send).toHaveBeenCalledWith('composer-dispose', { ids: [expect.any(String)] })
  })
})
