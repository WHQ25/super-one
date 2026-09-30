import { describe, expect, it } from 'vitest'
import { buildMcpAppCsp, mcpAppCspDomains, mcpAppCspMeta, mcpAppAllowAttribute } from './csp'
import { mcpAppHostContext } from './context'

describe('MCP App sandbox policy', () => {
  it('has strict defaults and forbids forms even when the iframe allows them', () => {
    const csp = buildMcpAppCsp()
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).not.toContain('unsafe-eval')
    expect(mcpAppCspMeta()).toContain(`content="${csp}"`)
  })

  it('does not spread a declared domain into another directive', () => {
    const csp = buildMcpAppCsp({
      connectDomains: ['wss://socket.test/path', 'https://api.test/query'],
      resourceDomains: ['https://cdn.test/path'],
      frameDomains: ['https://frame.test/embed'], baseUriDomains: ['https://base.test/path'],
    }).split('; ')
    expect(csp.find(d => d.startsWith('connect-src'))).toBe('connect-src wss://socket.test https://api.test')
    expect(csp.find(d => d.startsWith('script-src'))).toBe("script-src 'self' 'unsafe-inline' https://cdn.test")
    expect(csp.find(d => d.startsWith('frame-src'))).toBe('frame-src https://frame.test')
    expect(csp.find(d => d.startsWith('base-uri'))).toBe('base-uri https://base.test')
  })

  it('rejects wildcard, plaintext static, credentials and CSP injection', () => {
    const values = ['https://*.test', 'https://ok.test; connect-src *', 'http://test', 'https://user:secret@test', 'data:text/html,a', "https://test/'", 'file:///tmp/test', 'wss://test']
    expect(mcpAppCspDomains({ resourceDomains: values }).resourceDomains).toEqual([])
    expect(mcpAppCspDomains({ connectDomains: values }).connectDomains).toEqual(['wss://test'])
  })

  it('maps only permissions the host has actually granted', () => {
    expect(mcpAppAllowAttribute()).toBe('')
    expect(mcpAppAllowAttribute({ microphone: {}, clipboardWrite: {} })).toBe('microphone; clipboard-write')
  })

  it('maps resolved desktop and mobile tokens without framework dependencies', () => {
    const context = mcpAppHostContext({ theme: 'dark', platform: 'mobile', locale: 'zh-CN', timeZone: 'Asia/Shanghai', width: 320, colors: { background: '#111', foreground: '#fff' } })
    expect(context.styles?.variables?.['--color-background-primary']).toBe('#111')
    expect(context.deviceCapabilities).toEqual({ touch: true, hover: false })
    expect(context.availableDisplayModes).toEqual(['inline'])
    expect(context.containerDimensions).toEqual({ width: 320 })
  })
})
