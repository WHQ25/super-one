import { describe, expect, it, vi } from 'vitest'
import { activatePreparedSessionLink } from './session-link-transition'
import type { SessionLinkPreparation } from './session-link-navigation'

function fixture() {
  const order: string[] = []
  const runtime = { open: vi.fn(async () => { order.push('hydrate') }), ingest: vi.fn(), dispose: vi.fn() }
  const prepared = {
    target: { ref: { environmentId: 'node', sessionId: 'target' }, projectPath: '/app' },
    restored: { liveBatches: [], epoch: 1 }, connection: {},
    commit: vi.fn(() => { order.push('commit'); prepared.restored.liveBatches.push([{ type: 'message_complete' }] as never) }), retire: vi.fn(),
  } as unknown as SessionLinkPreparation
  const options = {
    isCurrent: () => true, createRuntime: () => runtime,
    parkSource: vi.fn(async () => { order.push('park') }),
    adoptConnection: vi.fn(async () => { order.push('adopt'); return true }), ownsConnection: () => true,
    leaveSource: vi.fn(), activate: vi.fn(() => { order.push('activate') }),
  }
  return { prepared, options, runtime, order }
}
describe('prepared session activation', () => {
  it('hydrates before source retirement and replays events buffered during hydration', async () => {
    const f = fixture()
    await activatePreparedSessionLink(f.prepared, f.options)
    expect(f.order).toEqual(['hydrate', 'park', 'adopt', 'commit', 'activate'])
    expect(f.runtime.ingest).toHaveBeenCalledWith([{ type: 'message_complete' }], 1)
    expect(f.prepared.retire).not.toHaveBeenCalled()
  })
  it('keeps the source alive when target hydration fails', async () => {
    const f = fixture(); f.runtime.open.mockRejectedValue(new Error('Bad target'))
    await expect(activatePreparedSessionLink(f.prepared, f.options)).rejects.toThrow('Bad target')
    expect(f.options.adoptConnection).not.toHaveBeenCalled(); expect(f.options.leaveSource).not.toHaveBeenCalled()
    expect(f.prepared.retire).toHaveBeenCalledOnce(); expect(f.runtime.dispose).toHaveBeenCalledOnce()
  })
  it('does not commit a superseded source or failed adoption', async () => {
    const f = fixture(); f.options.isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
    await activatePreparedSessionLink(f.prepared, f.options)
    expect(f.options.adoptConnection).not.toHaveBeenCalled(); expect(f.options.activate).not.toHaveBeenCalled()
    const g = fixture(); g.options.adoptConnection.mockResolvedValue(false)
    await activatePreparedSessionLink(g.prepared, g.options)
    expect(g.prepared.commit).not.toHaveBeenCalled(); expect(g.prepared.retire).toHaveBeenCalledOnce()
  })
  it('does not dispose an adopted connection or active runtime after commit', async () => {
    const f = fixture(); f.options.activate.mockImplementation(() => { throw new Error('UI failed') })
    await expect(activatePreparedSessionLink(f.prepared, f.options)).rejects.toThrow('UI failed')
    expect(f.prepared.retire).not.toHaveBeenCalled(); expect(f.runtime.dispose).not.toHaveBeenCalled()
  })
})
