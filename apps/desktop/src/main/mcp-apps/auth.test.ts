import { describe, expect, it, vi } from 'vitest'
import type { McpAppsRpcResult } from '@superone/shared/environment/mcp-apps-rpc'
import { authenticateMcpApp, type McpAppsAuthDeps } from './auth'

const AUTH_REQUIRED: McpAppsRpcResult = { ok: false, error: { code: 'auth_required', message: 'sign in' } }
const signal = new AbortController().signal

function deps(responses: Record<string, Array<McpAppsRpcResult | ((op: Record<string, unknown>) => McpAppsRpcResult)>>, over: Partial<McpAppsAuthDeps> = {}) {
  const calls: Array<Record<string, unknown>> = []
  const request = vi.fn(async (op: Record<string, unknown>) => {
    calls.push(op)
    const queue = responses[op.operation as string]!
    const next = queue.length > 1 ? queue.shift()! : queue[0]!
    return typeof next === 'function' ? next(op) : next
  })
  const openUrl = vi.fn(async () => {})
  return { calls, openUrl, deps: { request, openUrl, hostCallback: false, pollMs: 1, ...over } as McpAppsAuthDeps }
}

describe('authenticateMcpApp', () => {
  it('opens the harness sign-in page and waits until tools stop reporting auth_required', async () => {
    const d = deps({
      authenticate: [{ ok: true, value: { authUrl: 'https://as.test/authorize', completion: 'harness' } }],
      tools: [AUTH_REQUIRED, AUTH_REQUIRED, { ok: true, value: [] }],
    })
    expect(await authenticateMcpApp(d.deps, signal)).toEqual({ ok: true, value: null })
    expect(d.openUrl).toHaveBeenCalledWith('https://as.test/authorize')
    expect(d.calls[0]).toEqual({ operation: 'authenticate' })
    expect(d.calls.filter((c) => c.operation === 'tools')).toHaveLength(3)
  })

  it('relays the browser redirect back to a remote harness through a loopback listener', async () => {
    let redirectUri = ''
    const d = deps({
      authenticate: [(op) => {
        redirectUri = op.redirectUri as string
        return { ok: true, value: { authUrl: 'https://as.test/authorize', completion: 'host-callback' } }
      }],
      submitAuthCallback: [{ ok: true, value: null }],
      tools: [{ ok: true, value: [] }],
    }, { hostCallback: true })
    d.openUrl.mockImplementation(async () => {
      // The browser following the authorization server's redirect.
      const res = await fetch(`${redirectUri}?code=abc&state=xyz`)
      expect(await res.text()).toContain('return to SuperOne')
    })
    expect(await authenticateMcpApp(d.deps, signal)).toEqual({ ok: true, value: null })
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp-oauth-callback$/)
    expect(d.calls.find((c) => c.operation === 'submitAuthCallback')).toEqual({ operation: 'submitAuthCallback', callbackUrl: `${redirectUri}?code=abc&state=xyz` })
  })

  it('never opens a non-web sign-in URL', async () => {
    const d = deps({ authenticate: [{ ok: true, value: { authUrl: 'file:///etc/passwd', completion: 'harness' } }], tools: [{ ok: true, value: [] }] })
    expect(await authenticateMcpApp(d.deps, signal)).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(d.openUrl).not.toHaveBeenCalled()
  })

  it('returns provider errors and gives up after the deadline', async () => {
    const notConnected: McpAppsRpcResult = { ok: false, error: { code: 'not_connected', message: 'down' } }
    expect(await authenticateMcpApp(deps({ authenticate: [notConnected] }).deps, signal)).toEqual(notConnected)
    const stuck = deps({ authenticate: [{ ok: true, value: { completion: 'harness' } }], tools: [AUTH_REQUIRED] }, { timeoutMs: 20 })
    expect(await authenticateMcpApp(stuck.deps, signal)).toMatchObject({ ok: false, error: { code: 'timeout' } })
  })
})
