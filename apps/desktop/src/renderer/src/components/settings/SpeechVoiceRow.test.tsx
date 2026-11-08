/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpeechVoiceRow } from './SpeechVoiceRow'

const listSpeechVoices = vi.fn()
const saveAppSettings = vi.fn()

const catalog = {
  credentialId: 'cred-1',
  voices: [
    { id: 'alloy', label: 'Alloy' },
    { id: 'marin', label: 'Marin' },
  ],
  defaultVoice: 'alloy',
  selectedVoice: 'alloy',
}

beforeEach(() => {
  listSpeechVoices.mockReset().mockResolvedValue(catalog)
  saveAppSettings.mockReset().mockResolvedValue({})
  Object.defineProperty(window, 'app', {
    configurable: true,
    value: { listSpeechVoices, saveAppSettings },
  })
})

afterEach(() => cleanup())

describe('SpeechVoiceRow', () => {
  it('saves a voice for the resolved provider and clears it when the default is chosen', async () => {
    const user = userEvent.setup()
    render(<SpeechVoiceRow />)
    await user.click(await screen.findByRole('button', { name: 'Alloy' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Marin' }))
    await waitFor(() => expect(saveAppSettings).toHaveBeenCalledWith({ speechVoices: { 'cred-1': 'marin' } }))
    expect(screen.getByRole('button', { name: 'Marin' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Voice ID' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Marin' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Alloy' }))
    await waitFor(() => expect(saveAppSettings).toHaveBeenCalledWith({ speechVoices: { 'cred-1': '' } }))
  })

  it('stays disabled until a speech provider exists', async () => {
    listSpeechVoices.mockResolvedValue({ error: 'unconfigured' })
    render(<SpeechVoiceRow />)
    const button = await screen.findByRole('button', { name: 'Add a speech provider first' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('retries a failed voice list', async () => {
    listSpeechVoices
      .mockResolvedValueOnce({ error: 'failed' })
      .mockResolvedValueOnce(catalog)
    render(<SpeechVoiceRow />)
    expect(await screen.findByRole('button', { name: 'Could not load voices' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Alloy' })).toBeTruthy()
    expect(listSpeechVoices).toHaveBeenCalledTimes(2)
  })

  it('shows the built-in voice when account voices could not be loaded', async () => {
    listSpeechVoices.mockResolvedValue({
      credentialId: 'cred-1',
      voices: [{ id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' }],
      defaultVoice: '21m00Tcm4TlvDq8ikWAM',
      selectedVoice: '21m00Tcm4TlvDq8ikWAM',
      fallback: true,
    })
    render(<SpeechVoiceRow />)
    expect(await screen.findByRole('button', { name: 'Rachel' })).toBeTruthy()
    expect(screen.getByText('Account voices could not be loaded. Showing the built-in voice.')).toBeTruthy()
  })

  it('saves a pasted ElevenLabs voice id and ignores a blank one', async () => {
    const user = userEvent.setup()
    listSpeechVoices.mockResolvedValue({
      credentialId: 'cred-1',
      voices: [{ id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' }],
      defaultVoice: '21m00Tcm4TlvDq8ikWAM',
      selectedVoice: '21m00Tcm4TlvDq8ikWAM',
      customVoice: true,
    })
    render(<SpeechVoiceRow />)
    const input = await screen.findByRole('textbox', { name: 'Voice ID' })
    expect((screen.getByRole('button', { name: 'Use' }) as HTMLButtonElement).disabled).toBe(true)

    await user.type(input, '   ')
    expect((screen.getByRole('button', { name: 'Use' }) as HTMLButtonElement).disabled).toBe(true)

    await user.clear(input)
    await user.type(input, '  abcVoice  {Enter}')
    await waitFor(() => expect(saveAppSettings).toHaveBeenCalledWith({ speechVoices: { 'cred-1': 'abcVoice' } }))
    expect(screen.getByRole('button', { name: 'abcVoice' })).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('previews the typed ElevenLabs voice id', async () => {
    const user = userEvent.setup()
    const previewSpeechVoice = vi.fn().mockResolvedValue({
      ok: true,
      mediaType: 'audio/mpeg',
      audioBase64: 'QQ==',
    })
    const play = vi.fn(async () => {})
    const pause = vi.fn()
    class FakeAudio {
      onended: (() => void) | null = null
      constructor(public src: string) {}
      play = play
      pause = pause
    }
    vi.stubGlobal('Audio', FakeAudio)
    listSpeechVoices.mockResolvedValue({
      credentialId: 'cred-1',
      voices: [{ id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' }],
      defaultVoice: '21m00Tcm4TlvDq8ikWAM',
      selectedVoice: '21m00Tcm4TlvDq8ikWAM',
      customVoice: true,
    })
    Object.defineProperty(window, 'app', {
      configurable: true,
      value: { listSpeechVoices, saveAppSettings, previewSpeechVoice },
    })
    try {
      render(<SpeechVoiceRow />)
      const input = await screen.findByRole('textbox', { name: 'Voice ID' })
      await user.type(input, 'abcVoice')
      await user.click(screen.getByRole('button', { name: 'Preview' }))
      await waitFor(() => expect(previewSpeechVoice).toHaveBeenCalledWith('abcVoice'))
      expect(play).toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Stop' }))
      expect(pause).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
