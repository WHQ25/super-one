import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeServerHandle } from './opencode-client'
import type { OpenCodeRuntimeEvent } from './opencode-runtime'

vi.mock('../logger', () => ({ default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('../mcp-config-service', () => ({ listMcpConfigs: () => [] }))
vi.mock('../mcp/superone-mcp-stdio-state', () => ({
  getSuperoneMcpHttpConfig: () => ({ url: 'http://host.invalid/mcp', headers: { Authorization: 'Bearer mock' } }),
  getSuperoneMcpStdioConfig: () => null,
}))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn(async () => undefined) } }))

import { createOpenCodeV2Runtime } from './opencode-v2-runtime'
import { OpenCodeV2TurnTranslator } from './opencode-v2-event-map'

const sessionID = 'ses_sdk'
const model = { id: 'm1', providerID: 'p', name: 'Model', enabled: true, variants: [{ id: 'high' }], limit: { context: 1000 } }
const tokens = { input: 10, output: 2, reasoning: 1, cache: { read: 3, write: 0 } }
const form = { id: 'frm_sdk', sessionID, title: 'Choose', fields: [{ key: 'choice', type: 'string', options: [{ label: 'Yes', value: 'yes' }] }] }
const permission = { id: 'perm_sdk', sessionID, action: 'edit', resources: ['/project/a.ts'] }

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

describe('OpenCode V2 runtime with the published SDK', () => {
  let stream: ReadableStreamDefaultController<Uint8Array>
  let streamSignal: AbortSignal
  let server: OpenCodeServerHandle
  let requests: Array<{ url: URL; init: RequestInit }>
  let session: { id: string; agent?: string; permissions: Array<{ action: string; resource: string; effect: 'deny' }>; location: { directory: string } }
  let pendingSnapshots: boolean
  let catalogVersion: number
  let oauthMode: 'auto' | 'code'
  let reloadDelay: number

  function emit(type: string, data: unknown, directory?: string) {
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: `e_${type}`, type, created: Date.now(), data, ...(directory ? { location: { directory } } : {}) })}\n\n`))
  }

  function start(providerSessionId?: string) {
    const events: OpenCodeRuntimeEvent[] = []
    const created = createOpenCodeV2Runtime(server, {
      sessionId: 'superone-sdk', cwd: '/project', config: {}, permissionMode: 'default', providerSessionId,
      onEvent: (event) => events.push(event),
    })
    return { created, events }
  }

  beforeEach(() => {
    requests = []
    pendingSnapshots = true
    catalogVersion = 0
    oauthMode = 'auto'
    reloadDelay = 0
    session = { id: sessionID, permissions: [], location: { directory: '/project' } }
    server = { url: 'http://opencode.invalid', protocol: 'v2', password: 'mock', exited: null, close: vi.fn(async () => undefined) }
    vi.stubGlobal('fetch', vi.fn(async (value: URL, init: RequestInit) => {
      const url = new URL(value)
      requests.push({ url, init })
      expect(new Headers(init.headers).get('Authorization')).toBe(`Basic ${Buffer.from('opencode:mock').toString('base64')}`)
      const path = url.pathname
      if (path === `/api/session/${sessionID}/inbox`) return json({ data: [] })
      if (path.endsWith('/log')) return new Response(`data: ${JSON.stringify({ type: 'log.synced', aggregateID: sessionID, seq: 0 })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
      if (path === '/api/event') {
        streamSignal = init.signal!
        return new Response(new ReadableStream({ start(controller) {
          stream = controller
          init.signal?.addEventListener('abort', () => {
            try { controller.close() } catch { /* transport already failed */ }
          }, { once: true })
        } }), { headers: { 'content-type': 'text/event-stream' } })
      }
      if (path === '/api/location/reload') {
        const loaded = () => { catalogVersion += 1; emit('agent.updated', {}, '/project') }
        if (reloadDelay) setTimeout(loaded, reloadDelay)
        else loaded()
        return new Response(null, { status: 204 })
      }
      if (path === '/api/agent') return json({ data: [{ id: 'build', name: 'Build', mode: 'primary', hidden: false }, { id: catalogVersion ? 'security' : 'reviewer', name: catalogVersion ? 'Security' : 'Reviewer', mode: 'primary', hidden: false }] })
      if (path === '/api/model') return json({ data: [model] })
      if (path === '/api/model/default') return json({ data: model })
      if (path === '/api/provider') return json({ data: [{ id: 'p', name: 'Provider' }] })
      if (path === '/api/command') return json({ data: [{ name: catalogVersion ? 'new-command' : 'review' }] })
      if (path === '/api/skill') return json({ data: [{ id: catalogVersion ? 'skill_new' : 'skill_sdk', name: catalogVersion ? 'new-skill' : 'skill-review', description: 'Review', path: '/project/SKILL.md', content: 'Review carefully' }] })
      if (path === '/api/mcp') return json({ data: [{ name: 'github', integrationID: 'mcp/github', status: { status: 'needs_auth' } }] })
      if (path === '/api/integration/mcp%2Fgithub') return json({ data: { id: 'mcp/github', name: 'GitHub', methods: [{ id: 'oauth', type: 'oauth', label: 'Sign in' }], connections: [] } })
      if (path.endsWith('/connect/oauth')) return json({ data: { attemptID: 'attempt_sdk', url: 'https://auth.example.com/authorize', mode: oauthMode, instructions: 'Sign in in your browser', time: { created: Date.now(), expires: Date.now() + 60_000 } } })
      if (path.endsWith('/connect/oauth/attempt_sdk') && init.method === 'GET') return json({ data: { status: 'complete', time: { created: Date.now(), expires: Date.now() + 60_000 } } })
      if (path === '/api/session' || path === `/api/session/${sessionID}` && init.method === 'GET') return json({ data: session })
      if (path.endsWith('/permission') && init.method === 'GET') return json({ data: pendingSnapshots ? [permission] : [] })
      if (path.endsWith('/form') && init.method === 'GET') return json({ data: pendingSnapshots ? [form] : [] })
      if (path.endsWith('/message')) return json({
        data: url.searchParams.get('type') === 'user'
          ? [{ id: 'input_sdk', type: 'user' }]
          : [{ id: 'assistant_sdk', type: 'assistant', model: { id: 'm1', providerID: 'p' }, tokens }],
        cursor: {},
      })
      if (path.endsWith('/diff')) return json({ data: [{ file: '/project/a.ts', additions: 1, deletions: 0 }] })
      if (path.endsWith('/prompt')) {
        emit('session.inbox.enqueued', { sessionID, inboxID: 'input_sdk', item: { type: 'user' } })
        emit('session.execution.started', { sessionID })
        emit('session.inbox.delivered', { sessionID, inboxID: 'input_sdk' })
        emit('session.step.started', { sessionID, assistantMessageID: 'assistant_sdk', agent: 'build', model: { id: 'm1', providerID: 'p' } })
        emit('session.tool.input.started', { sessionID, assistantMessageID: 'assistant_sdk', id: 'tool_sdk', name: 'superone_session_rename' })
        emit('session.tool.called', { sessionID, assistantMessageID: 'assistant_sdk', id: 'tool_sdk', input: { title: 'SDK test' } })
        emit('session.tool.success', { sessionID, assistantMessageID: 'assistant_sdk', id: 'tool_sdk', content: [{ type: 'text', text: 'renamed' }] })
        emit('session.text.delta', { sessionID, assistantMessageID: 'assistant_sdk', ordinal: 0, delta: 'first token' })
        emit('session.step.ended', { sessionID, assistantMessageID: 'assistant_sdk', finish: 'stop', cost: 0, tokens })
        emit('session.execution.succeeded', { sessionID })
        return json({ data: { id: 'input_sdk', sessionID, type: 'user' } })
      }
      return new Response(null, { status: 204 })
    }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('connects before accepting a prompt, maps immediate events, and keeps host MCP and native interactions', async () => {
    const { created, events } = start()
    let ready = false
    void created.then(() => { ready = true })
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname === '/api/event')).toBe(true))
    expect(ready).toBe(false)
    expect(requests.some(({ url }) => url.pathname.endsWith('/prompt'))).toBe(false)
    emit('server.connected', {})
    const runtime = await created
    try {
      expect(runtime.snapshotEvents.map((event) => event.type === 'v2' && event.event.type)).toEqual(['permission.asked', 'form.created'])
      const mcp = requests.find(({ url }) => url.pathname === '/api/experimental/mcp/superone')!
      expect(mcp.url.searchParams.get('location[directory]')).toBe('/project')
      expect(JSON.parse(mcp.init.body as string).config).toMatchObject({ type: 'remote', codemode: false, headers: { Authorization: 'Bearer mock' } })

      await runtime.prompt('hello', 'p/m1', 'high', undefined, 'build')
      await vi.waitFor(() => expect(events.some((event) => event.type === 'v2' && event.event.type === 'session.execution.succeeded')).toBe(true))
      const translator = new OpenCodeV2TurnTranslator({ contextWindow: () => 1000 })
      const actions = events.flatMap((event) => event.type === 'v2' ? translator.apply(event.event, 'local') : [])
      expect(actions).toContainEqual({ type: 'complete', interrupted: false })
      const agent = actions.flatMap((action) => action.type === 'agent' ? [action.event] : [])
      expect(agent).toContainEqual(expect.objectContaining({ type: 'content_delta', delta: expect.objectContaining({ type: 'text', text: 'first token' }) }))
      expect(agent).toContainEqual(expect.objectContaining({ type: 'content_delta', delta: expect.objectContaining({ type: 'tool_use', toolName: 'mcp__superone__session_rename' }) }))
      expect(await runtime.getContextUsage()).toMatchObject({ totalTokens: 16, maxTokens: 1000 })
      expect(await runtime.diff('input_sdk')).toEqual([{ file: '/project/a.ts', additions: 1, deletions: 0 }])
      await runtime.permissionReply('perm_sdk', 'once')
      await runtime.questionReply('frm_sdk', [['Yes']])
      expect(JSON.parse(requests.find(({ url }) => url.pathname.endsWith('/permission/perm_sdk/reply'))!.init.body as string)).toEqual({ decision: 'once' })
      expect(JSON.parse(requests.find(({ url }) => url.pathname.endsWith('/form/frm_sdk/reply'))!.init.body as string)).toEqual({ answer: { choice: 'yes' } })
    } finally {
      await runtime.close()
    }
    expect(streamSignal.aborted).toBe(true)
    expect(server.close).toHaveBeenCalledOnce()
  })

  it('resumes native rules and consumes resolved interactions that arrived during subscription startup', async () => {
    session.agent = 'reviewer'
    session.permissions = [{ action: 'shell', resource: 'git push *', effect: 'deny' }]
    const { created } = start(sessionID)
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname === '/api/event')).toBe(true))
    emit('server.connected', {})
    emit('form.cancelled', { sessionID, id: form.id })
    emit('permission.replied', { sessionID, requestID: permission.id, reply: 'once' })
    const runtime = await created
    try {
      await vi.waitFor(() => expect(runtime.snapshotEvents).toEqual([]))
      expect(runtime.agent).toBe('reviewer')
      const update = requests.find(({ url, init }) => url.pathname === `/api/session/${sessionID}` && init.method === 'PATCH')!
      expect(JSON.parse(update.init.body as string).permissions).toContainEqual(session.permissions[0])
      expect(requests.filter(({ url, init }) => url.pathname === '/api/session' && init.method === 'POST')).toHaveLength(0)
    } finally {
      await runtime.close()
    }
  })

  it('reconnects a disconnected event source without resending input', async () => {
    const { created, events } = start()
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname === '/api/event')).toBe(true))
    emit('server.connected', {})
    const runtime = await created
    try {
      stream.error(new Error('mock connection lost'))
      await vi.waitFor(() => expect(requests.filter(({ url }) => url.pathname === '/api/event')).toHaveLength(2))
      emit('server.connected', {})
      await vi.waitFor(() => expect(events.some((event) => event.type === 'runtime.connection' && event.properties.state === 'connected' && event.properties.attempt > 0)).toBe(true))
      expect(events.some((event) => event.type === 'runtime.error')).toBe(false)
      expect(requests.some(({ url }) => url.pathname.endsWith('/prompt'))).toBe(false)
    } finally {
      await runtime.close()
    }
  })

  it('authenticates the exact MCP integration through the native OAuth attempt and reconnects it', async () => {
    const { created } = start()
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname === '/api/event')).toBe(true))
    emit('server.connected', {})
    const runtime = await created
    try {
      await runtime.authenticateMcp('github')
      const { shell } = await import('electron')
      expect(shell.openExternal).toHaveBeenCalledWith('https://auth.example.com/authorize')
      expect(requests).toContainEqual(expect.objectContaining({ url: expect.objectContaining({ pathname: '/api/integration/mcp%2Fgithub/connect/oauth' }) }))
      expect(requests.some(({ url }) => url.pathname === '/api/experimental/mcp/github/connect')).toBe(true)
    } finally { await runtime.close() }
  })

  it('reloads live catalogs while preserving the native session and event subscriber', async () => {
    pendingSnapshots = false
    const { created } = start()
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname === '/api/event')).toBe(true))
    emit('server.connected', {})
    const runtime = await created
    try {
      await runtime.refreshResources!()
      expect(requests.some(({ url }) => url.pathname === '/api/location/reload')).toBe(true)
      expect(requests.filter(({ url }) => url.pathname === '/api/event')).toHaveLength(1)
      expect(runtime.sessionId).toBe(sessionID)
      expect(runtime.agents.some((agent) => agent.id === 'security')).toBe(true)
      expect(runtime.commands).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'new-command' }), expect.objectContaining({ name: 'new-skill', skillId: 'skill_new' })]))
      expect(runtime.commands.some((command) => command.name === 'skill-review')).toBe(false)
    } finally { await runtime.close() }
  })

  it('waits for project agent initialization after reload before replacing the catalog or falling back', async () => {
    pendingSnapshots = false
    reloadDelay = 50
    session.agent = 'reviewer'
    const { created } = start(sessionID)
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname === '/api/event')).toBe(true))
    emit('server.connected', {})
    const runtime = await created
    try {
      const fresh = await runtime.refreshResources!()
      expect(fresh.agents.some((agent) => agent.id === 'security')).toBe(true)
      expect(runtime.agent).toBe('build')
      const update = requests.find(({ url }) => url.pathname === `/api/session/${sessionID}/agent`)!
      expect(JSON.parse(update.init.body as string)).toEqual({ agent: 'build' })
    } finally { await runtime.close() }
  })

  it('completes code-based OAuth with a native attempt through the existing question reply path', async () => {
    oauthMode = 'code'
    const { created, events } = start()
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname === '/api/event')).toBe(true))
    emit('server.connected', {})
    const runtime = await created
    const flow = runtime.authenticateMcp('github')
    try {
      await vi.waitFor(() => expect(events.some((event) => event.type === 'v2' && event.event.type === 'form.created')).toBe(true))
      const event = events.find((event) => event.type === 'v2' && event.event.type === 'form.created')!
      if (event.type !== 'v2' || event.event.type !== 'form.created') throw new Error('Expected OAuth form')
      expect(runtime.snapshotEvents).toContainEqual(expect.objectContaining({ type: 'v2', event: expect.objectContaining({ type: 'form.created', data: { form: event.event.data.form } }) }))
      await runtime.questionReply(event.event.data.form.id, [['native-code']])
      await flow
      const complete = requests.find(({ url }) => url.pathname.endsWith('/connect/oauth/attempt_sdk/complete'))!
      expect(JSON.parse(complete.init.body as string)).toEqual({ code: 'native-code' })
      expect(requests.some(({ url }) => url.pathname.endsWith('/prompt'))).toBe(false)
    } finally { await runtime.close(); await flow.catch(() => undefined) }
  })

  it('never reloads a location while its approvals or forms are pending', async () => {
    const { created } = start()
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname === '/api/event')).toBe(true))
    emit('server.connected', {})
    const runtime = await created
    try {
      await expect(runtime.refreshResources!()).rejects.toThrow('pending OpenCode interactions')
      expect(requests.some(({ url }) => url.pathname === '/api/location/reload')).toBe(false)
    } finally { await runtime.close() }
  })

  it('blocks reload for a new native approval raised after runtime startup', async () => {
    pendingSnapshots = false
    const { created } = start()
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname === '/api/event')).toBe(true))
    emit('server.connected', {})
    const runtime = await created
    try {
      emit('permission.asked', permission)
      await vi.waitFor(() => expect(runtime.snapshotEvents).toHaveLength(1))
      await expect(runtime.refreshResources!()).rejects.toThrow('pending OpenCode interactions')
      expect(requests.some(({ url }) => url.pathname === '/api/location/reload')).toBe(false)
    } finally { await runtime.close() }
  })

  it('refreshes native catalog notifications only for the session location without reloading or interrupting it', async () => {
    const { created, events } = start()
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname === '/api/event')).toBe(true))
    emit('server.connected', {})
    const runtime = await created
    try {
      catalogVersion = 1
      emit('skill.updated', { id: 'skill_new' }, '/other')
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(events.some((event) => event.type === 'runtime.resources')).toBe(false)
      emit('skill.updated', { id: 'skill_new' }, '/project')
      await vi.waitFor(() => expect(events.some((event) => event.type === 'runtime.resources')).toBe(true))
      expect(runtime.commands.some((command) => command.skillId === 'skill_new')).toBe(true)
      expect(requests.some(({ url }) => url.pathname === '/api/location/reload')).toBe(false)
      expect(requests.some(({ url }) => url.pathname.endsWith('/interrupt'))).toBe(false)
    } finally { await runtime.close() }
  })

  it('keeps the selected agent until a refreshed catalog removes it, then uses Build on the next turn', async () => {
    session.agent = 'reviewer'
    const { created, events } = start(sessionID)
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname === '/api/event')).toBe(true))
    emit('server.connected', {})
    const runtime = await created
    try {
      await runtime.prompt('continue')
      expect(requests.some(({ url }) => url.pathname === `/api/session/${sessionID}/agent`)).toBe(false)
      catalogVersion = 1
      emit('agent.updated', { id: 'reviewer' }, '/project')
      await vi.waitFor(() => expect(events.some((event) => event.type === 'runtime.resources')).toBe(true))
      expect(runtime.agent).toBe('reviewer')
      await runtime.prompt('continue after removing reviewer')
      const update = requests.find(({ url }) => url.pathname === `/api/session/${sessionID}/agent`)!
      expect(JSON.parse(update.init.body as string)).toEqual({ agent: 'build' })
      expect(runtime.agent).toBe('build')
    } finally { await runtime.close() }
  })

  it('sends native skill IDs and steering delivery through the published client', async () => {
    const { created } = start()
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname === '/api/event')).toBe(true))
    emit('server.connected', {})
    const runtime = await created
    try {
      expect(runtime.commands).toContainEqual({ name: 'skill-review', description: 'Review', argumentHint: '', isSkill: true, skillId: 'skill_sdk' })
      await runtime.prompt('', 'p/m1', 'high', undefined, 'build', ['skill_sdk'])
      const accepted = vi.fn()
      await expect(runtime.steer!({ content: '/skill-review focus on tests', agent: 'build' }, accepted)).resolves.toBe('input_sdk')
      expect(accepted).toHaveBeenCalledOnce()
      const prompts = requests.filter(({ url }) => url.pathname.endsWith('/prompt')).map(({ init }) => JSON.parse(init.body as string))
      expect(prompts).toEqual([
        { text: '', files: [], skills: [{ id: 'skill_sdk' }] },
        { text: 'focus on tests', files: [], skills: [{ id: 'skill_sdk' }], delivery: 'steer' },
      ])
      expect(prompts.some((p) => 'content' in p || 'path' in p)).toBe(false)
    } finally { await runtime.close() }
  })

  it('rejects immediate operations and invalid attachments before steering admission', async () => {
    const { created } = start()
    await vi.waitFor(() => expect(requests.some(({ url }) => url.pathname === '/api/event')).toBe(true))
    emit('server.connected', {})
    const runtime = await created
    try {
      const accepted = vi.fn()
      for (const content of ['!echo unsafe', '/review tree', '/compact']) {
        await expect(runtime.steer!({ content }, accepted)).rejects.toThrow('Only text prompts')
      }
      await expect(runtime.steer!({ content: 'attachment', images: [{ id: 'pdf', mediaType: 'application/pdf', data: 'base64' }] }, accepted)).rejects.toThrow()
      expect(accepted).not.toHaveBeenCalled()
      expect(requests.some(({ url }) => url.pathname.endsWith('/prompt'))).toBe(false)
    } finally { await runtime.close() }
  })
})
