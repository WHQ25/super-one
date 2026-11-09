/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DoubaoVoiceSettings } from '@superone/shared/doubao-call'
import { DOUBAO_DEFAULT_SPEAKER } from '@superone/shared/doubao-realtime'

const getDoubaoVoiceSettings = vi.fn()
const setDoubaoVoiceSettings = vi.fn()

Object.defineProperty(window, 'app', {
  configurable: true,
  value: { getDoubaoVoiceSettings, setDoubaoVoiceSettings },
})

const { DoubaoVoiceSetting } = await import('./DoubaoVoiceSetting')

const empty: DoubaoVoiceSettings = {
  preference: 'auto',
  speaker: DOUBAO_DEFAULT_SPEAKER,
  key: { configured: false, masked: '' },
}

beforeEach(() => {
  getDoubaoVoiceSettings.mockReset()
  setDoubaoVoiceSettings.mockReset()
  getDoubaoVoiceSettings.mockResolvedValue(empty)
})

describe('DoubaoVoiceSetting', () => {
  it('shows the key form when nothing is saved', async () => {
    render(<DoubaoVoiceSetting />)
    expect(await screen.findByRole('tab', { name: 'Auto' })).toBeInTheDocument()
    expect(screen.getByLabelText('Doubao Speech API Key')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Key' })).not.toBeInTheDocument()
  })

  it('saves a key and then shows only the mask', async () => {
    const saved: DoubaoVoiceSettings = {
      preference: 'auto',
      speaker: DOUBAO_DEFAULT_SPEAKER,
      key: { configured: true, masked: '***secret' },
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

  it('stays disabled while settings are still loading', () => {
    getDoubaoVoiceSettings.mockReturnValue(new Promise(() => {}))
    render(<DoubaoVoiceSetting />)
    expect(screen.getByRole('tab', { name: 'Auto' })).toBeDisabled()
  })
})
