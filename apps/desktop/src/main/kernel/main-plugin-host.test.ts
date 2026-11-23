import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createServiceToken } from '@superone/runtime/plugin-kernel'

const handlers = new Map<string, (...args: any[]) => any>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: any[]) => any) => {
      handlers.set(channel, fn)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
  },
}))

const { MainPluginHost } = await import('./main-plugin-host')

describe('apps/desktop/src/main/kernel/main-plugin-host', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('registers IPC handlers and services scoped to a plugin and removes all on single dispose()', async () => {
    const host = new MainPluginHost()
    const DemoToken = createServiceToken<{ value: string }>('demo')
    const shutdownFn = vi.fn()
    const cleanupFn = vi.fn()

    const mounted = host.mount({
      id: 'builtin.demo',
      setup(scope) {
        scope.registerIpc('demo:ping', async () => 'pong')
        scope.provideService(DemoToken, { value: 'alive' })
        scope.onDispose(cleanupFn)
        scope.onAppShutdown(shutdownFn)
      },
    })

    expect(handlers.has('demo:ping')).toBe(true)
    expect(host.services.require(DemoToken).value).toBe('alive')

    mounted.dispose()

    expect(handlers.has('demo:ping')).toBe(false)
    expect(host.services.get(DemoToken)).toBeUndefined()
    expect(cleanupFn).toHaveBeenCalledTimes(1)

    await host.shutdown()
    expect(shutdownFn).not.toHaveBeenCalled()
  })

  it('invokes onAppShutdown hooks in reverse order during shutdown', async () => {
    const host = new MainPluginHost()
    const order: string[] = []
    host.mount({
      id: 'p1',
      setup(scope) {
        scope.onAppShutdown(() => {
          order.push('p1')
        })
      },
    })
    host.mount({
      id: 'p2',
      setup(scope) {
        scope.onAppShutdown(() => {
          order.push('p2')
        })
      },
    })

    await host.shutdown()
    expect(order).toEqual(['p2', 'p1'])
    expect(host.getMountedIds()).toEqual([])
  })
})
