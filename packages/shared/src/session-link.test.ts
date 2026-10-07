import { describe, expect, it } from 'vitest'
import { buildSessionLink, parseSessionLink, resolveSessionLink, sessionLinkMarkdown } from './session-link'

describe('session links', () => {
  it('round trips opaque case-sensitive identities and binds localhost to the source', () => {
    const ref = { environmentId: 'Host-A', sessionId: 'Session-B' }
    expect(parseSessionLink(buildSessionLink(ref))).toEqual(ref)
    expect(resolveSessionLink({ ...ref, environmentId: 'localhost' }, 'Source-A')).toEqual({ ...ref, environmentId: 'Source-A' })
    expect(resolveSessionLink(ref, 'Other')).toEqual(ref)
    expect(resolveSessionLink({ ...ref, environmentId: 'localhost' })).toBeNull()
  })
  it.each(['session://host', 'session://host/', 'session://host/id/extra', 'session://host/id?q=x', 'session://host/id#x', 'session://user@host/id', 'session://host:22/id', 'session://host/a%2fb', 'session://host/a%5cb', 'session://host/%ZZ', 'session://host/a%20b', 'session://host/%252f', 'javascript:alert(1)'])('rejects invalid destinations: %s', (href) => {
    expect(parseSessionLink(href)).toBeNull()
  })
  it('escapes copy labels without altering the destination', () => {
    expect(sessionLinkMarkdown('a [b]\\c', { environmentId: 'A', sessionId: 'B' })).toBe('[a \\[b\\]\\\\c](session://A/B)')
  })
  it('encodes punctuation so copied links remain valid Markdown destinations', () => {
    const ref = { environmentId: 'Host(A)', sessionId: 'Session(B)' }
    expect(sessionLinkMarkdown('Title', ref)).toBe('[Title](session://Host%28A%29/Session%28B%29)')
    expect(parseSessionLink(buildSessionLink(ref))).toEqual(ref)
  })
})
