import { createDisposable, type Disposable, type DisposableScope } from './disposable'

export type HookMode = 'waterfall' | 'pipeline' | 'broadcast'

export interface HookRegistrationOptions {
  priority?: number
  scope?: DisposableScope
}

export type WaterfallHookHandler<Value, Ctx = void> = (
  value: Value,
  ctx: Ctx,
  signal?: AbortSignal,
) => Value | Promise<Value>

export type PipelineHookHandler<Input, Output, Ctx = void> = (
  input: Input,
  ctx: Ctx,
  next: (nextInput?: Input) => Promise<Output>,
  signal?: AbortSignal,
) => Output | Promise<Output>

export type BroadcastHookHandler<Payload, Ctx = void> = (
  payload: Payload,
  ctx: Ctx,
  signal?: AbortSignal,
) => void | Promise<void>

interface StoredHookHandler {
  seq: number
  priority: number
  fn: (...args: any[]) => any
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Hook aborted')
}

export interface HookBus {
  registerWaterfall<Value, Ctx = void>(
    hook: string,
    handler: WaterfallHookHandler<Value, Ctx>,
    options?: HookRegistrationOptions,
  ): Disposable
  registerPipeline<Input, Output, Ctx = void>(
    hook: string,
    handler: PipelineHookHandler<Input, Output, Ctx>,
    options?: HookRegistrationOptions,
  ): Disposable
  registerBroadcast<Payload, Ctx = void>(
    hook: string,
    handler: BroadcastHookHandler<Payload, Ctx>,
    options?: HookRegistrationOptions,
  ): Disposable
  waterfall<Value, Ctx = void>(hook: string, initial: Value, ctx: Ctx, signal?: AbortSignal): Promise<Value>
  pipeline<Input, Output, Ctx = void>(
    hook: string,
    initial: Input,
    ctx: Ctx,
    terminal: (input: Input, ctx: Ctx, signal?: AbortSignal) => Output | Promise<Output>,
    signal?: AbortSignal,
  ): Promise<Output>
  broadcast<Payload, Ctx = void>(hook: string, payload: Payload, ctx: Ctx, signal?: AbortSignal): Promise<void>
}

export function createHookBus(): HookBus {
  let nextSeq = 1
  const handlersByHook = new Map<string, StoredHookHandler[]>()

  function addHandler(
    hook: string,
    fn: (...args: any[]) => any,
    options?: HookRegistrationOptions,
  ): Disposable {
    const entry: StoredHookHandler = {
      seq: nextSeq++,
      priority: options?.priority ?? 0,
      fn,
    }
    let list = handlersByHook.get(hook)
    if (!list) {
      list = []
      handlersByHook.set(hook, list)
    }
    list.push(entry)
    const disposable = createDisposable(() => {
      const current = handlersByHook.get(hook)
      if (!current) return
      const idx = current.indexOf(entry)
      if (idx >= 0) current.splice(idx, 1)
      if (current.length === 0) handlersByHook.delete(hook)
    })
    options?.scope?.onDispose(() => disposable.dispose())
    return disposable
  }

  function sortedHandlers(hook: string): StoredHookHandler[] {
    const list = handlersByHook.get(hook)
    if (!list || list.length === 0) return []
    return [...list].sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq))
  }

  return {
    registerWaterfall(hook, handler, options) {
      return addHandler(hook, handler, options)
    },
    registerPipeline(hook, handler, options) {
      return addHandler(hook, handler, options)
    },
    registerBroadcast(hook, handler, options) {
      return addHandler(hook, handler, options)
    },

    async waterfall<Value, Ctx = void>(hook: string, initial: Value, ctx: Ctx, signal?: AbortSignal): Promise<Value> {
      let current = initial
      for (const entry of sortedHandlers(hook)) {
        throwIfAborted(signal)
        current = await entry.fn(current, ctx, signal)
      }
      return current
    },

    async pipeline<Input, Output, Ctx = void>(
      hook: string,
      initial: Input,
      ctx: Ctx,
      terminal: (input: Input, ctx: Ctx, signal?: AbortSignal) => Output | Promise<Output>,
      signal?: AbortSignal,
    ): Promise<Output> {
      const entries = sortedHandlers(hook)
      let index = 0
      const step = async (input: Input): Promise<Output> => {
        throwIfAborted(signal)
        if (index < entries.length) {
          const entry = entries[index++]
          return await entry.fn(
            input,
            ctx,
            (nextInput?: Input) => step(nextInput === undefined ? input : nextInput),
            signal,
          )
        }
        return await terminal(input, ctx, signal)
      }
      return await step(initial)
    },

    async broadcast<Payload, Ctx = void>(hook: string, payload: Payload, ctx: Ctx, signal?: AbortSignal): Promise<void> {
      for (const entry of sortedHandlers(hook)) {
        throwIfAborted(signal)
        await entry.fn(payload, ctx, signal)
      }
    },
  }
}
