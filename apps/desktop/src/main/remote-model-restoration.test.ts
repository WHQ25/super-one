import { nativeRestoreClient, nativeSessionLoad } from './session/native-restore.test-fixtures'
import { describe, expect, it, vi } from 'vitest'
import { ChatRuntime } from '../../../mobile/src/runtime'
import { Session } from './session/session'
import type { SessionBackend, SessionStateChange } from './session/types'

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

function createHost(onStateChange: (state: SessionStateChange) => void) {
  return new Session({
    id: 'session', projectPath: '/project', cwd: '/project', providerId: 'codex', harnessId: 'codex',
    providerConfig: {}, model: 'gpt-6-astra',
    initialMessages: [{ id: 'previous', role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: 'codex' }],
    backend: {
      onEvent: () => () => {}, onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {},
    } as unknown as SessionBackend,
    onStateChange,
  })
}

describe('mobile Codex model restoration', () => {
  it('keeps desktop effort picks in the durable settings used by a mobile restore', () => {
    let saved: SessionStateChange | undefined
    const host = createHost(state => { saved = state })
    host.setSelectedSettings({ effort: 'medium' })
    host.broadcastSettingsPatch({ selectedCodexReasoningEffort: 'xhigh' })
    expect(saved?.selectedEffort).toBe('xhigh')
    expect(host.getUiSettings()).toMatchObject({ selectedEffort: 'xhigh', selectedCodexReasoningEffort: 'xhigh' })
  })

  it.each([false, true])('restores the mobile pick after switching sessions (desktop settings=%s)', async (desktopSettings) => {
    let saved: SessionStateChange | undefined
    const host = createHost(state => { saved = state })
    if (desktopSettings) host.broadcastSettingsPatch({ selectedCodexModel: 'gpt-6-astra', selectedCodexReasoningEffort: 'medium' })
    // The native session settings RPC uses this host API.
    host.setSelectedSettings({ model: 'gpt-5.6-sol', effort: 'high' })
    expect(saved?.selectedModel).toBe('gpt-5.6-sol')
    const client = nativeRestoreClient(() => nativeSessionLoad(host), () => [host.getReplayEvents()])
    const sent = client.sent
    const runtime = new ChatRuntime(client as never, () => {})
    await runtime.open('/project', 'session')
    expect(runtime.session.selectedCodexModel).toBe('gpt-5.6-sol')
    expect(runtime.session.selectedCodexReasoningEffort).toBe('high')
    await runtime.send('Continue', { model: runtime.session.selectedCodexModel, effort: runtime.session.selectedCodexReasoningEffort })
    expect(sent).toContainEqual(expect.objectContaining({ method: 'session.send', model: 'gpt-5.6-sol', effort: 'high' }))
    runtime.dispose()
  })

  it.each([
    { tier: null, label: 'off' },
    { tier: 'priority', label: 'on' },
  ])('restores Codex Fast $label from replay so a mobile open does not inherit the host default', async ({ tier }) => {
    const host = createHost(() => {})
    host.broadcastSettingsPatch({ selectedCodexModel: 'gpt-6-astra', selectedCodexServiceTier: tier })
    const client = nativeRestoreClient(() => nativeSessionLoad(host), () => [host.getReplayEvents()])
    const sent = client.sent
    const runtime = new ChatRuntime(client as never, () => {})
    await runtime.open('/project', 'session')
    expect(runtime.session.selectedCodexServiceTier).toBe(tier)
    runtime.dispose()
  })
})
