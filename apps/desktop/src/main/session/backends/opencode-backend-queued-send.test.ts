import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { OpenCodeRuntime, OpenCodeRuntimeEvent, OpenCodeRuntimeOptions } from '../../opencode/opencode-runtime'

vi.mock('../../logger', () => ({ default: { debug: vi.fn(), warn: vi.fn() } }))
vi.mock('../../mcp-config-service', () => ({ listMcpConfigs: () => [] }))
vi.mock('../../mcp/superone-mcp-stdio-state', () => ({ getSuperoneMcpStdioConfig: () => null }))

import { OpenCodeBackend, setOpenCodeRuntimeFactory } from './opencode-backend'
import type { BackendStartOptions } from '../types'

function startOptions(): BackendStartOptions {
  return {
    sessionId: 'superone-session',
    projectPath: '/project',
    cwd: '/project',
    config: {},
    permissionMode: 'default',
    abortController: new AbortController(),
  }
}

describe('OpenCodeBackend queued send', () => {
  let route: (event: OpenCodeRuntimeEvent) => void
  let prompt: ReturnType<typeof vi.fn>
  let backend: OpenCodeBackend
  let events: AgentEvent[]

  /** Ends the live turn the way the OpenCode server would. */
  const goIdle = (id: string): void => {
    route({ id, type: 'session.idle', properties: { sessionID: 'oc-session' } } as OpenCodeRuntimeEvent)
  }

  const messageStarts = (): string[] =>
    events.filter((e) => e.type === 'message_start').map((e) => (e as { message: { id: string } }).message.id)

  beforeEach(async () => {
    route = () => undefined
    prompt = vi.fn(async () => undefined)
    // Minimal double: this suite only drives prompt + turn completion.
    const runtime = {
      sessionId: 'oc-session',
      models: [{ id: 'openai/gpt-5', name: 'GPT-5', description: '', contextWindow: 400_000 }],
      agents: [],
      commands: [],
      initialTodos: [],
      pendingPermissions: [],
      pendingQuestions: [],
      prompt,
      setModel: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      getContextUsage: vi.fn(async () => null),
      close: vi.fn(async () => undefined),
    } as unknown as OpenCodeRuntime
    setOpenCodeRuntimeFactory(async (opts: OpenCodeRuntimeOptions) => {
      route = opts.onEvent
      return runtime
    })
    backend = new OpenCodeBackend()
    events = []
    backend.onEvent((e) => events.push(e))
    await backend.start(startOptions())
  })

  afterEach(() => {
    setOpenCodeRuntimeFactory(null)
  })

  it('holds a queued message instead of throwing on the active turn', async () => {
    const first = backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())

    // Previously threw 'OpenCodeBackend already has an active turn', which
    // surfaced to the renderer as a failed send.
    await expect(
      backend.send({ content: 'second', clientMessageId: 'u2', priority: 'next' }),
    ).resolves.toBeUndefined()

    expect(prompt).toHaveBeenCalledOnce()
    expect(messageStarts()).toEqual(['a1'])
    expect(events.some((e) => e.type === 'queued_message_consumed')).toBe(false)

    goIdle('idle-1')
    await first
    // The queued turn starts on flush — settle it so nothing outlives the test.
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))
    goIdle('idle-2')
  })

  it('runs the queued message as its own turn once the live turn ends', async () => {
    const first = backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    await backend.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })

    goIdle('idle-1')
    await first
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))

    const consumed = events.filter((e) => e.type === 'queued_message_consumed')
    expect(consumed).toHaveLength(1)
    expect((consumed[0] as { clientMessageId: string }).clientMessageId).toBe('u2')
    const starts = messageStarts()
    expect(starts).toHaveLength(2)
    expect(starts[0]).toBe('a1')
    expect(starts[1]).not.toBe('a1')

    goIdle('idle-2')
  })

  it('drops a queued message that is dequeued before the turn ends', async () => {
    const first = backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    await backend.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })

    expect(backend.dequeueMessage('u2')).toBe(true)

    goIdle('idle-1')
    await first
    await new Promise((r) => setTimeout(r, 10))

    expect(prompt).toHaveBeenCalledOnce()
    expect(events.some((e) => e.type === 'queued_message_consumed')).toBe(false)
  })

  it('discards queued messages when the turn is interrupted', async () => {
    const first = backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    await backend.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })

    await backend.interrupt()
    goIdle('idle-1')
    await first
    await new Promise((r) => setTimeout(r, 10))

    expect(prompt).toHaveBeenCalledOnce()
    expect(events.some((e) => e.type === 'queued_message_consumed')).toBe(false)
  })
})
