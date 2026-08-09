import { describe, expect, it } from 'vitest'
import { providerSessionIdFromResume } from './provider-resume'

describe('providerSessionIdFromResume', () => {
  it('strips known harness prefixes', () => {
    expect(providerSessionIdFromResume('claude-session:sdk-1')).toBe('sdk-1')
    expect(providerSessionIdFromResume('thread:t-abc')).toBe('t-abc')
    expect(providerSessionIdFromResume('acp-session:grok-9')).toBe('grok-9')
    expect(providerSessionIdFromResume('opencode:open-1')).toBe('open-1')
  })

  it('returns bare tokens and trims', () => {
    expect(providerSessionIdFromResume('  resume-uuid  ')).toBe('resume-uuid')
    expect(providerSessionIdFromResume('plain-id')).toBe('plain-id')
  })

  it('returns null for empty / missing', () => {
    expect(providerSessionIdFromResume(null)).toBeNull()
    expect(providerSessionIdFromResume(undefined)).toBeNull()
    expect(providerSessionIdFromResume('')).toBeNull()
    expect(providerSessionIdFromResume('   ')).toBeNull()
    expect(providerSessionIdFromResume('claude-session:')).toBeNull()
    expect(providerSessionIdFromResume('thread:  ')).toBeNull()
  })
})
