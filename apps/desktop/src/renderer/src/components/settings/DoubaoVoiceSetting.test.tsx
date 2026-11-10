/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopVoiceSettings } from '@superone/shared/desktop-voice-route'
import { DOUBAO_DEFAULT_SPEAKER } from '@superone/shared/doubao-realtime'
import { GEMINI_DEFAULT_VOICE } from '@superone/shared/gemini-realtime'

const getDoubaoVoiceSettings = vi.fn()
const setDoubaoVoiceSettings = vi.fn()

Object.defineProperty(window, 'app', {
  configurable: true,
  value: { getDoubaoVoiceSettings, setDoubaoVoiceSettings },
})

const { DoubaoVoiceSetting } = await import('./DoubaoVoiceSetting')

const blankKey = { configured: false, masked: '' }

const empty: DesktopVoiceSettings = {
  preference: 'doubao',
  speaker: DOUBAO_DEFAULT_SPEAKER,
  geminiVoice: GEMINI_DEFAULT_VOICE,
  key: blankKey,
  geminiKey: blankKey,
}

beforeEach(() => {
  getDoubaoVoiceSettings.mockReset()
  setDoubaoVoiceSettings.mockReset()
  getDoubaoVoiceSettings.mockResolvedValue(empty)
})

describe('DoubaoVoiceSetting', () => {
  it('shows only the Doubao key until Gemini 3.8 is selected', async () => {
    const gemini: DesktopVoiceSettings = {
      preference: 'gemini',
      speaker: DOUBAO_DEFAULT_SPEAKER,
      geminiVoice: GEMINI_DEFAULT_VOICE,
      key: { configured: true, masked: '***secret' },
      geminiKey: blankKey,
    }
    setDoubaoVoiceSettings.mockResolvedValue(gemini)
    render(<DoubaoVoiceSetting />)
    expect(await screen.findByRole('tab', { name: 'Doubao' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Gemini 3.8' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Auto' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Doubao Speech API Key')).toBeInTheDocument()
    expect(screen.queryByLabelText('Gemini Speech API Key')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Key' })).not.toBeInTheDocument()
    const geminiTab = screen.getByRole('tab', { name: 'Gemini 3.8' })
    await waitFor(() => expect(geminiTab).toBeEnabled())
    fireEvent.mouseDown(geminiTab)
    expect(await screen.findByLabelText('Gemini Speech API Key')).toBeInTheDocument()
    expect(screen.queryByLabelText('Doubao Speech API Key')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Puck · Upbeat' })).toBeInTheDocument()
    expect(setDoubaoVoiceSettings).toHaveBeenCalledWith({ preference: 'gemini' })
  })

  it('saves a key and then shows only the mask', async () => {
    const saved: DesktopVoiceSettings = {
      preference: 'doubao',
      speaker: DOUBAO_DEFAULT_SPEAKER,
      geminiVoice: GEMINI_DEFAULT_VOICE,
      key: { configured: true, masked: '***secret' },
      geminiKey: blankKey,
    }
    setDoubaoVoiceSettings.mockResolvedValue(saved)
    render(<DoubaoVoiceSetting />)
    const input = await screen.findByLabelText('Doubao Speech API Key')
    fireEvent.change(input, { target: { value: 'speech-key-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Key' }))
    expect(await screen.findByText('***secret')).toBeInTheDocument()
    expect(setDoubaoVoiceSettings).toHaveBeenCalledWith({ apiKey: 'speech-key-secret' })
    expect(screen.queryByLabelText('Doubao Speech API Key')).not.toBeInTheDocument()
  })

  it('keeps the form and shows the storage error', async () => {
    setDoubaoVoiceSettings.mockRejectedValue(new Error('Secure storage is unavailable on this machine'))
    render(<DoubaoVoiceSetting />)
    const input = await screen.findByLabelText('Doubao Speech API Key')
    fireEvent.change(input, { target: { value: 'speech-key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Key' }))
    expect(await screen.findByText('Secure storage is unavailable on this machine')).toBeInTheDocument()
    expect(screen.getByLabelText('Doubao Speech API Key')).toBeInTheDocument()
  })

  it('saves a Gemini key without showing the Doubao key', async () => {
    const loaded: DesktopVoiceSettings = {
      preference: 'gemini',
      speaker: DOUBAO_DEFAULT_SPEAKER,
      geminiVoice: 'Kore',
      key: { configured: true, masked: '***secret' },
      geminiKey: blankKey,
    }
    const saved: DesktopVoiceSettings = {
      ...loaded,
      geminiKey: { configured: true, masked: '***live9' },
    }
    getDoubaoVoiceSettings.mockResolvedValue(loaded)
    setDoubaoVoiceSettings.mockResolvedValue(saved)
    render(<DoubaoVoiceSetting />)
    const input = await screen.findByLabelText('Gemini Speech API Key')
    expect(screen.queryByLabelText('Doubao Speech API Key')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kore · Firm' })).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'gemini-live-key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Key' }))
    expect(await screen.findByText('***live9')).toBeInTheDocument()
    expect(setDoubaoVoiceSettings).toHaveBeenCalledWith({ geminiApiKey: 'gemini-live-key' })
    expect(screen.queryByLabelText('Gemini Speech API Key')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Doubao Speech API Key')).not.toBeInTheDocument()
  })

  it('stays disabled while settings are still loading', () => {
    getDoubaoVoiceSettings.mockReturnValue(new Promise(() => {}))
    render(<DoubaoVoiceSetting />)
    expect(screen.getByRole('tab', { name: 'Doubao' })).toBeDisabled()
  })
})
