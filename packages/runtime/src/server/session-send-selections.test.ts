import { describe, expect, it } from 'vitest'
import { parseSessionSendSelections } from './session-send-selections'

describe('native composer send selections', () => {
  it('preserves a queued input-request send and an explicit Codex tier reset', () => {
    const input = { clientMessageId: 'user', priority: 'later', steer: 'now', serviceTier: null, inputRequest: { requestId: 'request', values: { color: 'blue' } }, modelParams: { fast: 'true' } }
    expect(parseSessionSendSelections(input, {})).toEqual({ priority: 'later', steer: 'now', serviceTier: null, inputRequest: input.inputRequest, modelParams: { fast: 'true' } })
  })
  it('prefers explicit options over a top-level selection', () => {
    expect(parseSessionSendSelections({ priority: 'later', agent: 'old' }, { priority: 'next', agent: 'build' })).toEqual({ priority: 'next', agent: 'build' })
  })
  it.each([{ priority: 'unknown' }, { steer: 'now' }, { inputRequest: { requestId: 'r', values: [] } }, { modelParams: { fast: true } }, { permissionPreset: 'all' }, { serviceTier: '' }])('refuses malformed selections: %j', (input) => {
    expect(() => parseSessionSendSelections(input, {})).toThrow()
  })
})
