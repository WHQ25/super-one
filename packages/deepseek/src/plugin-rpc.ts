import { Context, Service } from '@deepseek-ai/cordis'

export type PluginRpcHandler = (payload: unknown) => unknown | Promise<unknown>

export interface PluginRpcEventMessage {
  pluginId: string
  event: string
  payload: unknown
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginRpc: PluginRpcService
  }
}

export class PluginRpcNotFoundError extends Error {
  readonly code = 'method_not_found'
  constructor(pluginId: string, method: string) {
    super(`Plugin RPC method not registered: ${pluginId}#${method}`)
    this.name = 'PluginRpcNotFoundError'
  }
}

function resolveCallerPluginId(ctx: Context, explicitPluginId?: string): string {
  if (explicitPluginId) return explicitPluginId
  const entryId = (ctx.fiber as { entry?: { options?: { id?: string } } }).entry?.options?.id
  if (entryId?.startsWith('plugin-')) return entryId.slice('plugin-'.length)
  const runtimeName = ctx.fiber.runtime?.name
  if (runtimeName) return runtimeName
  throw new Error('pluginRpc requires a named plugin context or explicit pluginId')
}

export class PluginRpcService extends Service {
  private readonly handlers = new Map<string, PluginRpcHandler>()
  private readonly eventListeners = new Set<(message: PluginRpcEventMessage) => void>()

  constructor(ctx: Context) {
    super(ctx, 'pluginRpc')
  }

  private handlerKey(pluginId: string, method: string): string {
    return `${pluginId}\0${method}`
  }

  handle(method: string, handler: PluginRpcHandler, options?: { pluginId?: string }): () => void {
    const callerCtx = this.ctx
    const pluginId = resolveCallerPluginId(callerCtx, options?.pluginId)
    const key = this.handlerKey(pluginId, method)
    if (this.handlers.has(key)) {
      throw new Error(`Duplicate pluginRpc handler for ${pluginId}#${method}`)
    }
    this.handlers.set(key, handler)
    const remove = () => {
      if (this.handlers.get(key) === handler) {
        this.handlers.delete(key)
      }
    }
    const disposeEffect = callerCtx.effect(() => remove)
    return () => {
      remove()
      disposeEffect()
    }
  }

  emit(event: string, payload?: unknown, options?: { pluginId?: string }): void {
    const pluginId = resolveCallerPluginId(this.ctx, options?.pluginId)
    const message: PluginRpcEventMessage = { pluginId, event, payload }
    for (const listener of [...this.eventListeners]) {
      listener(message)
    }
  }

  async invoke(pluginId: string, method: string, payload?: unknown): Promise<unknown> {
    const handler = this.handlers.get(this.handlerKey(pluginId, method))
    if (!handler) {
      throw new PluginRpcNotFoundError(pluginId, method)
    }
    return await handler(payload)
  }

  subscribe(listener: (message: PluginRpcEventMessage) => void): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  hasHandler(pluginId: string, method: string): boolean {
    return this.handlers.has(this.handlerKey(pluginId, method))
  }
}
