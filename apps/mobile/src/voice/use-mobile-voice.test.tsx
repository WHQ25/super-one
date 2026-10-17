import { beforeEach, expect, it, jest } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { VoiceCapability } from '@superone/shared/realtime-voice'
import type { VoiceMedia } from './voice-service'
import { useMobileVoice } from './use-mobile-voice'

const mockMedia: VoiceMedia = { offer: jest.fn(async () => 'offer'), answer: jest.fn(async () => {}),
  close: jest.fn(), inputMuted: jest.fn(), pause: jest.fn(async () => {}), resume: jest.fn(async () => {}), outputMuted: jest.fn() }
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
  const status = jest.fn(async (): Promise<unknown> => ({ ...capability, call: null }))
  const rpc = jest.fn(async (method: string): Promise<unknown> => method === 'environment.descriptor'
    ? { capabilities: { methods: ['session.voiceStatus', 'session.voiceStart', 'session.voiceReady', 'session.voiceStop'] } }
    : status())
  const controlledRpc = jest.fn(async (_ref: unknown, method: string, p: { attemptId?: string }): Promise<unknown> => ({
    ...capability, call: method === 'session.voiceStart'
      ? { ...target, attemptId: p.attemptId, callId: 'call', hostEpoch: 'host', generation: 1, owned: true, state: 'starting' }
      : null,
  }))
  const release = jest.fn(async () => {})
  const client = { rpc, controlledRpc, environmentId: 'desktop',
    resolveProject: jest.fn(async () => ({ environmentId: 'desktop', projectId: 'p' })),
    acquireControl: jest.fn(async () => ({})), retainSession: jest.fn(() => release),
  }
  const create = jest.fn(async (_signal: AbortSignal) => target)
  const input: Input = { clientRef: { current: client as never }, target: null,
    landing: { projectPath: '/repo', harnessId: 'codex', capability, create },
    connected: true, routed: false, additionalDirs: ['/tools'], providerId: 'codex-account:cli', catalogReady: true,
    selection: { model: 'gpt-6.1-sol', reasoningEffort: 'high', serviceTier: 'fast', apiProviderId: 'codex-account:cli' },
  }
  return { input, rpc, status, controlledRpc, client, release, create }
}
beforeEach(() => { jest.clearAllMocks(); mockAvailable.mockReturnValue(true) })

it('offers voice on the new-session landing and carries the displayed selection after empty creation', async () => {
  const f = fixture()
  const { result } = await renderHook(() => useMobileVoice(f.input))
  await waitFor(() => expect(result.current.capability).toEqual(capability))
  expect(result.current.supported).toBe(true)
  expect(f.controlledRpc).not.toHaveBeenCalled()
  expect(f.create).not.toHaveBeenCalled()
  await act(async () => { result.current.start() })
  expect(f.create).toHaveBeenCalledTimes(1)
  expect(f.controlledRpc).toHaveBeenCalledWith({ environmentId: 'desktop', sessionId: target.sessionId }, 'session.voiceStart', { attemptId: expect.any(String), request: { sdp: 'offer', additionalDirs: ['/tools'], selection: f.input.selection } })
  await act(async () => { result.current.service.stop() })
})

it.each(['failed', 'unsupported'] as const)('refreshes the same session ID after an early %s capability response', async (response) => {
  const f = fixture()
  if (response === 'failed') f.status.mockRejectedValueOnce(new Error('Session not created yet'))
  else f.status.mockResolvedValueOnce({ protocol: 1, supported: false, call: null })
  const { result, rerender } = await renderHook((input: Input) => useMobileVoice(input),
    { initialProps: { ...f.input, target, landing: undefined } })
  await waitFor(() => expect(f.status).toHaveBeenCalledTimes(1))
  expect(result.current.supported).toBe(false)
  await rerender({ ...f.input, target, landing: undefined, sessionCapability: capability })
  await waitFor(() => expect(result.current.supported).toBe(true))
  await waitFor(() => expect(result.current.capability).toEqual(capability))
})

it('ignores a pre-creation response arriving after the authoritative subscription snapshot', async () => {
  const f = fixture()
  let stale!: (value: unknown) => void
  f.status.mockImplementationOnce(() => new Promise(resolve => { stale = resolve }))
  const { result, rerender } = await renderHook((input: Input) => useMobileVoice(input),
    { initialProps: { ...f.input, target, landing: undefined } })
  await waitFor(() => expect(f.status).toHaveBeenCalledTimes(1))
  await rerender({ ...f.input, target, landing: undefined, sessionCapability: capability })
  await waitFor(() => expect(result.current.supported).toBe(true))
  await act(async () => { stale({ protocol: 1, supported: false, call: null }) })
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

it('reports voice unavailable and prevents starting when the native binary lacks voice modules', async () => {
  mockAvailable.mockReturnValue(false)
  const f = fixture()
  const { result } = await renderHook(() => useMobileVoice(f.input))
  await waitFor(() => expect(result.current.capability).toEqual(capability))
  expect(result.current.supported).toBe(false)
  await act(async () => { result.current.start() })
  expect(f.create).not.toHaveBeenCalled()
  expect(mockOpen).not.toHaveBeenCalled()
})

it('hides voice when the authenticated host does not serve every native voice method', async () => {
  const f = fixture()
  f.rpc.mockResolvedValue({ capabilities: { methods: ['session.voiceStatus'] } })
  const { result } = await renderHook(() => useMobileVoice({ ...f.input, target, sessionCapability: capability }))
  await waitFor(() => expect(f.rpc).toHaveBeenCalled())
  expect(result.current.supported).toBe(false)
  expect(result.current.capability).toBeUndefined()
  expect(f.status).not.toHaveBeenCalled()
  await act(async () => { result.current.start() })
  expect(mockOpen).not.toHaveBeenCalled()
})

it('waits for the worktree-backed landing session before opening media or starting voice', async () => {
  const f = fixture()
  let created!: (value: typeof target) => void
  f.create.mockImplementationOnce(() => new Promise(resolve => { created = resolve }))
  const { result } = await renderHook(() => useMobileVoice(f.input))
  await waitFor(() => expect(result.current.supported).toBe(true))
  await act(async () => { result.current.start() })
  expect(f.create).toHaveBeenCalledTimes(1)
  expect(mockOpen).not.toHaveBeenCalled()
  expect(f.controlledRpc).not.toHaveBeenCalled()
  await act(async () => { created(target) })
  expect(mockOpen).toHaveBeenCalledTimes(1)
  expect(f.controlledRpc).toHaveBeenCalledWith(expect.objectContaining({ sessionId: target.sessionId }), 'session.voiceStart', expect.any(Object))
  await act(async () => { result.current.service.stop() })
})
