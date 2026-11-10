/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDoubaoVoicePreference } from '@/stores/doubao-voice-preference'
import { ComposerVoiceEntry } from './ComposerVoiceEntry'

const starters = vi.hoisted(() => ({
  startGeminiCall: vi.fn(async () => {}),
  startDoubaoCall: vi.fn(async () => {}),
  startRealtimeCall: vi.fn(async () => {}),
}))

vi.mock('@/stores/realtime-call', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/realtime-call')>()
  return { ...actual, ...starters }
})

describe('composer voice route', () => {
  afterEach(() => {
    useDoubaoVoicePreference.setState({ preference: 'doubao', configured: false, geminiConfigured: false })
    starters.startGeminiCall.mockClear()
    starters.startDoubaoCall.mockClear()
    starters.startRealtimeCall.mockClear()
  })

  it('keeps official Codex on Realtime when Gemini is selected', () => {
    useDoubaoVoicePreference.setState({ preference: 'gemini', configured: true, geminiConfigured: true })
    render(<ComposerVoiceEntry harness="codex" projectPath="/repo" sessionId="session-1" codexProviderId="codex-account:cli" />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Voice Conversation' }))
    expect(starters.startRealtimeCall).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: '/repo',
      sessionId: 'session-1',
    }))
    expect(starters.startGeminiCall).not.toHaveBeenCalled()
    expect(starters.startDoubaoCall).not.toHaveBeenCalled()
  })

  it('starts Gemini on another session when that model is selected and a key is saved', () => {
    useDoubaoVoicePreference.setState({ preference: 'gemini', configured: true, geminiConfigured: true })
    render(<ComposerVoiceEntry harness="claude" projectPath="/repo" sessionId="session-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Voice Conversation' }))
    expect(starters.startGeminiCall).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: '/repo',
      sessionId: 'session-1',
    }))
    expect(starters.startDoubaoCall).not.toHaveBeenCalled()
    expect(starters.startRealtimeCall).not.toHaveBeenCalled()
  })

  it('hides the button when Gemini is selected without a key', () => {
    useDoubaoVoicePreference.setState({ preference: 'gemini', configured: true, geminiConfigured: false })
    const { container } = render(<ComposerVoiceEntry harness="claude" projectPath="/repo" sessionId="session-1" />)
    expect(container).toBeEmptyDOMElement()
    expect(starters.startGeminiCall).not.toHaveBeenCalled()
  })

  it('starts Doubao when that model is selected even if a Gemini key is saved', () => {
    useDoubaoVoicePreference.setState({ preference: 'doubao', configured: true, geminiConfigured: true })
    render(<ComposerVoiceEntry harness="claude" projectPath="/repo" sessionId="session-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Start Voice Conversation' }))
    expect(starters.startDoubaoCall).toHaveBeenCalled()
    expect(starters.startGeminiCall).not.toHaveBeenCalled()
    expect(starters.startRealtimeCall).not.toHaveBeenCalled()
  })
})
