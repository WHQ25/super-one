import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIpcChannels } from '@superone/shared/agent-types'

const mocks = vi.hoisted(() => ({ handle: vi.fn(), previews: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle }, app: { getPath: () => '/user-data' } }))
vi.mock('./codex-voice-previews', () => ({ listCodexVoicePreviews: mocks.previews }))
import { registerCodexVoiceIpc } from './codex-voice-ipc'

const listRealtimeVoices = vi.fn()
function handler(channel: string) {
  return mocks.handle.mock.calls.find(([name]) => name === channel)![1] as (...args: unknown[]) => Promise<unknown>
}
beforeEach(() => {
  vi.clearAllMocks()
  registerCodexVoiceIpc({ listRealtimeVoices } as never)
})

describe('Codex voice IPC', () => {
  it('preserves the local catalog project and uses a local fallback for global preferences', async () => {
    const call = handler(AgentIpcChannels.CODEX_LIST_REALTIME_VOICES)
    await call({}, '/repo')
    expect(listRealtimeVoices).toHaveBeenLastCalledWith('/repo')
    await call({}, null)
    expect(listRealtimeVoices).toHaveBeenLastCalledWith('/user-data')
  })

  it.each(['zh', 'en', undefined, {}, 'https://example.com'])('normalizes preview language %s without accepting URLs or credential paths', async (language) => {
    await handler(AgentIpcChannels.CODEX_LIST_REALTIME_VOICE_PREVIEWS)({}, language)
    expect(mocks.previews).toHaveBeenCalledWith(language === 'zh' ? 'zh' : 'en')
  })
})
