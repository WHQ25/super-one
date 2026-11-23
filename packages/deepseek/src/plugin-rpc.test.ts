import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createDeepseekTree } from './tree'
import type { LoaderEntries } from './cordis-loader'
import { PluginRpcNotFoundError } from './plugin-rpc'

describe('PluginRpcService', () => {
  it('routes invoke to registered handlers and scopes cleanup to the calling plugin fiber', async () => {
    const root = await createDeepseekTree({})
    try {
      const events: Array<{ pluginId: string; event: string; payload: unknown }> = []
      const unsub = root.get('pluginRpc')!.subscribe((msg) => events.push(msg))

      const fiberA = root.plugin({
        name: 'plugin-a',
        inject: ['pluginRpc'],
        apply(ctx: Context) {
          ctx.pluginRpc.handle('echo', (payload) => ({ from: 'a', payload }))
          ctx.pluginRpc.emit('ready', { version: 1 })
        },
      })
      const fiberB = root.plugin({
        name: 'plugin-b',
        inject: ['pluginRpc'],
        apply(ctx: Context) {
          ctx.pluginRpc.handle('echo', (payload) => ({ from: 'b', payload }))
        },
      })

      await Promise.all([fiberA.await(), fiberB.await()])

      const rpc = root.get('pluginRpc')!
      await expect(rpc.invoke('plugin-a', 'echo', { hello: 1 })).resolves.toEqual({
        from: 'a',
        payload: { hello: 1 },
      })
      await expect(rpc.invoke('plugin-b', 'echo', { hello: 2 })).resolves.toEqual({
        from: 'b',
        payload: { hello: 2 },
      })
      expect(events).toEqual([{ pluginId: 'plugin-a', event: 'ready', payload: { version: 1 } }])

      await fiberA.dispose()

      expect(rpc.hasHandler('plugin-a', 'echo')).toBe(false)
      expect(rpc.hasHandler('plugin-b', 'echo')).toBe(true)
      await expect(rpc.invoke('plugin-a', 'echo', {})).rejects.toBeInstanceOf(PluginRpcNotFoundError)
      await expect(rpc.invoke('plugin-b', 'echo', { still: 'alive' })).resolves.toEqual({
        from: 'b',
        payload: { still: 'alive' },
      })

      unsub()
    } finally {
      await root.fiber.dispose()
    }
  })

  it('derives pluginId from loader entry id when mounted through ctx.loader', async () => {
    const root = await createDeepseekTree({})
    try {
      const rpc = root.get('pluginRpc')!
      const listener = vi.fn()
      const unsub = rpc.subscribe(listener)

      const mod = `data:text/javascript,export const inject = ['pluginRpc']; export function apply(ctx) { ctx.pluginRpc.handle('ping', () => 'pong'); ctx.pluginRpc.emit('mounted', 42); }`
      await (root.loader as LoaderEntries).create({ id: 'plugin-@acme/demo', name: mod })
      await root.loader.await()

      await expect(rpc.invoke('@acme/demo', 'ping')).resolves.toBe('pong')
      expect(listener).toHaveBeenCalledWith({ pluginId: '@acme/demo', event: 'mounted', payload: 42 })

      root.loader.remove('plugin-@acme/demo')
      await root.loader.await()

      await expect(rpc.invoke('@acme/demo', 'ping')).rejects.toBeInstanceOf(PluginRpcNotFoundError)
      unsub()
    } finally {
      await root.fiber.dispose()
    }
  })
})
