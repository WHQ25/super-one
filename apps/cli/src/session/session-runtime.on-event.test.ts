import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SESSION_DURABLE_EVENT } from '@superone/shared/environment'
import { mapNodeSessionEvents } from '@superone/shared/node-session-event-map'
import type { ClaudeQueryFn } from '@superone/claude'
import { createCodexAgentEventMapper } from '@superone/codex'
import { createAcpAgentEventMapper } from '@superone/acp'
import { createOpenCodeAgentEventMapper } from '@superone/opencode'
import { openNodeDatabase } from '../db/database'
import { EventLog } from './event-log'
import { ControlLeaseService } from './control-lease'
import {
  createSimulatedCodexRunner,
  SessionRuntime,
  type TurnRunner,
} from './session-runtime'
import { createNodeClaudeTurnRunner } from './claude-turn-runner'

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
  it('carries mocked Claude SDK AgentEvents losslessly to the desktop mapper', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'sroe-claude-pipeline-'))
    dirs.push(projectDir)
    const binary = join(projectDir, 'claude')
    writeFileSync(binary, '#!/bin/sh\n')
    chmodSync(binary, 0o755)
    // Long-lived ClaudeLiveSession feeds the bridge; mock must wait for
    // each user message like the real Agent SDK query({ prompt: bridge }).
    const queryFn = (({ prompt }: { prompt: unknown }) =>
      (async function* () {
        for await (const _user of prompt as AsyncIterable<unknown>) {
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              delta: { type: 'thinking_delta', thinking: 'reasoning' },
            },
          }
          yield { type: 'system', subtype: 'task_started', task_id: 'bg1', description: 'work' }
          yield { type: 'prompt_suggestion', suggestion: 'continue' }
          yield { type: 'result', subtype: 'success', session_id: 'sdk-1', result: 'done' }
        }
      })()) as unknown as ClaudeQueryFn
    const runner = createNodeClaudeTurnRunner({
      binaryPath: binary,
      resolveProjectPath: () => projectDir,
      queryFn,
    })
    const { db, events, leases, runtime, envId } = boot(runner)
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
    await waitForIdle(runtime, session.sessionId)

    const mapped = mapNodeSessionEvents(events.listAfter('0'), {
      projectPath: 'remote:env:/project',
      sessionId: session.sessionId,
      providerId: 'claude',
    })
    expect(mapped).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'content_delta', delta: expect.objectContaining({ type: 'thinking', thinking: 'reasoning' }) }),
      expect.objectContaining({ type: 'task_started', taskId: 'bg1' }),
      expect.objectContaining({ type: 'prompt_suggestion', suggestion: 'continue' }),
      expect.objectContaining({ type: 'message_complete', metadata: expect.objectContaining({ resultText: 'done' }) }),
    ]))
    expect(mapped.filter((event) => event.type === 'message_complete')).toHaveLength(1)

    await runtime.dispose()
    db.close()
  })

  it('persists lossless AgentEvents with the runtime message id', async () => {
    const runner: TurnRunner = async ({ messageId, onAgentEvent }) => {
      onAgentEvent?.({
        type: 'content_delta',
        messageId: messageId!,
        delta: { type: 'thinking', thinking: 'reasoning' },
      })
      onAgentEvent?.({ type: 'prompt_suggestion', suggestion: 'continue' })
      onAgentEvent?.({ type: 'message_complete', messageId: messageId!, metadata: { costUsd: 0.2 } })
      onAgentEvent?.({ type: 'status_change', status: 'idle' })
      return { finalText: 'done' }
    }
    const { db, events, leases, runtime, envId } = boot(runner)
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
    await waitForIdle(runtime, session.sessionId)

    const rawEvents = events.listAfter('0').filter(
      (event) => event.eventType === SESSION_DURABLE_EVENT.agentEvent,
    )
    expect(rawEvents).toHaveLength(4)
    const first = rawEvents[0]?.payload as { event?: { messageId?: string; delta?: { type?: string } } }
    expect(first.event).toMatchObject({
      messageId: expect.any(String),
      delta: { type: 'thinking' },
    })

    await runtime.dispose()
    db.close()
  })

  it.each([
    {
      harnessId: 'codex',
      expectedType: 'codex_item_delta',
      runner: (messageId: string, emit: NonNullable<Parameters<TurnRunner>[0]['onAgentEvent']>) => {
        const mapper = createCodexAgentEventMapper({ messageId, emit })
        mapper.start('thread-1')
        mapper.apply({
          method: 'item/agentMessage/delta',
          params: { itemId: 'answer-1', delta: 'codex' },
        })
        mapper.apply({
          method: 'turn/completed',
          params: { turn: { id: 'turn-1', status: 'completed' } },
        })
        return 'codex'
      },
    },
    {
      harnessId: 'acp',
      expectedType: 'task_progress',
      runner: (messageId: string, emit: NonNullable<Parameters<TurnRunner>[0]['onAgentEvent']>) => {
        const mapper = createAcpAgentEventMapper({ messageId, emit })
        mapper.start('acp-1')
        mapper.apply({
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'reasoning' },
        } as never)
        mapper.apply({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'acp' },
        } as never)
        mapper.applyXaiNotification('x.ai/session_notification', {
          sessionId: 'acp-1',
          update: {
            sessionUpdate: 'workflow_updated',
            run_id: 'workflow-1',
            revision: 1,
            name: 'review',
            objective: 'Review changes',
            status: 'active',
            current_phase: 'Inspect',
          },
        })
        mapper.complete('end_turn')
        return 'acp'
      },
    },
    {
      harnessId: 'opencode',
      expectedType: 'todos_updated',
      runner: (messageId: string, emit: NonNullable<Parameters<TurnRunner>[0]['onAgentEvent']>) => {
        const mapper = createOpenCodeAgentEventMapper({ messageId, emit })
        mapper.start('open-1')
        mapper.apply({
          type: 'todo.updated',
          properties: {
            sessionID: 'open-1',
            todos: [{ content: 'verify', status: 'in_progress', priority: 'high' }],
          },
        } as never)
        mapper.complete()
        return 'opencode'
      },
    },
  ])('carries $harnessId core AgentEvents through the durable desktop path', async ({
    harnessId,
    expectedType,
    runner: project,
  }) => {
    const runner: TurnRunner = async ({ messageId, onAgentEvent }) => {
      const finalText = project(messageId!, onAgentEvent!)
      return { finalText }
    }
    const { db, events, leases, runtime, envId } = boot(runner)
    const session = runtime.create({ projectId: 'p1', harnessId })
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
    await waitForIdle(runtime, session.sessionId)

    const mapped = mapNodeSessionEvents(events.listAfter('0'), {
      projectPath: 'remote:env:/project',
      sessionId: session.sessionId,
      providerId: harnessId,
    })
    expect(mapped.some((event) => event.type === expectedType)).toBe(true)
    expect(mapped.filter((event) => event.type === 'message_complete')).toHaveLength(1)

    await runtime.dispose()
    db.close()
  })

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
