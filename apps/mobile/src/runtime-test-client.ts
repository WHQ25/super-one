import { vi } from 'vitest'
import type { SessionLoadResult } from '@superone/shared/environment/session-messages'
import type { SessionRef } from '@superone/shared/environment/refs'

export function sessionLoadFixture(overrides: Partial<SessionLoadResult> = {}): SessionLoadResult {
  return { sessionId: 's', state: { status: 'idle', sessionProvider: 'claude' }, messages: [], before: null, after: null, cursor: { sequence: '0', epoch: 'epoch', version: 0 }, ...overrides }
}
export type TestRpc = { method: string; sessionId?: string; environmentId?: string; [key: string]: unknown }
/** A native RPC fake: test overrides and assertions see methods and payloads, never phone commands. */
export function runtimeTestClient(epoch = 1) {
  const sent: TestRpc[] = []
  const dispatch = vi.fn(async (call: TestRpc): Promise<any> => {
    sent.push(call)
    switch (call.method) {
      case 'environment.descriptor': return { capabilities: { methods: ['session.historyIndex'] } }
      case 'session.load': return sessionLoadFixture({ sessionId: call.sessionId ?? 's' })
      case 'session.create': return { sessionId: call.sessionId }
      case 'session.dequeue': return { removed: true }
      case 'harness.systemInfo': return { userSlashCommands: [{ name: 'help' }], permissionModes: ['default', 'plan'], models: [{ id: 'm' }] }
      case 'harness.projectResources': return { projectSlashCommands: [{ name: 'project' }], skills: [{ name: 'ship', description: 'Release' }] }
      case 'session.attachment':
        if (call.attachmentId === 'gone') throw Object.assign(new Error('That attachment is no longer available'), { code: 'not_found' })
        return { attachment: { id: call.attachmentId, name: call.name, mimeType: 'image/jpeg', base64: '/9j/' } }
      default: return { ok: true }
    }
  })
  return {
    sent, dispatch, environmentId: 'desktop', connected: true,
    startBuffering: vi.fn(), releaseBuffer: vi.fn(() => ({ epoch, batches: [] as unknown[][] })),
    stopSession: vi.fn(async () => {}), followSession: vi.fn(async () => {}), acquireControl: vi.fn(async () => {}),
    resolveProject: vi.fn(async (_path: string) => ({ environmentId: 'desktop', projectId: 'p' })),
    rpc: vi.fn((method: string, payload: any = {}, options: { environmentId?: string } = {}) => dispatch({ method, ...payload, environmentId: options.environmentId ?? 'desktop' })),
    controlledRpc: vi.fn((resource: SessionRef, method: string, payload: any = {}) => dispatch({ method, ...payload, ...resource })),
  }
}
