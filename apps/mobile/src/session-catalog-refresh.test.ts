import { describe, expect, it, vi } from 'vitest'
import { refreshSessionCatalog } from './session-catalog-refresh'
import { SessionTransition } from './session-transition'

describe('optional session catalog refresh', () => {
  it('releases the send/restore lock while the catalog is still loading', async () => {
    let finish!: (catalog: string) => void
    const catalog = new Promise<string>((resolve) => { finish = resolve })
    const apply = vi.fn()
    const transition = new SessionTransition()
    await transition.run(async () => {
      refreshSessionCatalog(() => catalog, () => true, apply, vi.fn())
    })
    expect(transition.isActive).toBe(false)
    expect(apply).not.toHaveBeenCalled()
    finish('models')
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith('models'))
  })
  it('discards metadata that arrives after a session switch', async () => {
    let current = true
    const apply = vi.fn()
    refreshSessionCatalog(async () => 'old catalog', () => current, apply, vi.fn())
    current = false
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(apply).not.toHaveBeenCalled()
  })
  it('surfaces a failed catalog without failing the restored session', async () => {
    const fail = vi.fn()
    const transition = new SessionTransition()
    await expect(transition.run(async () => {
      refreshSessionCatalog(async () => { throw new Error('catalog unavailable') }, () => true, vi.fn(), fail)
    })).resolves.toBeUndefined()
    await vi.waitFor(() => expect(fail).toHaveBeenCalledWith(expect.objectContaining({ message: 'catalog unavailable' })))
    expect(transition.isActive).toBe(false)
  })
})
