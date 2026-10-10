import { AsyncLocalStorage } from 'node:async_hooks'
import type { IpcMain } from 'electron'
import type { MutatingControlContext } from '@superone/shared/environment'

interface ControlScope {
  clientSessionId: string
  proofs: Map<string, MutatingControlContext>
  acquire: boolean
}

const scopes = new AsyncLocalStorage<ControlScope>()
export const currentControlScope = () => scopes.getStore()

/** Internal host reactions (such as a removed cwd) cannot wait for a frontend's grant. */
export function runHostReaction<T>(fn: () => T): T { return scopes.exit(fn) }

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

export function windowControlIpc(ipc: Pick<IpcMain, 'handle'>): Pick<IpcMain, 'handle'> {
  return { handle: (channel, handler) => ipc.handle(channel, (event, ...args) => runWindowControl(event.sender.id, () => handler(event, ...args))) }
}
