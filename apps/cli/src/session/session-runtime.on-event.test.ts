import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SESSION_DURABLE_EVENT } from '@superone/shared/environment'
import { openNodeDatabase } from '../db/database'
import { EventLog } from './event-log'
import { ControlLeaseService } from './control-lease'
import {
  createSimulatedCodexRunner,
  SessionRuntime,
  type TurnRunner,
} from './session-runtime'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function boot(runner: TurnRunner) {
  const dir = mkdtempSync(join(tmpdir(), 'sroe-'))
  dirs.push(dir)
  const db = openNodeDatabase(join(dir, 'state.sqlite'))
  const envId = 'env-on-event'
  const events = new EventLog(db, envId)
  const leases = new ControlLeaseService(db)
  const runtime = new SessionRuntime(db, events, leases, envId, runner)
  return { db, events, leases, runtime, envId }
}

async function waitForIdle(runtime: SessionRuntime, sessionId: string, ms = 4000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const s = runtime.get(sessionId)
    if (s && s.status !== 'streaming') return s
    await new Promise((r) => setTimeout(r, 15))
  }
  return runtime.get(sessionId)
}

describe('SessionRuntime onEvent durable projection (Stage 5-A)', () => {
  it('projects structured text/tool/status events into the durable log', async () => {
    const { db, events, leases, runtime, envId } = boot(
      createSimulatedCodexRunner({
        delayMs: 5,
        chunks: ['Hi', '!'],
        emitStructuredEvents: true,
      }),
    )
    const session = runtime.create({ projectId: 'p1', harnessId: 'claude' })
    const lease = leases.acquire({
      resource: { environmentId: envId, sessionId: session.sessionId },
      holderClientId: 'c1',
      ttlMs: 30_000,
    })
    await runtime.send({
      sessionId: session.sessionId,
      text: 'go',
      client: { clientSessionId: 'c1' },
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    const done = await waitForIdle(runtime, session.sessionId)
    expect(done?.status).toBe('idle')

    const types = events.listAfter('0').map((e) => e.eventType)
    expect(types).toContain(SESSION_DURABLE_EVENT.turnStarted)
    expect(types).toContain(SESSION_DURABLE_EVENT.statusChanged)
    expect(types).toContain(SESSION_DURABLE_EVENT.toolStarted)
    expect(types).toContain(SESSION_DURABLE_EVENT.toolCompleted)
    expect(types).toContain(SESSION_DURABLE_EVENT.assistantDelta)
    expect(types).toContain(SESSION_DURABLE_EVENT.assistantText)
    expect(types).toContain(SESSION_DURABLE_EVENT.assistantMessage)
    expect(types).toContain(SESSION_DURABLE_EVENT.turnCompleted)

    // Status payload shape
    const statusEv = events.listAfter('0').find((e) => e.eventType === SESSION_DURABLE_EVENT.statusChanged)
    expect(statusEv?.payload).toMatchObject({ status: expect.any(String) })

    // Tool payload shape
    const toolStart = events.listAfter('0').find((e) => e.eventType === SESSION_DURABLE_EVENT.toolStarted)
    expect(toolStart?.payload).toMatchObject({
      toolUseId: expect.any(String),
      toolName: 'Read',
    })

    await runtime.dispose()
    db.close()
  })

  it('keeps Codex onDelta path without requiring onEvent', async () => {
    const onEventCalls: unknown[] = []
    const codexOnly: TurnRunner = async ({ onDelta, onEvent, signal }) => {
      // Capture whether runtime provided onEvent (it does) but Codex ignores it.
      if (onEvent) onEventCalls.push('provided')
      onDelta('codex-')
      onDelta('only')
      if (signal.aborted) throw new Error('aborted')
      return { finalText: 'codex-only', providerResume: 'thread:x' }
    }
    const { db, events, leases, runtime, envId } = boot(codexOnly)
    const session = runtime.create({ projectId: 'p1', harnessId: 'codex' })
    const lease = leases.acquire({
      resource: { environmentId: envId, sessionId: session.sessionId },
      holderClientId: 'c1',
      ttlMs: 30_000,
    })
    await runtime.send({
      sessionId: session.sessionId,
      text: 'ping',
      client: { clientSessionId: 'c1' },
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    const done = await waitForIdle(runtime, session.sessionId)
    expect(done?.status).toBe('idle')
    expect(done?.transcript.some((t) => t.text.includes('codex-only'))).toBe(true)

    const types = events.listAfter('0').map((e) => e.eventType)
    expect(types.filter((t) => t === SESSION_DURABLE_EVENT.assistantDelta).length).toBe(2)
    expect(types).toContain(SESSION_DURABLE_EVENT.turnCompleted)
    // No tool events when runner never calls onEvent with tool kinds
    expect(types).not.toContain(SESSION_DURABLE_EVENT.toolStarted)
    expect(onEventCalls).toEqual(['provided'])

    await runtime.dispose()
    db.close()
  })

  it('EventLog.appendSession writes session aggregate rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elog-'))
    dirs.push(dir)
    const db = openNodeDatabase(join(dir, 'state.sqlite'))
    const log = new EventLog(db, 'env-elog')
    const env = log.appendSession({
      sessionId: 's-1',
      eventType: SESSION_DURABLE_EVENT.toolStarted,
      payload: { toolUseId: 't', toolName: 'Bash' },
    })
    expect(env.aggregateType).toBe('session')
    expect(env.aggregateId).toBe('s-1')
    expect(env.eventType).toBe(SESSION_DURABLE_EVENT.toolStarted)
    expect(Number(env.sequence)).toBeGreaterThan(0)
    const listed = log.listAfter('0')
    expect(listed).toHaveLength(1)
    db.close()
  })
})
