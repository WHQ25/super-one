import { afterEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import {
  buildMcpAppSrcdoc, exitMcpAppFullscreen, forgetMcpAppArrivals, markMcpAppActivated,
  mcpAppAwaitsLiveActivation, mcpAppNeedsActivation, mobileMcpAppCsp, noteMcpAppArrivals, setMcpAppFullscreenExit,
  markMcpAppInactive, startMcpApp,
} from './mcp-app-document'

const CSP_META = '<meta http-equiv="Content-Security-Policy"'

describe('buildMcpAppSrcdoc', () => {
  it('puts the policy after the doctype and before the first script', () => {
    const doc = buildMcpAppSrcdoc('<!doctype html>\n<html><head><script>boot()</script></head></html>', undefined)
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc.indexOf(CSP_META)).toBeGreaterThan(0)
    expect(doc.indexOf(CSP_META)).toBeLessThan(doc.indexOf('<script>'))
    expect(doc).toContain("form-action 'none'")
    expect(doc).toContain("connect-src 'none'")
  })

  it('skips leading comments and handles documents without a doctype', () => {
    expect(buildMcpAppSrcdoc('<!-- a --> <!DOCTYPE html><p>x</p>', undefined)).toMatch(/^<!-- a --> <!DOCTYPE html><meta http-equiv/)
    expect(buildMcpAppSrcdoc('<script>x()</script>', undefined).startsWith(CSP_META)).toBe(true)
  })

  it('keeps declared origins but never nested frames, which the chat document refuses', () => {
    const meta = { csp: { connectDomains: ['https://api.example.com/v1'], frameDomains: ['https://embed.example.com'] } }
    expect(mobileMcpAppCsp(meta)).toMatchObject({ connectDomains: ['https://api.example.com'], frameDomains: [] })
    const doc = buildMcpAppSrcdoc('<p>x</p>', meta)
    expect(doc).toContain('connect-src https://api.example.com')
    expect(doc).toContain("frame-src 'none'")
  })

  it('escapes metadata so it cannot close the meta element', () => {
    const doc = buildMcpAppSrcdoc('<p>x</p>', { csp: { connectDomains: ['https://a.example"><script>x()</script>'] } })
    expect(doc.split('<script>').length).toBe(1)
  })
})

function turn(id: string, app: Partial<ToolAppAttachment> & { appInstanceId: string }, codex = false): ChatMessage {
  const attachment = { binding: { node: 'n', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'f' }, resourceUri: 'ui://x', status: 'result', ...app } as ToolAppAttachment
  return codex
    ? { id, role: 'assistant', status: 'complete', createdAt: '', content: [], metadata: { codex: { items: [{ id: 'i', type: 'mcp_tool_call', server: 'fixture', tool: 't', arguments: {}, status: 'completed', app: attachment }] } } } as unknown as ChatMessage
    : { id, role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude', content: [{ type: 'tool_result', toolUseId: 't', summary: '', app: attachment }] }
}

describe('MCP App arrivals', () => {
  afterEach(forgetMcpAppArrivals)

  it('treats Views first painted from history as restored until activated', () => {
    noteMcpAppArrivals([turn('m1', { appInstanceId: 'old' }), turn('m2', { appInstanceId: 'codex' }, true)], 'restored')
    expect(mcpAppNeedsActivation('old')).toBe(true)
    expect(mcpAppNeedsActivation('codex')).toBe(true)
    markMcpAppActivated('old')
    expect(mcpAppNeedsActivation('old')).toBe(false)
  })

  it('keeps a live View live across the re-hydrate a reconnect sends', () => {
    noteMcpAppArrivals([turn('m', { appInstanceId: 'live' })], 'live')
    noteMcpAppArrivals([turn('m', { appInstanceId: 'live' })], 'restored')
    expect(mcpAppNeedsActivation('live')).toBe(false)
  })

  it('does not upgrade a restored View because a later patch touches it', () => {
    noteMcpAppArrivals([turn('m', { appInstanceId: 'old' })], 'restored')
    noteMcpAppArrivals([turn('m', { appInstanceId: 'old' })], 'live')
    expect(mcpAppNeedsActivation('old')).toBe(true)
  })

  it('treats a View it never saw arrive as restored', () => {
    expect(mcpAppNeedsActivation('from-a-history-window')).toBe(true)
  })

  it('asks a live View, and only a live one, to activate itself once', () => {
    noteMcpAppArrivals([turn('m1', { appInstanceId: 'live' })], 'live')
    noteMcpAppArrivals([turn('m2', { appInstanceId: 'old' })], 'restored')
    expect(mcpAppAwaitsLiveActivation('live')).toBe(true)
    expect(mcpAppAwaitsLiveActivation('old')).toBe(false)
    expect(mcpAppAwaitsLiveActivation('from-a-history-window')).toBe(false)
    markMcpAppActivated('live')
    expect(mcpAppAwaitsLiveActivation('live')).toBe(false)
  })

  it('makes a View the host stopped serving wait for Activate, never activating itself', () => {
    noteMcpAppArrivals([turn('m', { appInstanceId: 'live' })], 'live')
    markMcpAppActivated('live')
    markMcpAppInactive('live')
    expect(mcpAppNeedsActivation('live')).toBe(true)
    expect(mcpAppAwaitsLiveActivation('live')).toBe(false)
    markMcpAppActivated('live')
    expect(mcpAppNeedsActivation('live')).toBe(false)
  })
})

describe('startMcpApp', () => {
  afterEach(forgetMcpAppArrivals)
  const resource = { html: '<p>x</p>', meta: {}, hash: 'h' }

  it('lets a remount join the start in flight and reuse its result', async () => {
    let runs = 0
    let finish!: (value: typeof resource) => void
    const run = () => { runs++; return new Promise<typeof resource>(resolve => { finish = resolve }) }
    const first = startMcpApp('v', run)
    const joined = startMcpApp('v', run)
    finish(resource)
    expect(await first).toBe(resource)
    expect(await joined).toBe(resource)
    expect(await startMcpApp('v', run)).toBe(resource)
    expect(runs).toBe(1)
  })

  it('forgets a failed start so Retry asks the host again', async () => {
    await expect(startMcpApp('v', () => Promise.reject(new Error('timeout')))).rejects.toThrow('timeout')
    expect(await startMcpApp('v', async () => resource)).toBe(resource)
  })

  it('starts an inactive View again instead of reusing the start that activated it', async () => {
    await startMcpApp('v', async () => resource)
    markMcpAppInactive('v')
    let runs = 0
    await startMcpApp('v', async () => { runs++; return null })
    expect(runs).toBe(1)
  })

  it('starts again in a new document', async () => {
    await startMcpApp('v', async () => null)
    forgetMcpAppArrivals()
    expect(await startMcpApp('v', async () => resource)).toBe(resource)
  })
})

describe('fullscreen exit', () => {
  it('lets native back close the open fullscreen View once', () => {
    let closed = 0
    const release = setMcpAppFullscreenExit(() => { closed++ })
    expect(exitMcpAppFullscreen()).toBe(true)
    release()
    expect(exitMcpAppFullscreen()).toBe(false)
    expect(closed).toBe(1)
  })
})
