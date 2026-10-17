import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  login: vi.fn(),
  list: vi.fn(),
  home: vi.fn(),
}))
vi.mock('electron', () => ({ net: { fetch: mocks.fetch } }))
vi.mock('@superone/runtime/usage', () => ({ readCodexLogin: mocks.login }))
vi.mock('./codex-account-store', () => ({ codexAccountStore: () => ({
  list: mocks.list, home: mocks.home, cliHome: '/cli',
}) }))

import { listCodexVoicePreviews } from './codex-voice-previews'

const account = { id: 'managed', isDefault: true, signedIn: true }
const sample = { voice: 'cove', accent: 'American English', preview_url: 'https://persistent.oaistatic.com/voice/cove.m4a' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.list.mockReturnValue([account])
  mocks.home.mockReturnValue('/managed')
  mocks.login.mockReturnValue({ accessToken: 'secret-test-token', accountId: 'test-account' })
  mocks.fetch.mockResolvedValue(Response.json({ voices: [sample] }))
})

describe('Codex voice previews', () => {
  it('uses the default account and Chromium fetch, returning only public sample URLs', async () => {
    await expect(listCodexVoicePreviews('zh')).resolves.toEqual({ cove: { accent: 'American English', previewUrl: sample.preview_url } })
    expect(mocks.home).toHaveBeenCalledWith('managed')
    expect(mocks.login).toHaveBeenCalledWith('/managed')
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(new URL(url).searchParams.get('spoken_language')).toBe('zh')
    expect(new URL(url).searchParams.get('voice_mode')).toBe('wingman')
    expect(init).toMatchObject({
      credentials: 'omit', redirect: 'error',
      headers: { Authorization: 'Bearer secret-test-token', 'ChatGPT-Account-Id': 'test-account' },
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('retains the CLI login when there is no managed default', async () => {
    mocks.list.mockReturnValue([])
    await listCodexVoicePreviews('en')
    expect(mocks.login).toHaveBeenCalledWith('/cli')
    expect(mocks.home).not.toHaveBeenCalled()
  })

  it('does not fall back to another account when the default is signed out', async () => {
    mocks.list.mockReturnValue([{ ...account, signedIn: false }])
    await expect(listCodexVoicePreviews('en')).rejects.toThrow('Sign in')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('requires OAuth credentials without refreshing the login', async () => {
    mocks.login.mockReturnValue(null)
    await expect(listCodexVoicePreviews('en')).rejects.toThrow('Sign in')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects unsafe sample URLs while retaining valid voices', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ voices: [
      sample,
      { voice: 'http', preview_url: 'http://persistent.oaistatic.com/a' },
      { voice: 'other', preview_url: 'https://example.com/a' },
      { voice: 'lookalike', preview_url: 'https://persistent.oaistatic.com.example.com/a' },
      { voice: 'user', preview_url: 'https://user:password@persistent.oaistatic.com/a' },
      { voice: 'port', preview_url: 'https://persistent.oaistatic.com:444/a' },
      { voice: 'broken', preview_url: 'not-a-url' },
      { voice: 'missing', accent: 'French' },
      null,
    ] }))
    const result = await listCodexVoicePreviews('en')
    expect(result.cove).toEqual({ accent: 'American English', previewUrl: sample.preview_url })
    expect(Object.values(result).filter((voice) => voice.previewUrl)).toHaveLength(1)
    expect(result.missing).toEqual({ accent: 'French' })
  })

  it('normalizes official account aliases without guessing unsupported voice names', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ voices: [
      { ...sample, voice: 'fathom', accent: 'British English' },
      { ...sample, voice: 'glimmer' },
      { ...sample, voice: 'orbit' },
      { ...sample, voice: 'arrullo', accent: 'Mexican Spanish' },
    ] }))
    const result = await listCodexVoicePreviews('en')
    expect(Object.keys(result)).toEqual(['arbor', 'sol', 'spruce', 'arrullo'])
    expect(result.arbor?.accent).toBe('British English')
    expect(result.sol?.previewUrl).toBe(sample.preview_url)
    expect(result.porto).toBeUndefined()
  })

  it.each([401, 403, 429, 500])('handles HTTP %s without exposing the response body', async (status) => {
    mocks.fetch.mockResolvedValue(new Response('secret-test-token', { status }))
    await expect(listCodexVoicePreviews('en')).rejects.toThrow('Unable to load voice previews')
  })

  it('sanitizes network and malformed response errors', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('secret-test-token'))
    await expect(listCodexVoicePreviews('en')).rejects.toThrow(/^Unable to load voice previews\./)
    mocks.fetch.mockResolvedValueOnce(Response.json({ unexpected: 'secret-test-token' }))
    await expect(listCodexVoicePreviews('en')).rejects.toThrow(/^Unable to load voice previews\./)
  })

  it('discards results when the default account changes during the request', async () => {
    mocks.fetch.mockImplementation(async () => {
      mocks.list.mockReturnValue([{ ...account, id: 'other' }])
      return Response.json({ voices: [sample] })
    })
    await expect(listCodexVoicePreviews('en')).rejects.toThrow('Unable to load voice previews')
  })

  it('discards results after logout or credential replacement', async () => {
    mocks.login.mockReturnValueOnce({ accessToken: 'secret-test-token', accountId: 'test-account' }).mockReturnValue(null)
    await expect(listCodexVoicePreviews('en')).rejects.toThrow('Unable to load voice previews')
  })
})
