import { describe, expect, it } from 'vitest'
import { mcpServerConfigFingerprint } from '@superone/runtime/mcp-apps/identity'

describe('MCP App server storage identity', () => {
  it('survives token rotation while separating server location and process arguments', () => {
    expect(mcpServerConfigFingerprint({ url: 'https://a.test/mcp?token=a', http_headers: { Authorization: 'a' } })).toBe(mcpServerConfigFingerprint({ url: 'https://a.test/mcp?token=b', http_headers: { Authorization: 'b' } }))
    expect(mcpServerConfigFingerprint({ url: 'https://a.test/mcp' })).not.toBe(mcpServerConfigFingerprint({ url: 'https://b.test/mcp' }))
    expect(mcpServerConfigFingerprint({ command: 'node', args: ['a.js'] })).not.toBe(mcpServerConfigFingerprint({ command: 'node', args: ['b.js'] }))
  })
})
