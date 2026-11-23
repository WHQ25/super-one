export * from './disposable'
export * from './service-registry'
export * from './hook-bus'

import { createDisposableScope, type DisposableScope } from './disposable'
import { createHookBus, type HookBus } from './hook-bus'
import { createServiceRegistry, type ServiceRegistry } from './service-registry'

export interface RuntimePluginKernel {
  readonly scope: DisposableScope
  readonly services: ServiceRegistry
  readonly hooks: HookBus
  dispose(): void
}

export function createRuntimePluginKernel(): RuntimePluginKernel {
  const scope = createDisposableScope()
  const services = createServiceRegistry()
  const hooks = createHookBus()

  return {
    scope,
    services,
    hooks,
    dispose() {
      scope.dispose()
    },
  }
}
