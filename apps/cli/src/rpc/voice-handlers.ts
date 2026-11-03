import { OPERATION_SCOPES } from '@superone/shared/environment'
import type { RealtimeVoiceStartRequest } from '@superone/shared/agent-types'
import {
  redactVoiceText,
  validateVoiceAttempt,
  validateVoiceStart,
  type VoiceIdentity,
  type VoiceSignal,
} from '@superone/shared/realtime-voice'
import { mapThrown, requireScopes } from '@superone/runtime/server/rpc-helpers'
import type { RpcResult } from '@superone/runtime/server'
import type { NodeSessionRecord } from '@superone/runtime/session'
import { nodeVoiceHost, type NodeVoiceDeps } from '../session/node-voice-host'
import type { RpcContext } from './handlers'

export const VOICE_RPC_METHODS = new Set([
  'session.voiceStatus',
  'session.voiceStart',
  'session.voiceStop',
  'session.voiceReady',
])

function text(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`${key} is required`), { code: 'invalid_argument' })
  }
  return value
}

function invalid(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'Invalid voice request'
  return Object.assign(new Error(message), { code: 'invalid_argument' })
}

function projectPathOf(ctx: RpcContext, session: NodeSessionRecord): string {
  return ctx.projects?.get(session.projectId)?.path ?? session.cwd ?? ''
}

function voiceDeps(ctx: RpcContext, session: NodeSessionRecord): NodeVoiceDeps {
  const projectPath = projectPathOf(ctx, session)
  return {
    endpointId: ctx.client.clientSessionId,
    session,
    projectPath,
    open: (current) => {
      const port = ctx.sessions.codexVoice()
      if (!port) throw Object.assign(new Error('Voice is unavailable for this agent.'), { code: 'failed_precondition' })
      return port.open(current)
    },
    publish: (event) => ctx.sessions.publishHarnessEvent(session.sessionId, event),
    send: (signal: VoiceSignal) => {
      ctx.streams?.push({
        type: 'client',
        event: {
          type: 'realtime_call_signal',
          environmentId: ctx.identity.environmentId,
          sessionId: session.sessionId,
          projectPath,
          signal,
        },
      })
    },
    onThread: (threadId) => ctx.sessions.noteProviderResume(session.sessionId, threadId),
  }
}

function requireVoiceSession(ctx: RpcContext, sessionId: string): NodeSessionRecord {
  const session = ctx.sessions.get(sessionId)
  if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
  return session
}

function assertLease(ctx: RpcContext, sessionId: string, input: Record<string, unknown>): void {
  ctx.leases.assertValid({
    resource: { environmentId: ctx.identity.environmentId, sessionId },
    leaseId: text(input, 'leaseId'),
    generation: text(input, 'generation'),
    holderClientId: ctx.client.clientSessionId,
  })
}

/** Codex realtime voice for a controller of this node. SDP is a client push, not a transcript event. */
export async function dispatchVoiceRpc(method: string, payload: unknown, ctx: RpcContext): Promise<RpcResult | null> {
  if (!VOICE_RPC_METHODS.has(method)) return null
  const reading = method === 'session.voiceStatus'
  const denied = requireScopes(ctx.client, reading ? OPERATION_SCOPES.readSession : OPERATION_SCOPES.operateSession)
  if (denied) return denied
  if (!ctx.streams) return mapThrown(Object.assign(new Error('Voice requires a live connection'), { code: 'unavailable' }))
  const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  try {
    const sessionId = text(input, 'sessionId')
    const session = requireVoiceSession(ctx, sessionId)
    const deps = voiceDeps(ctx, session)
    if (reading) return { result: nodeVoiceHost.status(deps) }
    assertLease(ctx, sessionId, input)
    if (method === 'session.voiceStop') {
      validateVoiceAttempt(text(input, 'attemptId'))
      return { result: await nodeVoiceHost.stop(deps, text(input, 'attemptId')) }
    }
    if (method === 'session.voiceReady') {
      const identity = input.identity as VoiceIdentity | undefined
      const attemptId = text(input, 'attemptId')
      if (!identity || identity.attemptId !== attemptId || typeof identity.hostEpoch !== 'string'
        || typeof identity.callId !== 'string' || !Number.isSafeInteger(identity.generation)) {
        throw Object.assign(new Error('invalid voice identity'), { code: 'invalid_argument' })
      }
      return { result: nodeVoiceHost.ready(deps, identity) }
    }
    const attemptId = text(input, 'attemptId')
    if (!input.request || typeof input.request !== 'object' || Array.isArray(input.request)) {
      throw Object.assign(new Error('request is required'), { code: 'invalid_argument' })
    }
    try {
      validateVoiceAttempt(attemptId)
      validateVoiceStart(input.request as RealtimeVoiceStartRequest)
    } catch (error) { throw invalid(error) }
    return { result: nodeVoiceHost.start(deps, attemptId, input.request as RealtimeVoiceStartRequest) }
  } catch (error) {
    if (error instanceof Error) error.message = redactVoiceText(error.message)
    return mapThrown(error)
  }
}

/** Tests drop a call so its start timer cannot leak into the next case. */
export function resetCliVoiceHostForTests(): void {
  nodeVoiceHost.reset()
}
