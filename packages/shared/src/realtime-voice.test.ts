import { describe, expect, it } from 'vitest'
import { validateVoiceStart, validateVoiceAttempt, MAX_VOICE_SDP_CHARS, redactVoiceTraceValue } from './realtime-voice'

describe('voice control boundaries', () => {
  it('bounds offers, attempts and directories without echoing private input in errors', () => {
    expect(() => validateVoiceStart({ sdp: `v=0\na=ice-pwd:${'s'.repeat(MAX_VOICE_SDP_CHARS)}` })).toThrow('Invalid voice offer')
    expect(() => validateVoiceStart({ sdp: 'v=0junk' })).toThrow('Invalid voice offer')
    expect(() => validateVoiceStart({ sdp: 'v=0\na=offer', additionalDirs: ['/path\0'] })).toThrow('Invalid voice directories')
    expect(() => validateVoiceAttempt('private secret')).toThrow('Invalid voice attempt')
    expect(() => validateVoiceStart({ sdp: 'v=0\na=offer', selection: { reasoningEffort: 'invalid' as never } })).toThrow('Invalid voice thread selection')
    expect(redactVoiceTraceValue('error', 'body {"sdp":"v=0\\r\\na=ice-pwd:secret"}')).not.toContain('secret')
  })
})
