import type { RelayClient } from '@superone/relay-client'
import type { RealtimeVoiceStartRequest } from '@superone/shared/agent-types'
import type { SessionRef } from '@superone/shared/environment/refs'
import type { VoiceIdentity, VoiceSession, VoiceStatus } from '@superone/shared/realtime-voice'
import type { VoiceControlPort } from './voice-service'

type Client = Pick<RelayClient, 'rpc' | 'controlledRpc' | 'resolveProject' | 'retainSession' | 'acquireControl'>
type Retained = { ref: SessionRef; release: ReturnType<RelayClient['retainSession']>; acquired: boolean; acquisition?: Promise<void> }

/** A call retains control separately from the visible chat feed. */
export function relayVoiceControl(client: Client, session: VoiceSession, additionalDirs?: string[], selection?: RealtimeVoiceStartRequest['selection']): VoiceControlPort {
  const resources = new Map<string, Retained>()
  let closed = false
  const key = (source: VoiceSession) => JSON.stringify([source.projectPath, source.sessionId])
  const resource = async (source: VoiceSession) => {
    const id = key(source)
    const existing = resources.get(id)
    if (existing) return existing
    const project = await client.resolveProject(source.projectPath)
    if (closed) throw new Error('Voice attempt ended')
    const raced = resources.get(id)
    if (raced) return raced
    const ref = { environmentId: project.environmentId, sessionId: source.sessionId }
    const entry: Retained = { ref, release: client.retainSession(ref, { acrossReconnect: true }), acquired: false }
    resources.set(id, entry)
    return entry
  }
  const validate = (result: VoiceStatus): VoiceStatus => {
    if (!result || result.protocol !== 1 || typeof result.supported !== 'boolean') throw new Error('Upgrade the desktop to enable voice.')
    return result
  }
  const acquire = async (entry: Retained) => {
    entry.acquisition ??= client.acquireControl(entry.ref).then(() => { entry.acquired = true })
    await entry.acquisition
    if (closed) throw new Error('Voice attempt ended')
  }
  const call = async (source: VoiceSession, method: string, payload: Record<string, unknown>) => {
    const entry = await resource(source)
    if (closed) throw new Error('Voice attempt ended')
    if (!entry.acquired) await acquire(entry)
    return validate(await client.controlledRpc<VoiceStatus>(entry.ref, method, payload))
  }
  return {
    fork: () => relayVoiceControl(client, session, additionalDirs, selection),
    status: async () => {
      const entry = await resource(session)
      const result = validate(await client.rpc<VoiceStatus>('session.voiceStatus', { sessionId: session.sessionId }, { environmentId: entry.ref.environmentId }))
      // A new encrypted channel lost its SDK proof. Reconcile only a live owned
      // call; a revoked/stopping call must never silently reacquire control.
      if (result.call?.owned && result.call.state !== 'stopping') {
        entry.acquisition = undefined
        await acquire(entry)
      }
      return result
    },
    start: (attemptId, sdp) => call(session, 'session.voiceStart', { attemptId, request: { sdp, ...(additionalDirs ? { additionalDirs } : {}), ...(selection ? { selection } : {}) } }),
    stop: (attemptId, source = session) => call(source, 'session.voiceStop', { attemptId }),
    ready: (identity: VoiceIdentity) => call(session, 'session.voiceReady', { attemptId: identity.attemptId, identity }),
    release: async () => {
      closed = true
      const entries = [...resources.values()]; resources.clear()
      await Promise.all(entries.map(async entry => {
        await entry.acquisition?.catch(() => {})
        await entry.release()
      }))
    },
  }
}
