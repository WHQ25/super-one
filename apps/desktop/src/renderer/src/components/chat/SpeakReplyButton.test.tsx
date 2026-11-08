/** @vitest-environment jsdom */

import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { SpeakReplyButton } from './SpeakReplyButton'
import { resetSpeechPlaybackForTests } from './speech-playback'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), message: vi.fn() },
}))

class FakeAudio {
  onended: (() => void) | null = null
  src = ''
  play() { return Promise.resolve() }
  pause() {}
}

describe('SpeakReplyButton', () => {
  beforeEach(() => {
    resetSpeechPlaybackForTests()
    vi.mocked(toast.error).mockClear()
    vi.mocked(toast.message).mockClear()
    vi.stubGlobal('Audio', FakeAudio)
    URL.createObjectURL = () => 'blob:speech'
    URL.revokeObjectURL = () => {}
    window.app = {
      speakText: vi.fn(async () => ({ ok: true, mediaType: 'audio/mpeg', audioBase64: btoa('mp3') })),
    } as unknown as typeof window.app
  })

  it('plays a reply and can pause or stop', async () => {
    const { getByRole, queryByRole } = render(<SpeakReplyButton messageId="m1" text="Hello" />)
    fireEvent.click(getByRole('button', { name: 'Read aloud' }))
    await waitFor(() => expect(getByRole('button', { name: 'Pause' })).toBeTruthy())
    expect(window.app.speakText).toHaveBeenCalledWith({ text: 'Hello', messageId: 'm1' })
    fireEvent.click(getByRole('button', { name: 'Pause' }))
    expect(getByRole('button', { name: 'Resume' })).toBeTruthy()
    fireEvent.click(getByRole('button', { name: 'Stop reading' }))
    expect(getByRole('button', { name: 'Play Saved' })).toBeTruthy()
    expect(queryByRole('button', { name: 'Regenerate' })).toBeNull()
  })

  it('replays saved audio without synthesizing again', async () => {
    window.app.readSavedSpeech = vi.fn(async () => ({
      ok: true as const,
      clips: [{ mediaType: 'audio/mpeg', audioBase64: btoa('saved') }],
    }))
    const { getByRole, queryByRole } = render(<SpeakReplyButton messageId="m1" text="Hello" />)
    fireEvent.click(getByRole('button', { name: 'Read aloud' }))
    await waitFor(() => expect(getByRole('button', { name: 'Pause' })).toBeTruthy())
    fireEvent.click(getByRole('button', { name: 'Stop reading' }))
    expect(queryByRole('button', { name: 'Regenerate' })).toBeNull()
    fireEvent.click(getByRole('button', { name: 'Play Saved' }))
    await waitFor(() => expect(getByRole('button', { name: 'Pause' })).toBeTruthy())
    expect(window.app.readSavedSpeech).toHaveBeenCalledWith('m1')
    expect(window.app.speakText).toHaveBeenCalledTimes(1)
  })

  it('shows the failure toast when synthesis is unavailable', async () => {
    window.app.speakText = vi.fn(async () => ({ ok: false as const, error: 'No speech provider is configured' }))
    const { getByRole } = render(<SpeakReplyButton messageId="m2" text="Hello" />)
    fireEvent.click(getByRole('button', { name: 'Read aloud' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No speech provider is configured'))
  })

  it('notes when only the start of a long reply was read', async () => {
    window.app.speakText = vi.fn(async () => ({ ok: true as const, mediaType: 'audio/mpeg', audioBase64: btoa('mp3'), truncated: true }))
    const { getByRole } = render(<SpeakReplyButton messageId="m3" text="Hello" />)
    fireEvent.click(getByRole('button', { name: 'Read aloud' }))
    await waitFor(() => expect(toast.message).toHaveBeenCalledWith('Reading the first part of this reply'))
  })
})
