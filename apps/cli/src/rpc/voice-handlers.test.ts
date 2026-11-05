import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { NodeSessionRecord, TurnRunner } from '@superone/runtime/session'
import { codexVoiceConsumesNotification } from '../session/codex-turn-runner'
import { withSessionZone } from '../session/session-zone-runner'
import { dispatchVoiceRpc, resetCliVoiceHostForTests } from './voice-handlers'
import type { RpcContext } from './handlers'

let syncRoot: string | undefined
afterEach(() => {
  resetCliVoiceHostForTests()
  if (syncRoot) rmSync(syncRoot, { recursive: true, force: true })
  syncRoot = undefined
})

function session(patch: Partial<NodeSessionRecord> = {}): NodeSessionRecord {
  return {
    sessionId: 'sid',
    projectId: 'proj',
    harnessId: 'codex',
    providerId: 'codex',
    title: null,
    status: 'idle',
    transcript: [],
    pendingInteraction: null,
    providerResume: null,
    cwd: '/work/app',
    model: 'gpt-5',
    effort: 'high',
    apiProviderId: 'codex-account:cli',
    createdAt: 0,
    updatedAt: 0,
    isPinned: false,
    isHidden: false,
    isUserRenamed: false,
    controllerClientSessionId: null,
    hostActionCapabilityVersion: 0,
    hostActionToolGroups: [],
    alwaysAllowedTools: [],
    ...patch,
  }
}

describe('codex voice notification drain', () => {
  it('consumes realtime notifications and every notification while a call is active', () => {
    expect(codexVoiceConsumesNotification(undefined, 'thread/realtime/sdp')).toBe(false)
    expect(codexVoiceConsumesNotification({ voiceActive: false }, 'thread/realtime/sdp')).toBe(true)
    expect(codexVoiceConsumesNotification({ voiceActive: false }, 'turn/started')).toBe(false)
    expect(codexVoiceConsumesNotification({ voiceActive: true }, 'turn/started')).toBe(true)
  })
})

describe('dispatchVoiceRpc', () => {
  it('starts voice through the session-zone runner and pushes the SDP answer instead of storing it', async () => {
    const published: AgentEvent[] = []
    const pushed: unknown[] = []
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = []
    let listener: ((notification: { method: string; params: Record<string, unknown> }) => void) | null = null
    const setVoiceActive = vi.fn()
    const noteProviderResume = vi.fn()
    const open = vi.fn(async () => ({
      threadId: 'thread-1',
      request: async (method: string, params?: Record<string, unknown>) => {
        calls.push({ method, params })
        if (method === 'thread/realtime/start') {
          listener?.({ method: 'thread/realtime/sdp', params: { sdp: 'v=0\r\na=answer' } })
          listener?.({
            method: 'thread/realtime/item/started',
            params: { item: { type: 'transcriptSegment', id: 'item-1', realtimeSessionId: 'rt-1', role: 'user', text: 'hello' } },
          })
          listener?.({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } })
        }
        return {}
      },
      subscribe: (fn: (notification: { method: string; params: Record<string, unknown> }) => void) => {
        listener = fn
        return () => { if (listener === fn) listener = null }
      },
      setVoiceActive,
    }))
    syncRoot = mkdtempSync(join(tmpdir(), 'voice-rpc-'))
    const inner: TurnRunner = vi.fn(async () => ({ finalText: '' }))
    inner.codexVoice = { open }
    const runner = withSessionZone(inner, syncRoot)
    const assertValid = vi.fn()
    const ctx = {
      client: { clientSessionId: 'desktop-1', scopes: ['session:operate', 'session:read'] },
      identity: { environmentId: 'env-1' },
      leases: { assertValid },
      projects: { get: () => ({ projectId: 'proj', path: '/work/app', name: 'app' }) },
      streams: { push: (message: unknown) => { pushed.push(message) } },
      sessions: {
        get: () => session(),
        codexVoice: () => runner.codexVoice,
        publishHarnessEvent: (_sessionId: string, event: AgentEvent) => { published.push(event) },
        noteProviderResume,
      },
    } as unknown as RpcContext

    const result = await dispatchVoiceRpc('session.voiceStart', {
      sessionId: 'sid',
      attemptId: 'attempt-1',
      leaseId: 'lease-1',
      generation: 'g1',
      request: { sdp: 'v=0\r\na=offer', voice: 'juniper' },
    }, ctx)

    await vi.waitFor(() => { expect(pushed.length).toBeGreaterThan(0) })
    expect(result).toMatchObject({ result: { protocol: 1, supported: true, call: { owned: true, attemptId: 'attempt-1', state: 'starting' } } })
    expect(assertValid).toHaveBeenCalledWith(expect.objectContaining({
      leaseId: 'lease-1',
      generation: 'g1',
      holderClientId: 'desktop-1',
    }))
    expect(open).toHaveBeenCalledOnce()
    expect(inner).not.toHaveBeenCalled()
    expect(calls.map((call) => call.method)).toEqual(['thread/settings/update', 'thread/realtime/start'])
    expect(calls[1]?.params).toMatchObject({
      threadId: 'thread-1',
      version: 'v3',
      voice: 'juniper',
      transport: { type: 'webrtc', sdp: 'v=0\r\na=offer' },
      initialItems: [{ role: 'developer', text: expect.stringContaining('SuperOne realtime voice session') }],
    })
    expect(calls[0]?.params).toMatchObject({ threadId: 'thread-1', model: 'gpt-5', effort: 'high', summary: 'concise' })
    expect(setVoiceActive).toHaveBeenCalledWith(true)
    expect(pushed).toEqual([expect.objectContaining({
      type: 'client',
      event: expect.objectContaining({
        type: 'realtime_call_signal',
        sessionId: 'sid',
        projectPath: '/work/app',
        signal: expect.objectContaining({ kind: 'answer', sdp: 'v=0\r\na=answer', attemptId: 'attempt-1' }),
      }),
    })])
    expect(published.some((event) => event.type === 'realtime_sdp' || event.type === 'realtime_call_signal')).toBe(false)
    expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'realtime_transcript_item', phase: 'started', itemId: 'item-1', text: 'hello' }),
      expect.objectContaining({ type: 'message_start' }),
    ]))
    expect(noteProviderResume).toHaveBeenCalledWith('sid', 'thread-1')
  })

  it('refuses a non-official Codex account before opening the app-server', async () => {
    const open = vi.fn()
    const ctx = {
      client: { clientSessionId: 'desktop-1', scopes: ['session:operate'] },
      identity: { environmentId: 'env-1' },
      leases: { assertValid: vi.fn() },
      projects: { get: () => ({ path: '/work/app' }) },
      streams: { push: vi.fn() },
      sessions: {
        get: () => session({ apiProviderId: 'openai-custom' }),
        codexVoice: () => ({ open }),
        publishHarnessEvent: vi.fn(),
        noteProviderResume: vi.fn(),
      },
    } as unknown as RpcContext

    const result = await dispatchVoiceRpc('session.voiceStart', {
      sessionId: 'sid',
      attemptId: 'attempt-1',
      leaseId: 'lease-1',
      generation: 'g1',
      request: { sdp: 'v=0\r\na=offer' },
    }, ctx)

    expect(result).toMatchObject({ error: { code: 'failed_precondition' } })
    expect(open).not.toHaveBeenCalled()
  })
})
