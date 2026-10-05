import { describe, expect, it, vi } from 'vitest'
import { ComposerViewBridge, type ComposerViewRequest } from './composer-view-bridge'
import type { SuperOneComposerOutcome } from './composer-api'

const data = { id: 'local-1', spec: { title: 'Notes' }, output: 'caller' }
function pending() {
  let resolve!: (outcome: SuperOneComposerOutcome) => void
  const open = vi.fn((_request: ComposerViewRequest) => new Promise<SuperOneComposerOutcome>(done => { resolve = done }))
  const release = vi.fn()
  return { open, release, resolve: (outcome: SuperOneComposerOutcome) => resolve(outcome) }
}

describe('composer guest lifecycle', () => {
  it('forwards only spec/output/local identity and replies once after completion', async () => {
    const ports = pending(), reply = vi.fn(), view = new ComposerViewBridge(ports)
    view.handle('composer-open', { ...data, sessionId: 'forged', source: { kind: 'miniapp' } }, reply)
    view.handle('composer-open', data, reply)
    expect(ports.open).toHaveBeenCalledExactlyOnceWith({ viewId: expect.any(String), localId: 'local-1', spec: data.spec, output: 'caller' })
    expect(reply).not.toHaveBeenCalled()
    ports.resolve({ status: 'submitted', values: { notes: 'typed' } })
    await Promise.resolve()
    expect(reply).toHaveBeenCalledExactlyOnceWith({ type: 'composer-result', id: 'local-1', outcome: { status: 'submitted', values: { notes: 'typed' } } })
  })

  it('releases only its holder on reload and ignores replies from the old document', async () => {
    const ports = pending(), reply = vi.fn(), view = new ComposerViewBridge(ports)
    view.handle('composer-open', data, reply)
    const first = ports.open.mock.calls[0]![0] as unknown as { viewId: string }
    view.reset()
    expect(ports.release).toHaveBeenCalledExactlyOnceWith(first.viewId)
    expect(reply).toHaveBeenCalledExactlyOnceWith({ type: 'composer-result', id: 'local-1', outcome: { status: 'cancelled', reason: 'owner_disposed' } })
    ports.resolve({ status: 'cancelled', reason: 'owner_disposed' })
    await Promise.resolve()
    expect(reply).toHaveBeenCalledTimes(1)
    view.handle('composer-open', { ...data, id: 'new' }, reply)
    expect((ports.open.mock.calls[1]![0] as unknown as { viewId: string }).viewId).not.toBe(first.viewId)
  })

  it('reports admission failure to the exact request and rejects unsupported output before reaching the host', async () => {
    const ports = { open: vi.fn(async () => { throw new Error('Not authorized') }), release: vi.fn() }
    const reply = vi.fn(), view = new ComposerViewBridge(ports)
    view.handle('composer-open', { ...data, output: 'session' }, reply)
    expect(ports.open).not.toHaveBeenCalled()
    view.handle('composer-open', data, reply)
    await Promise.resolve()
    expect(reply).toHaveBeenLastCalledWith({ type: 'composer-result', id: 'local-1', error: 'Not authorized' })
    expect(view.handle('miniapp-node-message', {}, reply)).toBe(false)
  })

  it('does not let a retired document release a new document after navigation', async () => {
    const ports = pending(), reply = vi.fn(), view = new ComposerViewBridge(ports)
    view.handle('composer-open', data, reply)
    view.reset()
    view.handle('composer-open', { ...data, id: 'new-document' }, reply)
    view.handle('composer-dispose', { ids: ['local-1'] }, reply)
    expect(ports.release).toHaveBeenCalledTimes(1)
    ports.resolve({ status: 'submitted', values: { notes: 'new' } })
    await Promise.resolve()
    expect(reply).toHaveBeenLastCalledWith({ type: 'composer-result', id: 'new-document', outcome: { status: 'submitted', values: { notes: 'new' } } })
  })
})
