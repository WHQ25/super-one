import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenCodeOAuth } from './opencode-oauth'
import type { OpenCodeRuntimeEvent } from './opencode-runtime'
import type { OpenCodeV2Client } from './opencode-v2-client'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close() })

function setup(mode: 'auto' | 'code' = 'auto', pending = false) {
  const signal = new AbortController()
  const events: OpenCodeRuntimeEvent[] = []
  const methods = [{ id: 'github-oauth', type: 'oauth' as const, label: 'GitHub' }]
  const time = { created: Date.now(), expires: Date.now() + 30_000 }
  const client = {
    nativeMcpServers: vi.fn(async () => [{ name: 'github', integrationID: 'mcp_github', status: { status: 'needs_auth' } }]),
    integration: vi.fn(async () => ({ id: 'mcp_github', name: 'GitHub', methods, connections: [] })),
    startOAuth: vi.fn(async () => ({ attemptID: 'attempt-1', url: 'https://login.example.com/auth', instructions: 'Use your browser', mode, time })),
    oauthStatus: vi.fn(async () => ({ status: pending ? 'pending' as const : 'complete' as const, time })),
    completeOAuth: vi.fn(async () => undefined), cancelOAuth: vi.fn(async () => undefined), connectMcp: vi.fn(async () => undefined),
  }
  const openUrl = vi.fn(async () => undefined)
  const oauth = new OpenCodeOAuth({ client: client as unknown as OpenCodeV2Client, sessionId: 'native', signal: signal.signal,
    onEvent: (event) => events.push(event), openUrl, pollMs: 5, timeoutMs: 2000 })
  cleanups.push(() => oauth.close())
  const latestForm = () => {
    const event = events.findLast((event) => event.type === 'v2' && event.event.type === 'form.created')
    if (event?.type !== 'v2' || event.event.type !== 'form.created') throw new Error('No OAuth form')
    return event.event.data.form
  }
  return { oauth, client, events, openUrl, signal, latestForm, time, methods }
}

describe('OpenCode native OAuth lifecycle', () => {
  it('rechecks the captured proof after asynchronous discovery before starting a native attempt', async () => {
    const { oauth, client } = setup()
    let resume!: () => void, valid = true
    const wait = new Promise<void>(resolve => { resume = resolve })
    const guard = () => { if (!valid) throw new Error('stale lease') }
    const integration = client.integration.getMockImplementation()!
    client.integration.mockImplementation(async () => { await wait; return integration() })
    const start = client.startOAuth.getMockImplementation()!
    client.startOAuth.mockImplementation(async (...args: unknown[]) => { (args[4] as (() => void) | undefined)?.(); return start() })
    const flow = oauth.authenticate('github', guard)
    const refused = expect(flow).rejects.toThrow('stale lease')
    valid = false; resume()
    await refused
    expect(client.connectMcp).not.toHaveBeenCalled()
  })
  it('dedupes repeated clicks, connects the named server and resolves the host form after an automatic callback', async () => {
    const { oauth, client, events, openUrl } = setup()
    const one = oauth.authenticate('github')
    expect(oauth.authenticate('github')).toBe(one)
    await one
    expect(client.startOAuth).toHaveBeenCalledOnce()
    expect(openUrl).toHaveBeenCalledWith('https://login.example.com/auth', expect.objectContaining({ mode: 'auto', signal: expect.any(AbortSignal) }))
    expect(client.connectMcp).toHaveBeenCalledWith('github', expect.any(AbortSignal))
    expect(client.cancelOAuth).not.toHaveBeenCalled()
    expect(oauth.snapshotEvents).toEqual([])
    expect(events).toContainEqual(expect.objectContaining({ type: 'v2', event: expect.objectContaining({ type: 'form.replied' }) }))
  })

  it('accepts a code through the existing form reply path without sending it as a model prompt', async () => {
    const { oauth, client, latestForm } = setup('code')
    const flow = oauth.authenticate('github')
    await vi.waitFor(() => expect(oauth.snapshotEvents).toHaveLength(1))
    expect(latestForm().fields[0].key).toBe('code')
    expect(oauth.reply(latestForm().id, [[' auth-code ']])).toBe(true)
    await flow
    expect(client.completeOAuth).toHaveBeenCalledWith('mcp_github', 'attempt-1', 'auth-code', expect.any(AbortSignal))
  })

  it('cancels the exact native attempt when the waiting form is dismissed and permits a fresh retry', async () => {
    const { oauth, client, latestForm } = setup('auto', true)
    const flow = oauth.authenticate('github')
    const failed = expect(flow).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(oauth.snapshotEvents).toHaveLength(1))
    expect(oauth.reject(latestForm().id)).toBe(true)
    await failed
    expect(client.cancelOAuth).toHaveBeenCalledWith('mcp_github', 'attempt-1')
    expect(oauth.busy).toBe(false)
    client.oauthStatus.mockResolvedValueOnce({ status: 'complete', time: { created: Date.now(), expires: Date.now() + 1000 } })
    await oauth.authenticate('github')
    expect(client.startOAuth).toHaveBeenCalledTimes(2)
  })

  it('expires a code prompt even when the user never answers it', async () => {
    const { oauth, client, time } = setup('code')
    time.expires = Date.now() + 100
    await expect(oauth.authenticate('github')).rejects.toThrow('expired')
    expect(client.cancelOAuth).toHaveBeenCalledOnce()
    expect(oauth.snapshotEvents).toEqual([])
  })

  it('rejects unsafe authorization URLs and cancels their native attempt before opening them', async () => {
    const { oauth, client, openUrl } = setup()
    client.startOAuth.mockResolvedValueOnce({ attemptID: 'attempt-1', url: 'javascript:alert(1)', instructions: '', mode: 'auto', time: { created: 0, expires: Date.now() + 1000 } })
    await expect(oauth.authenticate('github')).rejects.toThrow('unsupported sign-in URL')
    expect(openUrl).not.toHaveBeenCalled()
    expect(client.cancelOAuth).toHaveBeenCalledOnce()
  })

  it('collects the selected method and its typed input form before starting OAuth', async () => {
    const { oauth, client, latestForm } = setup('code')
    client.integration.mockResolvedValueOnce({ id: 'mcp_github', name: 'GitHub', methods: [
      { id: 'oauth-1', type: 'oauth', label: 'Personal' },
      { id: 'oauth-2', type: 'oauth', label: 'Team', form: [{ key: 'workspace', title: 'Workspace', type: 'string', required: true }] },
    ], connections: [] } as never)
    const flow = oauth.authenticate('github')
    await vi.waitFor(() => expect(latestForm().fields[0].key).toBe('method'))
    oauth.reply(latestForm().id, [['Team']])
    await vi.waitFor(() => expect(latestForm().fields[0].key).toBe('workspace'))
    oauth.reply(latestForm().id, [['team-workspace']])
    await vi.waitFor(() => expect(latestForm().fields[0].key).toBe('code'))
    oauth.reply(latestForm().id, [['code']])
    await flow
    expect(client.startOAuth).toHaveBeenCalledWith('mcp_github', 'oauth-2', { workspace: 'team-workspace' }, expect.any(AbortSignal))
  })

  it('cancels pending native attempts and removes their questions on runtime close', async () => {
    const { oauth, client } = setup('auto', true)
    const flow = oauth.authenticate('github')
    const failed = expect(flow).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(oauth.snapshotEvents).toHaveLength(1))
    await oauth.close()
    await failed
    expect(client.cancelOAuth).toHaveBeenCalledOnce()
    expect(oauth.snapshotEvents).toEqual([])
  })
})
