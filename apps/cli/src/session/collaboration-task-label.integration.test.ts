import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import { openNodeDatabase } from '../db/database'
import { EventLog } from './event-log'
import { ControlLeaseService } from './control-lease'
import { SessionRuntime, type TurnRunner } from './session-runtime'

const runner: TurnRunner = async () => ({ finalText: 'done' })

/** A runtime whose only paired controller is labelled "Desktop A"; restart keeps the database. */
function node() {
  const directory = mkdtempSync(join(tmpdir(), 'collab-task-'))
  const db = openNodeDatabase(join(directory, 'state.sqlite'))
  const events = new EventLog(db, 'node')
  const leases = new ControlLeaseService(db)
  const start = () => new SessionRuntime(db, events, leases, 'node', runner, {
    controllerLabel: (clientSessionId) => (clientSessionId === 'client-a' ? 'Desktop A' : null),
  })
  return { db, events, leases, start, cleanup: () => { db.close(); rmSync(directory, { recursive: true, force: true }) } }
}

/** The launch task as the controller sees it live and as history after a restart. */
async function taskMetadata(n: ReturnType<typeof node>, runtime: SessionRuntime, sessionId: string) {
  await new Promise((resolve) => setTimeout(resolve, 20))
  const mapper = createNodeSessionEventMapper({ sessionId, projectPath: 'remote:node:project', providerId: 'claude' })
  const live = n.events.listAfter('0').flatMap((event) => mapper.map(event)).find((event) => event.type === 'user_message_appended')
  await runtime.dispose()
  const restarted = n.start()
  const history = restarted.listMessages({ sessionId }).messages.find((message) => message.role === 'user')
  await restarted.dispose()
  return { live: live && 'message' in live ? live.message.metadata : undefined, history: history?.metadata }
}

describe('collaboration launch tasks on a node', () => {
  it('names the controller device on a task its agent sent, whatever the controller claims', async () => {
    const n = node()
    const runtime = n.start()
    try {
      const session = runtime.create({ projectId: 'project', harnessId: 'claude' })
      const lease = n.leases.acquire({ resource: { environmentId: 'node', sessionId: session.sessionId }, holderClientId: 'client-a', ttlMs: 30_000 })
      await runtime.send({
        sessionId: session.sessionId, text: 'Fix the flaky upload test', echoUserMessage: true,
        collaboration: { kind: 'initial_task', fromSessionTitle: 'Someone else' },
        client: { clientSessionId: 'client-a' }, leaseId: lease.leaseId, generation: lease.generation,
      })
      const expected = { source: 'collaboration', collaboration: { kind: 'initial_task', direction: 'inbound', fromSessionTitle: 'Desktop A' } }
      expect(await taskMetadata(n, runtime, session.sessionId)).toEqual({ live: expected, history: expected })
    } finally { n.cleanup() }
  })

  it("names the parent session on a task from an agent on this node", async () => {
    const n = node()
    const runtime = n.start()
    try {
      const session = runtime.create({ projectId: 'project', harnessId: 'claude' })
      await runtime.sendWithoutLease({
        sessionId: session.sessionId, text: 'Port the relay client', source: 'collaboration',
        collaboration: { kind: 'initial_task', fromSessionTitle: 'Relay refactor' },
      })
      const expected = { source: 'collaboration', collaboration: { kind: 'initial_task', direction: 'inbound', fromSessionTitle: 'Relay refactor' } }
      expect(await taskMetadata(n, runtime, session.sessionId)).toEqual({ live: expected, history: expected })
    } finally { n.cleanup() }
  })
})
