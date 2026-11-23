import { createDisposer } from './disposer'
import type {
  CommandDefinition,
  CommandInvocation,
  CommandMiddleware,
  CommandsBus,
  KernelDisposer,
  RegisteredCommandMeta,
} from './types'

interface StoredCommand {
  seq: number
  id: string
  title?: string
  category?: string
  priority: number
  handler: CommandDefinition['handler']
}

interface StoredMiddleware {
  seq: number
  commandId: string | '*'
  priority: number
  middleware: CommandMiddleware
}

export function createCommandsBus(): CommandsBus {
  let nextSeq = 1
  const commandsById = new Map<string, StoredCommand[]>()
  const middlewares: StoredMiddleware[] = []
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of [...listeners]) listener()
  }

  function activeCommand(id: string): StoredCommand | undefined {
    const list = commandsById.get(id)
    if (!list || list.length === 0) return undefined
    let best = list[0]
    for (let i = 1; i < list.length; i++) {
      const candidate = list[i]
      if (candidate.priority > best.priority || (candidate.priority === best.priority && candidate.seq > best.seq)) {
        best = candidate
      }
    }
    return best
  }

  return {
    registerCommand(definition: CommandDefinition): KernelDisposer {
      const entry: StoredCommand = {
        seq: nextSeq++,
        id: definition.id,
        title: definition.title,
        category: definition.category,
        priority: definition.priority ?? 0,
        handler: definition.handler,
      }
      let list = commandsById.get(definition.id)
      if (!list) {
        list = []
        commandsById.set(definition.id, list)
      }
      list.push(entry)
      notify()
      return createDisposer(() => {
        const current = commandsById.get(definition.id)
        if (!current) return
        const idx = current.indexOf(entry)
        if (idx >= 0) current.splice(idx, 1)
        if (current.length === 0) commandsById.delete(definition.id)
        notify()
      })
    },

    registerMiddleware(commandId: string | '*', middleware: CommandMiddleware, priority = 0): KernelDisposer {
      const entry: StoredMiddleware = {
        seq: nextSeq++,
        commandId,
        priority,
        middleware,
      }
      middlewares.push(entry)
      notify()
      return createDisposer(() => {
        const idx = middlewares.indexOf(entry)
        if (idx >= 0) middlewares.splice(idx, 1)
        notify()
      })
    },

    async executeCommand<Result = unknown>(id: string, ...args: unknown[]): Promise<Result> {
      const target = activeCommand(id)
      if (!target) {
        throw new Error(`Command "${id}" is not registered`)
      }
      const matching = middlewares
        .filter((m) => m.commandId === id || m.commandId === '*')
        .sort((a, b) => (b.priority - a.priority) || (b.seq - a.seq))

      const invocation: CommandInvocation = { id, args }
      let index = 0
      const dispatch = async (): Promise<unknown> => {
        if (index < matching.length) {
          const current = matching[index++]
          return current.middleware(invocation, dispatch)
        }
        return target.handler(...args)
      }
      return (await dispatch()) as Result
    },

    hasCommand(id: string): boolean {
      return activeCommand(id) !== undefined
    },

    listCommands(): readonly RegisteredCommandMeta[] {
      const result: RegisteredCommandMeta[] = []
      for (const id of commandsById.keys()) {
        const cmd = activeCommand(id)
        if (cmd) {
          result.push({
            id: cmd.id,
            title: cmd.title,
            category: cmd.category,
            priority: cmd.priority,
          })
        }
      }
      return result
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
