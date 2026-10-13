import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { NodeSessionRecord } from '@superone/runtime/session'
import { createOpenCodeAppServerTurnRunner } from './run-turn'

const server = vi.hoisted(() => ({
  url: 'http://native.invalid',
  protocol: 'v2',
  password: 'fixture',
  exited: null,
  close: vi.fn(async () => {}),
}))
vi.mock('./server', () => ({ startOpenCodeServer: async () => server }))

function session(): NodeSessionRecord {
  return {
    sessionId: 'host',
    projectId: 'p',
    harnessId: 'opencode',
    providerId: 'opencode',
    title: null,
    status: 'streaming',
    transcript: [],
    pendingInteraction: null,
    providerResume: null,
    cwd: '/tmp',
    createdAt: 0,
    updatedAt: 0,
    isPinned: false,
    isHidden: false,
    isUserRenamed: false,
    controllerClientSessionId: null,
    hostActionCapabilityVersion: 0,
    hostActionToolGroups: [],
    alwaysAllowedTools: [],
  }
}
const tokens = { input: 10, output: 2, reasoning: 1, cache: { read: 3, write: 0 } }
const model = {
  id: 'm',
  providerID: 'p',
  name: 'Model',
  enabled: true,
  variants: [{ id: 'high' }],
  limit: { context: 1000 },
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

describe('native V2 node turn', () => {
  let stream: ReadableStreamDefaultController<Uint8Array>
  let permission = false,
    question = false,
    hold = false,
    promptFailure = false,
    completedResponseLost = false
  let requests: Array<{ url: URL; init: RequestInit }>
  const emit = (type: string, data: unknown) =>
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: type, type, data })}\n\n`))
  const finish = () => {
    emit('session.text.delta', { sessionID: 'ses_native', assistantMessageID: 'a', ordinal: 0, delta: 'hello' })
    emit('session.text.ended', { sessionID: 'ses_native', assistantMessageID: 'a', ordinal: 0, text: 'hello native' })
    emit('session.step.ended', { sessionID: 'ses_native', assistantMessageID: 'a', cost: 0, tokens, finish: 'stop' })
    emit('session.execution.succeeded', { sessionID: 'ses_native' })
  }
  beforeEach(() => {
    permission = question = hold = promptFailure = completedResponseLost = false
    requests = []
    server.close.mockClear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (value: string, init: RequestInit) => {
        init.signal?.throwIfAborted()
        const url = new URL(value),
          path = url.pathname
        requests.push({ url, init })
        expect(new Headers(init.headers).get('Authorization')).toBe(
          `Basic ${Buffer.from('opencode:fixture').toString('base64')}`,
        )
        if (path === '/api/event')
          return new Response(
            new ReadableStream({
              start(controller) {
                stream = controller
                emit('server.connected', {})
                init.signal?.addEventListener(
                  'abort',
                  () => {
                    try {
                      controller.close()
                    } catch {}
                  },
                  { once: true },
                )
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          )
        if (path.endsWith('/log'))
          return new Response('data: {"type":"log.synced","aggregateID":"ses_native","seq":0}\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          })
        if (path === '/api/session' || (path === '/api/session/ses_native' && init.method === 'GET'))
          return json({
            data: {
              id: 'ses_native',
              location: { directory: '/private/tmp' },
              agent: 'build',
              permissions: [{ action: 'edit', resource: '/protected', effect: 'deny' }],
            },
          })
        if (path === '/api/agent')
          return json({
            data: [
              { id: 'build', name: 'Build', mode: 'primary' },
              { id: 'plan', name: 'Plan', mode: 'primary' },
            ],
          })
        if (path === '/api/model') return json({ data: [model] })
        if (path === '/api/model/default') return json({ data: model })
        if (path === '/api/provider') return json({ data: [{ id: 'p', name: 'Provider' }] })
        if (path === '/api/skill')
          return json({
            data: [
              {
                id: 'skill_review',
                name: 'review',
                description: 'Review',
                content: 'private instructions',
                path: '/private/skill',
              },
            ],
          })
        if (path === '/api/command' || path.endsWith('/permission') || path.endsWith('/form')) return json({ data: [] })
        if (path.endsWith('/message')) return json({ data: [], cursor: {} })
        if (path.endsWith('/prompt')) {
          if (promptFailure) throw new Error('lost acknowledgement')
          emit('session.inbox.enqueued', {
            sessionID: 'ses_native',
            inboxID: 'u',
            item: { type: 'user', payload: { metadata: { superoneClientMessageId: 'user' } } },
          })
          emit('session.execution.started', { sessionID: 'ses_native' })
          emit('session.inbox.delivered', { sessionID: 'ses_native', inboxID: 'u' })
          emit('session.step.started', {
            sessionID: 'ses_native',
            assistantMessageID: 'a',
            agent: 'build',
            model: { providerID: 'p', id: 'm' },
          })
          emit('session.tool.input.started', {
            sessionID: 'ses_native',
            assistantMessageID: 'a',
            id: 'tool',
            name: 'superone_session_rename',
          })
          emit('session.tool.called', {
            sessionID: 'ses_native',
            assistantMessageID: 'a',
            id: 'tool',
            input: { title: 'Native node' },
          })
          emit('session.tool.success', {
            sessionID: 'ses_native',
            assistantMessageID: 'a',
            id: 'tool',
            content: [{ type: 'text', text: 'renamed' }],
          })
          if (permission)
            emit('permission.asked', { sessionID: 'ses_native', id: 'perm', action: 'edit', resources: ['/file'] })
          else if (question)
            emit('form.created', {
              form: {
                id: 'form',
                sessionID: 'ses_native',
                title: 'Choose',
                fields: [
                  {
                    key: 'choice',
                    title: 'Choose',
                    description: 'Which?',
                    type: 'string',
                    options: [{ label: 'Yes', value: 'yes' }],
                  },
                ],
              },
            })
          else if (!hold) finish()
          if (completedResponseLost) {
            await new Promise((resolve) => setTimeout(resolve, 10))
            throw new Error('lost completed acknowledgement')
          }
          return json({ data: { id: 'u' } })
        }
        if (path.endsWith('/reply')) finish()
        return new Response(null, { status: 204 })
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())
  function run(overrides: Partial<Parameters<ReturnType<typeof createOpenCodeAppServerTurnRunner>>[0]> = {}) {
    const events: AgentEvent[] = [],
      deltas: string[] = [],
      accepted = vi.fn(),
      resumed = vi.fn()
    const runner = createOpenCodeAppServerTurnRunner(() => '/tmp', {
      superoneMcp: { url: 'http://host/mcp', headers: { Authorization: 'fixture-host' } },
    })
    const result = runner({
      session: session(),
      messageId: 'assistant',
      clientMessageId: 'user',
      text: 'go',
      model: 'p/m',
      effort: 'high',
      onDelta: (delta) => deltas.push(delta),
      onAgentEvent: (event) => events.push(event),
      onInputAccepted: accepted,
      onProviderResume: resumed,
      signal: new AbortController().signal,
      ...overrides,
    })
    return { result, events, deltas, accepted, resumed }
  }
  it('warms the published SDK, injects direct host tools and emits one authoritative turn', async () => {
    const { result, events, deltas, accepted, resumed } = run()
    expect(await result).toEqual({ finalText: 'hello native', providerResume: 'opencode:ses_native' })
    expect(deltas).toEqual([])
    expect(accepted).toHaveBeenCalledOnce()
    expect(resumed).toHaveBeenCalledWith('opencode:ses_native')
    expect(events.filter((event) => event.type === 'message_complete')).toHaveLength(1)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'content_delta',
        delta: expect.objectContaining({ toolName: 'mcp__superone__session_rename' }),
      }),
    )
    const mcp = requests.find(({ url }) => url.pathname === '/api/experimental/mcp/superone')!
    expect(JSON.parse(mcp.init.body as string)).toMatchObject({
      config: { codemode: false, headers: { Authorization: 'fixture-host' } },
    })
    const create = requests.find(({ url }) => url.pathname === '/api/session')!
    expect(JSON.parse(create.init.body as string).permissions).not.toContainEqual({
      action: '*',
      resource: '*',
      effect: 'allow',
    })
    expect(requests.findIndex(({ url }) => url.pathname === '/api/event')).toBeLessThan(
      requests.findIndex(({ url }) => url.pathname.endsWith('/prompt')),
    )
    expect(server.close).toHaveBeenCalledOnce()
  })
  it('resumes the native session, preserves deny rules and switches explicit agents and effort', async () => {
    await run({ session: { ...session(), providerResume: 'opencode:ses_native', agent: 'plan' } }).result
    expect(requests.some(({ url, init }) => url.pathname === '/api/session' && init.method === 'POST')).toBe(false)
    expect(
      JSON.parse(
        requests.find(({ url, init }) => url.pathname === '/api/session/ses_native' && init.method === 'PATCH')!.init
          .body as string,
      ).permissions,
    ).toContainEqual({ action: 'edit', resource: '/protected', effect: 'deny' })
    expect(
      JSON.parse(requests.find(({ url }) => url.pathname.endsWith('/ses_native/agent'))!.init.body as string),
    ).toEqual({
      agent: 'plan',
    })
  })
  it('awaits the host permission waiter and replies only after its decision', async () => {
    permission = true
    let allow!: (value: 'allow') => void
    const waiter = vi.fn(
      () =>
        new Promise<'allow'>((resolve) => {
          allow = resolve
        }),
    )
    const { result } = run({ onPermission: waiter })
    await vi.waitFor(() => expect(waiter).toHaveBeenCalledOnce())
    expect(waiter).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionDetails: expect.objectContaining({ action: 'edit', resources: ['/file'] }),
        allowAlwaysAllow: false,
      }),
    )
    expect(requests.some(({ url }) => url.pathname.endsWith('/reply'))).toBe(false)
    allow('allow')
    await result
    expect(
      JSON.parse(requests.find(({ url }) => url.pathname.endsWith('/permission/perm/reply'))!.init.body as string),
    ).toEqual({ decision: 'once' })
  })
  it('maps controller question labels to native field values', async () => {
    question = true
    await run({ onQuestion: async () => ({ 'Which?': 'Yes' }) }).result
    expect(
      JSON.parse(requests.find(({ url }) => url.pathname.endsWith('/form/form/reply'))!.init.body as string),
    ).toEqual({ answer: { choice: 'yes' } })
  })
  it('uses native skill ids and exposes no skill source in the catalog', async () => {
    const { result, events } = run({ text: '/review focus on tests' })
    await result
    expect(JSON.parse(requests.find(({ url }) => url.pathname.endsWith('/prompt'))!.init.body as string)).toMatchObject(
      { text: 'focus on tests', skills: [{ id: 'skill_review' }] },
    )
    expect(JSON.stringify(events.find((event) => event.type === 'session_agents'))).not.toContain(
      'private instructions',
    )
  })
  it('interrupts a waiting native execution and closes only its owned server', async () => {
    hold = true
    const abort = new AbortController(),
      { result } = run({ signal: abort.signal })
    const rejected = expect(result).rejects.toThrow()
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname.endsWith('/prompt'))).toBe(true))
    abort.abort()
    await rejected
    expect(requests.some(({ url }) => url.pathname.endsWith('/interrupt'))).toBe(true)
    expect(server.close).toHaveBeenCalledOnce()
  })
  it('keeps uncertain delivery accepted and persists the native resume id before the lost acknowledgement', async () => {
    promptFailure = true
    const { result, accepted, resumed } = run()
    await expect(result).rejects.toThrow('lost acknowledgement')
    expect(accepted).toHaveBeenCalledOnce()
    expect(resumed).toHaveBeenCalledOnce()
    expect(requests.filter(({ url }) => url.pathname.endsWith('/prompt'))).toHaveLength(1)
  })
  it('rejects native sharing before admitting or prompting', async () => {
    const { result, accepted } = run({ text: '/share' })
    await expect(result).rejects.toThrow('Session sharing is not available')
    expect(accepted).not.toHaveBeenCalled()
    expect(requests).toEqual([])
  })
  it('retains confirmed native success when only its HTTP acknowledgement is lost', async () => {
    completedResponseLost = true
    const { result, events } = run()
    expect(await result).toEqual({ finalText: 'hello native', providerResume: 'opencode:ses_native' })
    expect(events.filter((event) => event.type === 'message_complete')).toHaveLength(1)
    expect(events.some((event) => event.type === 'message_error')).toBe(false)
    expect(requests.filter(({ url }) => url.pathname.endsWith('/prompt'))).toHaveLength(1)
  })
})
