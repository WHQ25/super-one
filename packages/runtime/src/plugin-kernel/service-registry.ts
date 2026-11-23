import type { Disposable, DisposableScope } from './disposable'

export interface ServiceToken<T> {
  readonly id: symbol
  readonly name: string
  readonly _type?: T
}

export function createServiceToken<T>(name: string): ServiceToken<T> {
  return { id: Symbol(name), name }
}

export interface ServiceRegistry {
  provide<T>(token: ServiceToken<T>, instance: T, scope?: DisposableScope): Disposable
  get<T>(token: ServiceToken<T>): T | undefined
  has<T>(token: ServiceToken<T>): boolean
  require<T>(token: ServiceToken<T>): T
}

export function createServiceRegistry(): ServiceRegistry {
  const services = new Map<symbol, unknown>()

  return {
    provide<T>(token: ServiceToken<T>, instance: T, scope?: DisposableScope): Disposable {
      if (services.has(token.id)) {
        throw new Error(`Service "${token.name}" is already registered`)
      }
      services.set(token.id, instance)
      const remove = () => {
        if (services.get(token.id) === instance) {
          services.delete(token.id)
        }
      }
      const disposable = {
        dispose: remove,
        [Symbol.dispose]: remove,
      }
      scope?.onDispose(remove)
      return disposable
    },

    get<T>(token: ServiceToken<T>): T | undefined {
      return services.get(token.id) as T | undefined
    },

    has<T>(token: ServiceToken<T>): boolean {
      return services.has(token.id)
    },

    require<T>(token: ServiceToken<T>): T {
      if (!services.has(token.id)) {
        throw new Error(`Required service "${token.name}" is not registered`)
      }
      return services.get(token.id) as T
    },
  }
}
