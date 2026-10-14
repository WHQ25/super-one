import { AsyncLocalStorage } from 'node:async_hooks'
import type { IpcMain } from 'electron'
import type { MutatingControlContext } from '@superone/shared/environment'
import { bindControlActor, type ControlLeaseService } from '@superone/runtime/lease'

interface ControlScope {
  clientSessionId: string
  proofs: Map<string, MutatingControlContext>
  acquire: boolean
}

const scopes = new AsyncLocalStorage<ControlScope>()
export const currentControlScope = () => scopes.getStore()

/** Internal host reactions (such as a removed cwd) cannot wait for a frontend's grant. */
export function runHostReaction<T>(fn: () => T): T { return scopes.exit(fn) }

/**
 * Every call runs as host work. A runtime spawned inside a frontend request
 * would otherwise keep that request's scope for its whole life, and its later
 * callbacks (agent tool calls, hooks) would act with the requester's grant.
 */
export function hostOwned<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, key) {
      const value = Reflect.get(obj, key, obj)
      return typeof value === 'function'
        ? (...args: unknown[]) => runHostReaction(() => Reflect.apply(value, obj, args))
        : value
    },
  })
}

/** A host boundary supplies the actor; request payloads never choose it. */
export function runWindowControl<T>(windowId: number, fn: () => T): T {
  return scopes.run({ clientSessionId: `ipc:${windowId}`, proofs: new Map(), acquire: true }, fn)
}

/** The host revalidates this exact grant across asynchronous admission work. */
export function runFencedSessionControl<T>(sessionId: string, clientSessionId: string, proof: MutatingControlContext, fn: () => T): T {
  return scopes.run({ clientSessionId, proofs: new Map([[sessionId, proof]]), acquire: false }, fn)
}

/** Shared RPC handlers require an explicit grant, never implicit control. */
export function runRpcControl<T>(clientSessionId: string, payload: unknown, fn: () => T): T {
  const p = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const proofs = new Map<string, MutatingControlContext>()
  if (typeof p.sessionId === 'string' && typeof p.leaseId === 'string' && typeof p.generation === 'string') {
    proofs.set(p.sessionId, { leaseId: p.leaseId, generation: p.generation })
  }
  return scopes.run({ clientSessionId, proofs, acquire: false }, fn)
}

/** A controller desktop: an authenticated client that is neither a phone nor this desktop's window. */
export function isControllerClient(clientSessionId: string): boolean {
  return !clientSessionId.startsWith('phone:') && !clientSessionId.startsWith('ipc:')
}

/**
 * The lease actor a client of this desktop acts as. Its window (`ipc:`) and
 * phones (`phone:`) are delegates of the desktop's own holder; the window
 * steps aside for anyone, a phone for no one. A controller desktop holds
 * leases under its own client session.
 */
export function controlActorFor(leases: ControlLeaseService, environmentId: string, clientSessionId: string) {
  if (isControllerClient(clientSessionId)) return leases
  const window = clientSessionId.startsWith('ipc:')
  return bindControlActor(leases, {
    clientSessionId,
    holderClientId: `desktop:${environmentId}`,
    delegate: window ? clientSessionId.replace(/^ipc:/, 'window:') : clientSessionId,
    yields: window ? 'any' : 'none',
  })
}

export function windowControlIpc(ipc: Pick<IpcMain, 'handle'>): Pick<IpcMain, 'handle'> {
  return { handle: (channel, handler) => ipc.handle(channel, (event, ...args) => runWindowControl(event.sender.id, () => handler(event, ...args))) }
}
