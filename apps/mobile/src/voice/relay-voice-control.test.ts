import { expect, it, vi } from 'vitest'
import { relayVoiceControl } from './relay-voice-control'

it('sends the displayed thread selection and keeps cleanup scoped to the source session', async () => {
  const client = { request: vi.fn(async (_command: unknown) => ({ protocol: 1, supported: true, call: null })) }
  const selection = { model: 'displayed', reasoningEffort: 'ultra' as const, serviceTier: null, apiProviderId: 'codex-account:cli' }
  const control = relayVoiceControl(client, { projectPath: '/repo', sessionId: 'current' }, ['/extra'], selection)
  await control.start('one', 'v=0\na=offer')
  expect(client.request).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'voice_start', sessionId: 'current', attemptId: 'one', request: { sdp: 'v=0\na=offer', additionalDirs: ['/extra'], selection } }))
  await control.stop('old', { projectPath: '/source', sessionId: 'source' })
  expect(client.request).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'voice_stop', projectPath: '/source', sessionId: 'source', attemptId: 'old' }))
})
