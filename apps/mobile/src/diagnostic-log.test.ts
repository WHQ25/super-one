import { beforeEach, describe, expect, it, vi } from 'vitest'

type Module = typeof import('./diagnostic-log')
let diagnostics: Module

beforeEach(async () => {
  vi.resetModules()
  diagnostics = await import('./diagnostic-log')
})

const sent = (rpc: ReturnType<typeof vi.fn>) => rpc.mock.calls.flatMap(([, payload]) => (payload as { entries: Array<{ tag: string }> }).entries.map(entry => entry.tag))

describe('diagnostic log upload', () => {
  it('forgets lines only once the desktop has written them', async () => {
    diagnostics.recordDiagnostic('a', { step: 'one' })
    diagnostics.recordDiagnostic('b')
    const request = vi.fn().mockResolvedValue({ written: 2 })
    await expect(diagnostics.uploadDiagnostics({ rpc: request })).resolves.toBe(true)
    expect(request.mock.calls[0][0]).toBe('client.appendLog')
    expect(request.mock.calls[0][1]).toMatchObject({ entries: [{ tag: 'a', fields: { step: 'one' } }, { tag: 'b' }] })
    await diagnostics.uploadDiagnostics({ rpc: request })
    expect(request).toHaveBeenCalledOnce()
  })

  it('keeps every line when the desktop does not take them, and resends them next time', async () => {
    diagnostics.recordDiagnostic('offline')
    // An older desktop has no handler and never answers; a timeout rejects.
    await expect(diagnostics.uploadDiagnostics({ rpc: vi.fn().mockRejectedValue(new Error('timeout')) })).resolves.toBe(false)
    await expect(diagnostics.uploadDiagnostics({ rpc: vi.fn().mockResolvedValue({ error: 'unknown' }) })).resolves.toBe(false)
    const request = vi.fn().mockResolvedValue({ written: 1 })
    await diagnostics.uploadDiagnostics({ rpc: request })
    expect(sent(request)).toEqual(['offline'])
  })

  it('holds the newest lines when the buffer overflows, and sends them in batches', async () => {
    for (let i = 0; i < 1_100; i++) diagnostics.recordDiagnostic(`t${i}`)
    const request = vi.fn().mockResolvedValue({ written: 0 })
    await diagnostics.uploadDiagnostics({ rpc: request })
    const tags = sent(request)
    expect(tags).toHaveLength(1_000)
    expect(tags[0]).toBe('t100')
    expect(request).toHaveBeenCalledTimes(5)
  })

  it('stops asking a desktop that did not answer until the next connection', async () => {
    vi.useFakeTimers()
    diagnostics.recordDiagnostic('x')
    const request = vi.fn().mockRejectedValue(new Error('timeout'))
    diagnostics.startDiagnosticUpload({ rpc: request }, 1_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(request).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
