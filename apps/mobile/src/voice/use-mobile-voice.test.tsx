import { beforeEach, expect, it, jest } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import type { VoiceCapability } from '@superone/shared/realtime-voice'
import type { VoiceMedia } from './voice-service'
import { useMobileVoice } from './use-mobile-voice'

const mockMedia: VoiceMedia = { offer: jest.fn(async () => 'offer'), answer: jest.fn(async () => {}),
  close: jest.fn(), inputMuted: jest.fn(), outputMuted: jest.fn() }
const mockOpen = jest.fn(async () => mockMedia)
const mockAvailable = jest.fn(() => true)
jest.mock('./native-voice-media', () => ({ nativeVoiceMedia: {
  available: () => mockAvailable(), open: () => mockOpen(),
} }))
jest.mock('../session-link-navigation', () => ({ sessionLinkBaseClient: (client: unknown) => client }))

const capability: VoiceCapability = { protocol: 1, supported: true }
const target = { projectPath: '/repo', sessionId: 'created', harnessId: 'codex' as const }
type Input = Parameters<typeof useMobileVoice>[0]
function fixture() {
  const request = jest.fn(async (cmd: { type: string; attemptId?: string }) => {
    if (cmd.type === 'get_session_state') return { realtimeVoice: capability }
    return { ...capability, call: cmd.type === 'voice_start'
      ? { ...target, attemptId: cmd.attemptId, callId: 'call', hostEpoch: 'host', generation: 1, owned: true, state: 'starting' }
      : null }
  })
  const create = jest.fn(async (_signal: AbortSignal) => target)
  const input: Input = { clientRef: { current: { request } as never }, target: null,
    landing: { projectPath: '/repo', harnessId: 'codex', capability, create },
    connected: true, routed: false, additionalDirs: ['/tools'], providerId: 'codex-account:cli', catalogReady: true,
    selection: { model: 'gpt-6.1-sol', reasoningEffort: 'high', serviceTier: 'fast', apiProviderId: 'codex-account:cli' },
  }
  return { input, request, create }
}
beforeEach(() => { jest.clearAllMocks(); mockAvailable.mockReturnValue(true) })

it('offers voice on the new-session landing and carries the displayed selection after empty creation', async () => {
  const f = fixture()
  const { result } = await renderHook(() => useMobileVoice(f.input))
  expect(result.current.capability).toEqual(capability)
  expect(result.current.supported).toBe(true)
  expect(f.request).not.toHaveBeenCalled()
  expect(f.create).not.toHaveBeenCalled()
  await act(async () => { result.current.start() })
  expect(f.create).toHaveBeenCalledTimes(1)
  expect(f.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'voice_start', ...target,
    request: { sdp: 'offer', additionalDirs: ['/tools'], selection: f.input.selection },
  }))
  await act(async () => { result.current.service.stop() })
})

it.each(['failed', 'unsupported'] as const)('refreshes the same session ID after an early %s capability response', async (response) => {
  const f = fixture()
  if (response === 'failed') f.request.mockRejectedValueOnce(new Error('Session not created yet'))
  else f.request.mockResolvedValueOnce({ realtimeVoice: { protocol: 1, supported: false } })
  const { result, rerender } = await renderHook((input: Input) => useMobileVoice(input),
    { initialProps: { ...f.input, target, landing: undefined } })
  expect(result.current.supported).toBe(false)
  await rerender({ ...f.input, target, landing: undefined, sessionCapability: capability })
  expect(result.current.supported).toBe(true)
  expect(result.current.capability).toEqual(capability)
})

it('ignores a pre-creation response arriving after the authoritative subscription snapshot', async () => {
  const f = fixture()
  let stale!: (value: { realtimeVoice: VoiceCapability }) => void
  f.request.mockImplementationOnce(() => new Promise(resolve => { stale = resolve }))
  const { result, rerender } = await renderHook((input: Input) => useMobileVoice(input),
    { initialProps: { ...f.input, target, landing: undefined } })
  await rerender({ ...f.input, target, landing: undefined, sessionCapability: capability })
  await act(async () => { stale({ realtimeVoice: { protocol: 1, supported: false } }) })
  expect(result.current.supported).toBe(true)
})

it('hides voice for custom accounts, routed hosts, offline hosts and older desktop catalogs', async () => {
  const f = fixture()
  const { result, rerender } = await renderHook((input: Input) => useMobileVoice(input), { initialProps: f.input })
  for (const input of [{ ...f.input, providerId: 'custom' }, { ...f.input, routed: true },
    { ...f.input, connected: false }, { ...f.input, landing: { ...f.input.landing!, capability: undefined } }]) {
    await rerender(input)
    expect(result.current.capability).toBeUndefined()
    await act(async () => { result.current.start() })
  }
  expect(f.create).not.toHaveBeenCalled()
  expect(mockOpen).not.toHaveBeenCalled()
})

it('keeps the entry visible but disabled when the native binary lacks voice modules', async () => {
  mockAvailable.mockReturnValue(false)
  const f = fixture()
  const { result } = await renderHook(() => useMobileVoice(f.input))
  expect(result.current.capability).toEqual(capability)
  expect(result.current.supported).toBe(false)
  await act(async () => { result.current.start() })
  expect(f.create).not.toHaveBeenCalled()
  expect(mockOpen).not.toHaveBeenCalled()
})
