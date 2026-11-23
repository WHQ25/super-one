import { describe, expect, it, vi } from 'vitest'
import {
  createDisposableScope,
  createHookBus,
  createRuntimePluginKernel,
  createServiceRegistry,
  createServiceToken,
} from './index'

describe('packages/runtime/src/plugin-kernel', () => {
  it('cascades DisposableScope cleanup in LIFO order and disposes child scopes', () => {
    const events: string[] = []
    const root = createDisposableScope()
    const child = root.createChildScope()

    root.onDispose(() => events.push('root-1'))
    child.onDispose(() => events.push('child-1'))
    child.onDispose(() => events.push('child-2'))
    root.onDispose(() => events.push('root-2'))

    root.dispose()
    expect(root.disposed).toBe(true)
    expect(child.disposed).toBe(true)
    expect(events).toEqual(['child-2', 'child-1', 'root-2', 'root-1'])

    root.onDispose(() => events.push('late'))
    expect(events).toContain('late')
  })

  it('fails fast on missing required services and cleans up provided services on scope dispose', () => {
    const services = createServiceRegistry()
    const Token = createServiceToken<{ ping: () => string }>('demo.service')

    expect(services.has(Token)).toBe(false)
    expect(services.get(Token)).toBeUndefined()
    expect(() => services.require(Token)).toThrow(/Required service "demo\.service" is not registered/)

    const scope = createDisposableScope()
    services.provide(Token, { ping: () => 'pong' }, scope)
    expect(services.require(Token).ping()).toBe('pong')

    scope.dispose()
    expect(services.has(Token)).toBe(false)
    expect(() => services.require(Token)).toThrow(/Required service "demo\.service"/)
  })

  it('supports waterfall, pipeline, broadcast hooks, priority ordering, and AbortSignal', async () => {
    const hooks = createHookBus()
    const scope = createDisposableScope()

    hooks.registerWaterfall<number>('calc', (n) => n + 1, { priority: 10, scope })
    hooks.registerWaterfall<number>('calc', (n) => n * 2, { priority: 1, scope })
    await expect(hooks.waterfall('calc', 5, undefined)).resolves.toBe(12)

    const trace: string[] = []
    hooks.registerPipeline<string, string>(
      'pipe',
      async (input, _ctx, next) => {
        trace.push(`high-in:${input}`)
        const res = await next(`${input}+high`)
        trace.push(`high-out:${res}`)
        return res
      },
      { priority: 5, scope },
    )
    const piped = await hooks.pipeline('pipe', 'seed', undefined, (val) => `done:${val}`)
    expect(piped).toBe('done:seed+high')
    expect(trace).toEqual(['high-in:seed', 'high-out:done:seed+high'])

    const received: string[] = []
    hooks.registerBroadcast<string>('notify', (msg) => {
      received.push(msg)
    }, { scope })
    await hooks.broadcast('notify', 'hello', undefined)
    expect(received).toEqual(['hello'])

    const ac = new AbortController()
    ac.abort(new Error('cancelled'))
    await expect(hooks.waterfall('calc', 1, undefined, ac.signal)).rejects.toThrow('cancelled')

    scope.dispose()
    await expect(hooks.waterfall('calc', 5, undefined)).resolves.toBe(5)
  })

  it('provides unified RuntimePluginKernel shutdown', () => {
    const kernel = createRuntimePluginKernel()
    const cleanup = vi.fn()
    const Token = createServiceToken<string>('token')
    kernel.services.provide(Token, 'ok', kernel.scope)
    kernel.scope.onDispose(cleanup)

    kernel.dispose()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(kernel.services.has(Token)).toBe(false)
  })
})
