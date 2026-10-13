import { mkdtempSync, realpathSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionLease } from '../session/session-lease'
import { controlLeaseAuthority, acquirePhoneControl } from '../control-lease.test-fixtures'
import { runWindowControl } from '../session/control-context'

vi.mock('../logger', () => ({ default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import {
  OpenCodeV2Client,
  parseOpenCodeV2McpStatus,
  parseOpenCodeV2Models,
  parseOpenCodeV2Commands,
  toOpenCodeV2McpConfig,
  toOpenCodeV2Ruleset,
} from './opencode-v2-client'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function client() {
  return new OpenCodeV2Client({ baseUrl: 'http://127.0.0.1:4000/', directory: '/project dir', password: 'pw' })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('OpenCodeV2Client', () => {
  it('pages newest-first recovery messages without combining a cursor with order', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ data: [{ id: 'new' }, { id: 'middle' }], cursor: { next: 'older' } }))
      .mockResolvedValueOnce(json({ data: [{ id: 'boundary' }, { id: 'old' }], cursor: { next: 'unused' } }))
    vi.stubGlobal('fetch', fetch)
    expect(await client().messagesSince('s', 'boundary', new AbortController().signal)).toEqual([{ id: 'middle' }, { id: 'new' }])
    const queries = fetch.mock.calls.map(([url]) => new URL(url).searchParams)
    expect(queries[0].get('order')).toBe('desc')
    expect(queries[1].get('cursor')).toBe('older')
    expect(queries[1].has('order')).toBe(false)
  })
  it('rejects an unavailable recovery boundary instead of exposing unrelated old history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [], cursor: {} })))
    await expect(client().messagesSince('s', 'gone', new AbortController().signal)).rejects.toThrow('boundary is no longer available')
  })
  it('requires a valid same-session synchronization marker before releasing a replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"type":"log.synced","aggregateID":"other","seq":2}\n\n', { headers: { 'content-type': 'text/event-stream' } })))
    await expect(client().sessionLog('s', 1, new AbortController().signal)).rejects.toThrow('Invalid OpenCode log watermark')
  })
  it('aborts a hung projection read and never returns partial recovery content', async () => {
    let signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => {
      signal = init.signal!
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    }))
    const abort = new AbortController()
    const replay = client().messagesSince('s', 'boundary', abort.signal)
    const rejected = expect(replay).rejects.toThrow()
    await vi.waitFor(() => expect(signal).toBeDefined())
    abort.abort(); await rejected
    expect(signal.aborted).toBe(true)
  })
  it('checks control after lazy SDK loading and before an inbox HTTP mutation', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    await expect(client().updateInbox('s', 'input', 'steer', () => { throw new Error('stale lease') })).rejects.toThrow('stale lease')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('retains the exact frontend lease across host-owned work and lazy native dispatch', async () => {
    const authority = controlLeaseAuthority(), lease = new SessionLease('s', authority)
    const guard = runWindowControl(1, () => lease.captureMutation())
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const cancel = client().cancelInbox('s', 'input', guard)
    acquirePhoneControl(authority, 's', 'phone')
    await expect(cancel).rejects.toThrow('stale lease')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('sends basic auth and the deep-object location for catalog routes', async () => {
    const fetch = vi.fn(async () => json({ location: { directory: '/project dir' }, data: [{ name: 'init' }] }))
    vi.stubGlobal('fetch', fetch)

    await expect(client().commands()).resolves.toEqual([{ name: 'init' }])

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe('http://127.0.0.1:4000/api/command?location%5Bdirectory%5D=%2Fproject+dir')
    expect(new Headers(init.headers).get('Authorization')).toBe(`Basic ${Buffer.from('opencode:pw').toString('base64')}`)
  })

  it('surfaces the server error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ _tag: 'SessionNotFoundError', message: 'Session not found' }, 404)))
    await expect(client().getSession('ses_x')).rejects.toThrow('Session not found')
  })

  it('waits for a location’s catalog to settle on first use', async () => {
    const model = { id: 'm1', providerID: 'p', name: 'M1', enabled: true, variants: [], limit: { context: 1 } }
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ data: [model] }))
    vi.stubGlobal('fetch', fetch)

    await expect(client().models()).resolves.toEqual([model])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('discovers the complete resource catalog after cold location and provider settlement', async () => {
    const model = { id: 'gpt', providerID: 'openai', name: 'GPT', enabled: true, variants: [{ id: 'high' }], limit: { context: 200_000 } }
    let agentRequests = 0
    let modelRequests = 0
    const fetch = vi.fn(async (url: string) => {
      const path = new URL(url).pathname
      expect(new URL(url).searchParams.get('location[directory]')).toBe('/project dir')
      if (path === '/api/agent') return json({ data: ++agentRequests === 1 ? [] : [
        { id: 'build', name: 'Build', description: 'Implement changes', mode: 'primary', hidden: false },
        { id: 'hidden', name: 'Hidden', mode: 'primary', hidden: true },
        { id: 'helper', name: 'Helper', mode: 'subagent', hidden: false },
      ] })
      if (path === '/api/model') return json({ data: ++modelRequests === 1 ? [] : [model] })
      if (path === '/api/model/default') return json({ data: model })
      if (path === '/api/provider') return json({ data: [{ id: 'openai', name: 'OpenAI' }] })
      if (path === '/api/command') return json({ data: [{ name: 'review', description: 'Review changes' }] })
      if (path === '/api/skill') return json({ data: [] })
      throw new Error(`Unexpected catalog route: ${path}`)
    })
    vi.stubGlobal('fetch', fetch)

    const resources = await client().resources()
    expect(resources.models).toMatchObject([{ id: 'openai/gpt', isDefault: true, supportedEffortLevels: ['high'] }])
    expect(resources.agents).toEqual([{ id: 'build', name: 'Build', description: 'Implement changes', modelId: undefined }])
    expect(resources.commands).toContainEqual({ name: 'review', description: 'Review changes', argumentHint: '', isSkill: false })
    expect(agentRequests).toBe(2)
    expect(modelRequests).toBe(2)
  })

  it('locates sessions at the resolved directory', async () => {
    const real = mkdtempSync(join(tmpdir(), 'opencode-v2-'))
    const link = `${real}-link`
    symlinkSync(real, link)
    const fetch = vi.fn(async () => json({ data: { id: 'ses_1', location: { directory: real } } }))
    vi.stubGlobal('fetch', fetch)

    await new OpenCodeV2Client({ baseUrl: 'http://h', directory: link }).createSession([])

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string).location).toEqual({ directory: realpathSync.native(real) })
  })

  it('parses server-sent event frames split across chunks', async () => {
    const frames = [
      'data: {"id":"e0","type":"server.connected","data":{}}\r\n\r\n: heartbeat\r\n\r\ndata: {"id":"e1","type":"session.text',
      '.delta","data":{"sessionID":"s","delta":"hi"}}\r',
      '\n\r',
      '\n',
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame))
        controller.close()
      },
    }), { headers: { 'content-type': 'text/event-stream' } })))

    const events = []
    for await (const event of await client().eventStream(new AbortController().signal)) events.push(event)
    expect(events.map((event) => event.type)).toEqual(['server.connected', 'session.text.delta'])
  })

  it('waits for the connection marker and preserves events received before the runtime consumes them', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => new Response(new ReadableStream({
      start(value) {
        controller = value
        init.signal?.addEventListener('abort', () => controller.close(), { once: true })
      },
    }), { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetch)
    const abort = new AbortController()
    let ready = false
    const opened = client().eventStream(abort.signal).then((stream) => {
      ready = true
      return stream
    })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await new Promise((resolve) => setImmediate(resolve))
    expect(ready).toBe(false)

    const connected = { id: 'connected', type: 'server.connected', data: {} }
    const delta = { id: 'delta', type: 'session.text.delta', data: { sessionID: 'ses_1', delta: 'first token' } }
    controller.enqueue(new TextEncoder().encode([connected, delta].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')))
    const iterator = (await opened)[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toEqual(connected)
    expect((await iterator.next()).value).toEqual(delta)
    await iterator.return?.()
    expect((fetch.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true)
  })

  it('cancels startup while waiting for the first event', async () => {
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => controller.close(), { once: true })
      },
    }), { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetch)
    const abort = new AbortController()
    const opened = client().eventStream(abort.signal)
    const rejected = expect(opened).rejects.toThrow(/aborted/i)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    abort.abort()
    await rejected
    expect((fetch.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true)
  })

  it('bounds startup when the server never confirms the subscription', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => controller.close(), { once: true })
      },
    }), { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetch)
    const opened = client().eventStream(new AbortController().signal)
    const rejected = expect(opened).rejects.toThrow(/timed out/i)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(5000)
    await rejected
    expect((fetch.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true)
  })
})

describe('OpenCode 2 parsers', () => {
  it('adds native skills to the slash catalog without exposing source or overriding command names', () => {
    const skills = [
      { id: 'skill_review', name: 'review', description: 'Review code', content: 'private instructions', path: '/private/skill.md' },
      { id: 'skill_collision', name: 'init', content: 'other', path: '/private/other.md' },
    ]
    expect(parseOpenCodeV2Commands([{ name: 'init' }], skills)).toEqual([
      { name: 'init', description: '', argumentHint: '', isSkill: false },
      { name: 'review', description: 'Review code', argumentHint: '', isSkill: true, skillId: 'skill_review' },
    ])
  })
  it('lists enabled models with their effort variants and default', () => {
    const models = [
      { id: 'gpt', providerID: 'openai', name: 'GPT', enabled: true, variants: [{ id: 'low' }, { id: 'ultra' }], limit: { context: 400 } },
      { id: 'off', providerID: 'openai', name: 'Off', enabled: false, variants: [], limit: { context: 1 } },
    ]
    expect(parseOpenCodeV2Models(models, models[0], [{ id: 'openai', name: 'OpenAI' }])).toEqual([{
      id: 'openai/gpt',
      name: 'GPT',
      description: 'OpenAI model',
      isDefault: true,
      contextWindow: 400,
      supportsEffort: true,
      supportedEffortLevels: ['low'],
    }])
  })

  it('maps MCP status names', () => {
    expect(parseOpenCodeV2McpStatus([
      { name: 'a', status: { status: 'needs_auth', error: 'login' } },
      { name: 'b', status: { status: 'pending' } },
    ])).toEqual([
      { name: 'a', scope: 'project', status: 'needs-auth', error: 'login' },
      { name: 'b', scope: 'project', status: 'pending' },
    ])
  })

  it('registers host MCP tools as direct tools and renames rule fields', () => {
    expect(toOpenCodeV2McpConfig({ name: 'superone', scope: 'project', type: 'http', url: 'http://h/mcp' }, { host: true }))
      .toEqual({ type: 'remote', url: 'http://h/mcp', headers: undefined, disabled: false, codemode: false })
    expect(toOpenCodeV2McpConfig({ name: 'tools', scope: 'project', type: 'stdio', command: 'tools', args: ['--x'] }))
      .toEqual({ type: 'local', command: ['tools', '--x'], environment: undefined, disabled: false })
    expect(toOpenCodeV2Ruleset([{ permission: 'edit', pattern: '*', action: 'allow' }]))
      .toEqual([{ action: 'edit', resource: '*', effect: 'allow' }])
  })
})
