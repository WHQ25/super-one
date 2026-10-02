import { mkdtempSync, realpathSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({ default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import {
  OpenCodeV2Client,
  parseOpenCodeV2McpStatus,
  parseOpenCodeV2Models,
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
})

describe('OpenCodeV2Client', () => {
  it('sends basic auth and the deep-object location for catalog routes', async () => {
    const fetch = vi.fn(async () => json({ location: { directory: '/project dir' }, data: [{ name: 'init' }] }))
    vi.stubGlobal('fetch', fetch)

    await expect(client().commands()).resolves.toEqual([{ name: 'init' }])

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4000/api/command?location%5Bdirectory%5D=%2Fproject+dir')
    expect(init.headers).toEqual({ Authorization: `Basic ${Buffer.from('opencode:pw').toString('base64')}` })
  })

  it('surfaces the server error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ _tag: 'SessionNotFoundError', message: 'Session not found' }, 404)))
    await expect(client().getSession('ses_x')).rejects.toThrow('OpenCode GET /api/session/ses_x failed (404): Session not found')
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
})

describe('OpenCode 2 parsers', () => {
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
