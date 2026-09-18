import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedService } from '@superone/shared/platform-registry'
import log from '../logger'
import { createCodexConnectionDiagnostics } from './connection-diagnostics'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

function diagnostics(provider: ResolvedService | null = null) {
  return createCodexConnectionDiagnostics({
    connectionId: 'test-connection', env: { CODEX_API_KEY: 'private-api-key', HTTPS_PROXY: 'https://user:password@proxy:8080' },
    provider, apiProviderId: 'credential-1', explicitCliOverrides: false,
  })
}

function entries(level: 'info' | 'warn') {
  return vi.mocked(log[level]).mock.calls.map((call) => JSON.parse(call[1] as string))
}

describe('Codex production diagnostics', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(log.info).mockClear()
    vi.mocked(log.warn).mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('records the provider route and environment presence without URL credentials, query values or environment values', () => {
    const d = diagnostics({
      credentialId: 'credential-1', platformId: 'relay', endpointId: 'openai', protocol: 'openai-responses',
      baseUrl: 'https://username:password@relay.example/api/v1?custom=value-to-hide#fragment-to-hide',
      apiKey: 'private-api-key', extraEnv: { EXTRA_TOKEN: 'environment-secret' },
    } as unknown as ResolvedService)
    expect(entries('info')[0]).toMatchObject({
      event: 'provider', route: 'direct', hasApiKey: true, baseUrl: 'https://relay.example/api/v1?[REDACTED]',
      extraEnvKeys: ['EXTRA_TOKEN'], proxyEnvKeys: ['HTTPS_PROXY'],
    })
    const output = JSON.stringify(entries('info'))
    for (const secret of ['username', 'password', 'value-to-hide', 'fragment-to-hide', 'private-api-key', 'environment-secret']) {
      expect(output).not.toContain(secret)
    }
    d.close()
  })

  it('reports a stalled proxy stage and its redacted failure, then stops its timer', async () => {
    const d = diagnostics()
    let reject!: (error: Error) => void
    const error = new Error('connect failed private-api-key https://u:p@relay.example/v1?token=secret-value')
    const pending = d.request('proxy/ensure', undefined, () => new Promise((_resolve, fail) => { reject = fail }))
    const result = expect(pending).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(entries('warn')).toContainEqual(expect.objectContaining({ event: 'waiting', method: 'proxy/ensure', elapsedMs: 60_000 }))
    reject(error)
    await result
    expect(entries('warn')).toContainEqual(expect.objectContaining({ event: 'request_failed', method: 'proxy/ensure' }))
    const output = JSON.stringify(entries('warn'))
    expect(output).not.toContain('private-api-key')
    expect(output).not.toContain('secret-value')
    expect(output).not.toContain('u:p@')
    expect(vi.getTimerCount()).toBe(0)
    d.close()
  })

  it('reports progress for independent turns without logging deltas or split stderr secrets', async () => {
    const d = diagnostics()
    for (const id of ['one', 'two']) d.notification('turn/started', { threadId: id, turn: { id } })
    d.stderr('\x1b[33mWARN stream failed private-api-')
    d.stderr('key body: {"input":"stderr prompt"}\x1b[0m\n')
    d.notification('item/started', { threadId: 'one', item: { type: 'userMessage', content: 'secret prompt' } })
    expect(entries('info').filter((e) => e.event === 'first_output')).toHaveLength(0)
    d.notification('item/agentMessage/delta', { threadId: 'one', delta: 'secret answer' })
    d.notification('item/agentMessage/delta', { threadId: 'one', delta: 'more secret answer' })
    expect(entries('info').filter((e) => e.event === 'first_output')).toHaveLength(1)
    d.notification('turn/completed', { threadId: 'one', turn: { id: 'one', status: 'completed' } })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(entries('warn')).toEqual([expect.objectContaining({
      event: 'waiting', threadId: 'two', receivedOutput: false, lastStderr: 'WARN stream failed [REDACTED] ',
    })])
    const output = JSON.stringify([...entries('info'), ...entries('warn')])
    for (const secret of ['private-api-key', 'secret prompt', 'secret answer', 'stderr prompt']) expect(output).not.toContain(secret)
    d.close()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(entries('warn')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves retry metadata and HTTP status while omitting embedded response bodies', () => {
    const d = diagnostics()
    d.notification('error', {
      threadId: 'one', turnId: 'one', willRetry: true,
      error: {
        message: 'unexpected status 429 body: {"input":"secret prompt","api_key":"unknown-key"}',
        codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 429 } },
      },
    })
    expect(entries('warn')).toEqual([expect.objectContaining({
      event: 'provider_error', willRetry: true, httpStatusCode: 429, errorKind: 'httpConnectionFailed',
      message: 'unexpected status 429 ',
    })])
    expect(JSON.stringify(entries('warn'))).not.toContain('secret prompt')
    expect(JSON.stringify(entries('warn'))).not.toContain('unknown-key')
    d.close()
  })

  it('keeps watching accepted turns with no notifications and does not reopen a turn completed before its RPC response', async () => {
    const d = diagnostics()
    await d.request('turn/start', { threadId: 'quiet-thread' }, async () => ({ turn: { id: 'quiet-turn', status: 'inProgress' } }))
    await d.request('turn/start', { threadId: 'fast-thread' }, async () => {
      d.notification('turn/completed', { threadId: 'fast-thread', turn: { id: 'fast-turn', status: 'completed' } })
      return { turn: { id: 'fast-turn', status: 'inProgress' } }
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(entries('warn')).toEqual([expect.objectContaining({
      event: 'waiting', threadId: 'quiet-thread', turnId: 'quiet-turn',
      receivedOutput: false, lastEvent: 'turn/start:accepted', notifications: 0,
    })])
    d.close()
    expect(vi.getTimerCount()).toBe(0)
  })
})
