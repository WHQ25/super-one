import { expect, it, vi } from 'vitest'
import type { MiniAppHostLaunch } from './miniapp-host-launch'
import { authorizeMiniAppTools } from './miniapp-authorization'

vi.mock('../logger', () => ({ default: { warn: vi.fn() } }))

it('returns only successful tool grants and rebuilds once after a partial batch', async () => {
  const start = vi.fn()
  const register = vi.fn((id: string) => { if (id === 'broken') throw new Error('registration failed') })
  const rebuild = vi.fn()
  const granted = await authorizeMiniAppTools(['missing', 'good', 'broken', 'no-tools', 'good'], '/project', 'sid', {
    prepare: async id => {
      if (id === 'missing') throw new Error('missing app')
      return { manifest: { appId: id, tools: id === 'no-tools' ? [] : [{ name: 'read' }] }, args: { appId: id } } as unknown as MiniAppHostLaunch
    },
    start, register, markNeedsRebuild: rebuild,
  })
  expect(granted).toEqual(['good'])
  expect(start).toHaveBeenCalledTimes(3)
  expect(register).toHaveBeenCalledTimes(3)
  expect(rebuild).toHaveBeenCalledOnce()
})

it('does not rebuild when every grant fails', async () => {
  const rebuild = vi.fn()
  await expect(authorizeMiniAppTools(['missing'], '/project', 'sid', {
    prepare: vi.fn().mockRejectedValue(new Error('missing app')),
    start: vi.fn(), register: vi.fn(), markNeedsRebuild: rebuild,
  })).resolves.toEqual([])
  expect(rebuild).not.toHaveBeenCalled()
})
