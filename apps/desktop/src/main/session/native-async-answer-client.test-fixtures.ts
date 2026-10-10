import { acquirePhoneControl } from '../control-lease.test-fixtures'
import { answerRemoteAsyncQuestion } from '../agent/remote-async-question'
import { runFencedSessionControl } from './control-context'
import type { Session } from './session'
import type { SessionLeaseAuthority } from './session-lease'

/** Native mobile read/control contract over a real Session/backend; encrypted routing is checked separately. */
export function nativeAsyncAnswerClient(session: Session, authority: SessionLeaseAuthority) {
  let proof = acquirePhoneControl(authority, session.id, 'phone')
  return {
    environmentId: authority.environmentId,
    startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [] }),
    resolveProject: async () => ({ environmentId: authority.environmentId, projectId: 'p' }),
    stopSession: async () => {}, followSession: async () => {},
    acquireControl: async () => (proof = acquirePhoneControl(authority, session.id, 'phone')),
    async rpc(method: string) {
      if (method === 'session.load') return { sessionId: session.id, projectId: 'p', messages: session.snapshot.messages,
        state: { status: session.isStreaming() ? 'streaming' : 'idle', sessionProvider: 'codex' }, before: null,
        cursor: { sequence: '0', version: 0, epoch: 'test' } }
      if (method === 'environment.descriptor') return { capabilities: { methods: [] } }
      throw new Error(`Unexpected RPC ${method}`)
    },
    async controlledRpc(_resource: unknown, method: string, payload: { messageId: string; itemId: string; answers: string[] }) {
      if (method !== 'session.answerAsyncQuestion') throw new Error(`Unexpected controlled RPC ${method}`)
      return runFencedSessionControl(session.id, 'phone:phone', proof, async () => ({ reply: await answerRemoteAsyncQuestion(session, payload) }))
    },
  }
}
