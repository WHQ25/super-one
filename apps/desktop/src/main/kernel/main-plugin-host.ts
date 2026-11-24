import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  createRuntimePluginKernel,
  type Disposable,
  type DisposableScope,
  type HookBus,
  type RuntimePluginKernel,
  type ServiceRegistry,
  type ServiceToken,
} from '@superone/runtime/plugin-kernel'

export type MainIpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any

export interface MainPluginScope extends DisposableScope {
  readonly pluginId: string
  registerIpc(channel: string, handler: MainIpcHandler): Disposable
  provideService<T>(token: ServiceToken<T>, instance: T): Disposable
  onAppShutdown(fn: () => void | Promise<void>): Disposable
}

export interface MainPluginDefinition {
  id: string
  setup(scope: MainPluginScope, host: MainPluginHost): void | Promise<void>
}

export interface MountedMainPlugin extends Disposable {
  readonly id: string
  readonly scope: MainPluginScope
}

export class MainPluginHost {
  private readonly kernel: RuntimePluginKernel
  private readonly mounted = new Map<string, MountedMainPlugin>()
  private readonly shutdownHooks: Array<() => void | Promise<void>> = []
  private readonly ipcOwners = new Map<string, symbol>()

  constructor(kernel: RuntimePluginKernel = createRuntimePluginKernel()) {
    this.kernel = kernel
  }

  get services(): ServiceRegistry {
    return this.kernel.services
  }

  get hooks(): HookBus {
    return this.kernel.hooks
  }

  get rootScope(): DisposableScope {
    return this.kernel.scope
  }

  createPluginScope(pluginId: string): MainPluginScope {
    const host = this
    const base = this.kernel.scope.createChildScope()
    const registeredChannels = new Map<string, symbol>()
    const localShutdownHooks = new Set<() => void | Promise<void>>()

    base.onDispose(() => {
      for (const [channel, owner] of registeredChannels) {
        if (host.ipcOwners.get(channel) === owner) {
          host.ipcOwners.delete(channel)
          ipcMain.removeHandler(channel)
        }
      }
      registeredChannels.clear()
      for (const hook of localShutdownHooks) {
        const idx = host.shutdownHooks.indexOf(hook)
        if (idx >= 0) host.shutdownHooks.splice(idx, 1)
      }
      localShutdownHooks.clear()
    })

    const scope: MainPluginScope = {
      pluginId,
      get disposed() {
        return base.disposed
      },
      onDispose(fn) {
        return base.onDispose(fn)
      },
      createChildScope() {
        return base.createChildScope()
      },
      registerIpc(channel: string, handler: MainIpcHandler): Disposable {
        if (base.disposed) {
          return { dispose: () => {}, [Symbol.dispose]: () => {} }
        }
        const owner = Symbol(pluginId)
        host.ipcOwners.set(channel, owner)
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, handler)
        registeredChannels.set(channel, owner)
        const remove = () => {
          const trackedOwner = registeredChannels.get(channel)
          if (!trackedOwner) return
          registeredChannels.delete(channel)
          if (host.ipcOwners.get(channel) === trackedOwner) {
            host.ipcOwners.delete(channel)
            ipcMain.removeHandler(channel)
          }
        }
        return {
          dispose: remove,
          [Symbol.dispose]: remove,
        }
      },
      provideService<T>(token: ServiceToken<T>, instance: T): Disposable {
        return host.kernel.services.provide(token, instance, base)
      },
      onAppShutdown(fn: () => void | Promise<void>): Disposable {
        if (base.disposed) {
          return { dispose: () => {}, [Symbol.dispose]: () => {} }
        }
        host.shutdownHooks.push(fn)
        localShutdownHooks.add(fn)
        const remove = () => {
          localShutdownHooks.delete(fn)
          const idx = host.shutdownHooks.indexOf(fn)
          if (idx >= 0) host.shutdownHooks.splice(idx, 1)
        }
        return {
          dispose: remove,
          [Symbol.dispose]: remove,
        }
      },
      dispose() {
        base.dispose()
      },
      [Symbol.dispose]() {
        base.dispose()
      },
    }

    return scope
  }

  mount(plugin: MainPluginDefinition): MountedMainPlugin {
    const existing = this.mounted.get(plugin.id)
    if (existing) return existing

    const scope = this.createPluginScope(plugin.id)
    const mounted: MountedMainPlugin = {
      id: plugin.id,
      scope,
      dispose: () => {
        if (this.mounted.get(plugin.id) === mounted) {
          this.mounted.delete(plugin.id)
        }
        scope.dispose()
      },
      [Symbol.dispose]() {
        mounted.dispose()
      },
    }
    this.mounted.set(plugin.id, mounted)
    try {
      const result = plugin.setup(scope, this)
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch((error) => {
          console.error(`[main-plugin-host] async setup failed for ${plugin.id}:`, error)
          mounted.dispose()
        })
      }
    } catch (error) {
      mounted.dispose()
      throw error
    }
    return mounted
  }

  getMountedIds(): string[] {
    return [...this.mounted.keys()]
  }

  async shutdown(): Promise<void> {
    const hooks = [...this.shutdownHooks].reverse()
    for (const hook of hooks) {
      try {
        await hook()
      } catch (error) {
        console.error('[main-plugin-host] shutdown hook failed:', error)
      }
    }
    for (const mounted of [...this.mounted.values()]) {
      try {
        mounted.dispose()
      } catch (error) {
        console.error(`[main-plugin-host] dispose failed for ${mounted.id}:`, error)
      }
    }
    this.mounted.clear()
    try {
      this.kernel.dispose()
    } catch (error) {
      console.error('[main-plugin-host] kernel dispose failed:', error)
    }
  }
}

let singletonHost: MainPluginHost | null = null

export function getMainPluginHost(): MainPluginHost {
  if (!singletonHost) {
    singletonHost = new MainPluginHost()
  }
  return singletonHost
}

export function resetMainPluginHostForTest(): void {
  if (singletonHost) {
    void singletonHost.shutdown()
    singletonHost = null
  }
}
