/**
 * Test support: a `SessionRuntime` on in-memory ports around one real runner,
 * for checking which runner failures leave a message retryable under its id
 * (never delivered) and which hold it as a duplicate (delivered).
 */
import { SessionRuntime } from './session-runtime'
import type { LeaseGuard, SessionEventLog, SessionStore } from './ports'
import type { NodeSessionRecord, TurnRunner } from './types'

export function sendDeliveryHarness(runner: TurnRunner, harnessId: string, cwd?: string) {
  const rows = new Map<string, NodeSessionRecord>()
  const store: SessionStore = {
    loadAll: () => [...rows.values()].map((s) => structuredClone(s)),
    save: (s) => { rows.set(s.sessionId, structuredClone(s)) },
    delete: (id) => { rows.delete(id) },
  }
  const events: SessionEventLog = { headSequence: () => '0',
    onAppend: () => () => {}, listAfter: () => [], appendSession: () => {} }
  const leases: LeaseGuard = { assertValid: () => {} }
  const runtime = new SessionRuntime(store, events, leases, `env-${harnessId}`, runner)
  const { sessionId } = runtime.create({ projectId: 'p', harnessId, ...(cwd ? { cwd } : {}) })

  const settled = async (): Promise<NodeSessionRecord> => {
    for (let i = 0; i < 500; i++) {
      const s = runtime.get(sessionId)
      if (s && s.status !== 'streaming') return s
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error('turn never settled')
  }
  return {
    /** Send user message `id` and wait for its turn to settle. */
    async send(id: string, turn: { text?: string; model?: string } = {}): Promise<NodeSessionRecord> {
      await runtime.send({ sessionId, text: turn.text ?? 'task', model: turn.model, clientMessageId: id,
        client: { clientSessionId: 'c1' }, leaseId: 'l1', generation: 'g1' })
      return settled()
    },
    failureOf: (s: NodeSessionRecord, id: string) => s.transcript.find((t) => t.id === id)?.metadata?.sendFailure,
    lastAssistantText: (s: NodeSessionRecord) => s.transcript.filter((t) => t.role === 'assistant').at(-1)?.text,
  }
}
