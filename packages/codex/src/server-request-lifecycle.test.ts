import { describe, expect, it } from 'vitest'
import { registerCodexServerRequest, claimCodexServerRequest, finishCodexServerRequest, resolveCodexServerRequest, cancelCodexServerRequests } from './server-request-lifecycle'

describe('connection-local server request lifecycle', () => {
  it('discards a queued request resolved before its consumer starts', () => {
    const connection = {}
    registerCodexServerRequest(connection, 0, { threadId: 'child' })
    resolveCodexServerRequest(connection, { threadId: 'child', requestId: 0 })
    expect(claimCodexServerRequest(connection, 0, { threadId: 'child' })).toBeNull()
  })
  it('preserves raw numeric/string IDs and isolates connections and thread scopes', () => {
    const a = {}, b = {}
    const numeric = claimCodexServerRequest(a, 0, { threadId: 'root' })!
    const string = claimCodexServerRequest(a, '0', { threadId: 'root' })!
    const other = claimCodexServerRequest(b, 0, { threadId: 'root' })!
    resolveCodexServerRequest(a, { threadId: 'child', requestId: 0 })
    expect(numeric.controller.signal.aborted).toBe(false)
    resolveCodexServerRequest(a, { threadId: 'root', requestId: 0 })
    expect(numeric.controller.signal.aborted).toBe(true)
    expect(string.controller.signal.aborted).toBe(false)
    expect(other.controller.signal.aborted).toBe(false)
    cancelCodexServerRequests(a)
    cancelCodexServerRequests(b)
    expect(string.controller.signal.aborted).toBe(true)
    expect(other.controller.signal.aborted).toBe(true)
  })
  it('keeps an answered request deduplicated until acknowledgement and releases it afterwards', () => {
    const connection = {}
    const request = claimCodexServerRequest(connection, 'q', { threadId: 'root' })!
    finishCodexServerRequest(connection, 'q', request)
    expect(claimCodexServerRequest(connection, 'q', { threadId: 'root' })).toBeNull()
    resolveCodexServerRequest(connection, { threadId: 'root', requestId: 'q' })
    expect(claimCodexServerRequest(connection, 'q', { threadId: 'root' })).not.toBeNull()
    cancelCodexServerRequests(connection)
  })
})
